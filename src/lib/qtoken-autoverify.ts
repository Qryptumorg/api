/**
 * QToken Auto-Verify Service
 *
 * Polls Sepolia and/or Mainnet for QTokenDeployed events from QryptSafe vaults,
 * then automatically submits each new qToken to Etherscan for verification (MIT).
 * Runs silently in the background alongside the API server.
 *
 * Required env vars:
 *   ETHERSCAN_API_KEY   - Etherscan API key (works for both Sepolia and Mainnet)
 *   SEPOLIA_RPC_URL     - enables Sepolia polling
 *   MAINNET_RPC_URL     - enables Mainnet polling
 */

import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

const ETHERSCAN_KEY    = process.env.ETHERSCAN_API_KEY  || "";
const POLL_INTERVAL_MS = 60_000;
const CONFIRM_BLOCKS   = 3;
const MAX_BLOCK_RANGE  = 9; // Alchemy free tier caps eth_getLogs at 10 blocks; use 9 for safety

// keccak256("QTokenDeployed(address,address)") -- precomputed, never changes
const QTOKEN_DEPLOYED_TOPIC = "0xa9b482826b98af85a8a9e7e42ef14980212bea648c0f68dfb0fa437ba2e21c4e";

// ── Network config ────────────────────────────────────────────────────────────

interface NetworkState {
    name: string;
    chainId: string;
    rpcUrl: string;
    lastScannedBlock: number;
    verifiedSet: Set<string>;
}

// ── In-memory cache for verify input ─────────────────────────────────────────

let cachedVerifyInput: string | null = null;

// ── Raw JSON-RPC over HTTPS ───────────────────────────────────────────────────

function jsonRpc(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
        const url = new URL(rpcUrl);
        const opts: https.RequestOptions = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname + url.search,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
            },
        };
        const req = https.request(opts, (res) => {
            let d = "";
            res.on("data", (c: Buffer) => (d += c));
            res.on("end", () => {
                try {
                    const parsed = JSON.parse(d) as { result?: unknown; error?: { message: string } };
                    if (parsed.error) return reject(new Error(parsed.error.message));
                    resolve(parsed.result);
                } catch (e) { reject(e); }
            });
        });
        req.on("error", reject);
        req.write(body);
        req.end();
    });
}

// ── Etherscan API v2 helpers ──────────────────────────────────────────────────

function etherscanPost(
    chainId: string,
    params: Record<string, string>
): Promise<{ status: string; message: string; result: string }> {
    return new Promise((resolve, reject) => {
        const body = new URLSearchParams(params).toString();
        const req = https.request({
            hostname: "api.etherscan.io",
            path: `/v2/api?chainid=${chainId}`,
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": Buffer.byteLength(body),
            },
        }, (res) => {
            let d = "";
            res.on("data", (c: Buffer) => (d += c));
            res.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
        });
        req.on("error", reject);
        req.write(body);
        req.end();
    });
}

function etherscanGet(
    chainId: string,
    params: Record<string, string>
): Promise<{ status: string; result: string }> {
    return new Promise((resolve, reject) => {
        const qs = new URLSearchParams({ chainid: chainId, ...params }).toString();
        const req = https.request({
            hostname: "api.etherscan.io",
            path: `/v2/api?${qs}`,
            method: "GET",
        }, (res) => {
            let d = "";
            res.on("data", (c: Buffer) => (d += c));
            res.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
        });
        req.on("error", reject);
        req.end();
    });
}

// ── ABI helpers ───────────────────────────────────────────────────────────────

function decodeAbiString(hex: string): string {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (clean.length < 128) return "";
    const len = parseInt(clean.slice(64, 128), 16);
    return Buffer.from(clean.slice(128, 128 + len * 2), "hex").toString("utf8");
}

// ABI-encode constructor args for ShieldToken(string name, string symbol, address vault, uint8 decimals)
function abiEncodeConstructorArgs(name: string, symbol: string, vault: string, decimals: number): string {
    const enc = (s: string) => {
        const bytes = Buffer.from(s, "utf8");
        const lenHex = bytes.length.toString(16).padStart(64, "0");
        const dataHex = bytes.toString("hex").padEnd(Math.ceil(bytes.length / 32) * 64, "0");
        return lenHex + dataHex;
    };

    const nameEnc   = enc(name);
    const symbolEnc = enc(symbol);

    // Offsets: 4 slots of 32 bytes = 128 bytes to first dynamic value
    const offset1 = (128).toString(16).padStart(64, "0");
    const offset2 = (128 + nameEnc.length / 2).toString(16).padStart(64, "0");
    const addrHex     = vault.toLowerCase().replace("0x", "").padStart(64, "0");
    const decimalsHex = decimals.toString(16).padStart(64, "0");

    return offset1 + offset2 + addrHex + decimalsHex + nameEnc + symbolEnc;
}

// ── Read qToken metadata via eth_call ────────────────────────────────────────

async function readQTokenMeta(
    rpcUrl: string,
    address: string
): Promise<{ name: string; symbol: string; vault: string; decimals: number }> {
    const [nameHex, symbolHex, vaultHex, decimalsHex] = await Promise.all([
        jsonRpc(rpcUrl, "eth_call", [{ to: address, data: "0x06fdde03" }, "latest"]) as Promise<string>,
        jsonRpc(rpcUrl, "eth_call", [{ to: address, data: "0x95d89b41" }, "latest"]) as Promise<string>,
        jsonRpc(rpcUrl, "eth_call", [{ to: address, data: "0xfbfa77cf" }, "latest"]) as Promise<string>,
        jsonRpc(rpcUrl, "eth_call", [{ to: address, data: "0x313ce567" }, "latest"]) as Promise<string>,
    ]);

    return {
        name:     decodeAbiString(nameHex),
        symbol:   decodeAbiString(symbolHex),
        vault:    "0x" + vaultHex.slice(-40),
        decimals: parseInt(decimalsHex, 16),
    };
}

// ── Load standard JSON input for ShieldToken ──────────────────────────────────

function loadVerifyInput(): string | null {
    if (cachedVerifyInput) return cachedVerifyInput;
    const inputPath = path.join(__dirname, "../../verify-inputs/shield-token.json");
    if (!fs.existsSync(inputPath)) {
        logger.warn({ inputPath }, "Auto-verify: shield-token.json not found. Run: pnpm --filter @workspace/shield-contracts export-verify-input");
        return null;
    }
    cachedVerifyInput = fs.readFileSync(inputPath, "utf8");
    return cachedVerifyInput;
}

// ── Verify one qToken on Etherscan ────────────────────────────────────────────

async function verifyQToken(net: NetworkState, qTokenAddress: string): Promise<void> {
    const addr = qTokenAddress.toLowerCase();
    if (net.verifiedSet.has(addr)) return;

    logger.info({ network: net.name, qTokenAddress }, "Auto-verify: reading qToken metadata");

    let meta: { name: string; symbol: string; vault: string; decimals: number };
    try {
        meta = await readQTokenMeta(net.rpcUrl, qTokenAddress);
    } catch (err) {
        logger.error({ err, network: net.name, qTokenAddress }, "Auto-verify: failed to read qToken metadata");
        return;
    }

    logger.info({ network: net.name, qTokenAddress, ...meta }, "Auto-verify: submitting to Etherscan");

    const verifyInput = loadVerifyInput();
    if (!verifyInput) return;

    const constructorArgs = abiEncodeConstructorArgs(meta.name, meta.symbol, meta.vault, meta.decimals);

    let res: { status: string; message: string; result: string };
    try {
        res = await etherscanPost(net.chainId, {
            module:               "contract",
            action:               "verifysourcecode",
            apikey:               ETHERSCAN_KEY,
            codeformat:           "solidity-standard-json-input",
            contractname:         "contracts/ShieldToken.sol:ShieldToken",
            contractaddress:      qTokenAddress,
            compilerversion:      "v0.8.34+commit.80d5c536",
            licenseType:          "3",
            sourceCode:           verifyInput,
            constructorArguments: constructorArgs,
        });
    } catch (err) {
        logger.error({ err, network: net.name, qTokenAddress }, "Auto-verify: Etherscan submit error");
        return;
    }

    if (res.status !== "1") {
        if (res.result?.includes("already verified")) {
            net.verifiedSet.add(addr);
            logger.info({ network: net.name, qTokenAddress }, "Auto-verify: already verified");
        } else {
            logger.warn({ network: net.name, qTokenAddress, result: res.result }, "Auto-verify: submit rejected");
        }
        return;
    }

    const guid = res.result;
    logger.info({ network: net.name, qTokenAddress, guid }, "Auto-verify: polling Etherscan...");

    for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 8000));
        try {
            const check = await etherscanGet(net.chainId, {
                module: "contract",
                action: "checkverifystatus",
                guid,
                apikey: ETHERSCAN_KEY,
            });
            logger.info({ network: net.name, qTokenAddress, status: check.result }, "Auto-verify: poll");
            if (check.result === "Pass - Verified") {
                net.verifiedSet.add(addr);
                logger.info({ network: net.name, qTokenAddress }, "Auto-verify: VERIFIED on Etherscan");
                return;
            }
            if (check.result?.startsWith("Fail") || check.result?.includes("already verified")) {
                net.verifiedSet.add(addr);
                logger.info({ network: net.name, qTokenAddress, status: check.result }, "Auto-verify: done");
                return;
            }
        } catch (err) {
            logger.warn({ err }, "Auto-verify: poll error");
        }
    }

    logger.warn({ network: net.name, qTokenAddress }, "Auto-verify: timed out, will retry next poll cycle");
}

// ── Poll for new QTokenDeployed events on one network ─────────────────────────

async function pollQTokenDeployed(net: NetworkState): Promise<void> {
    try {
        const currentBlockHex = await jsonRpc(net.rpcUrl, "eth_blockNumber", []) as string;
        const currentBlock = parseInt(currentBlockHex, 16);
        const safeBlock = currentBlock - CONFIRM_BLOCKS;

        if (net.lastScannedBlock === 0) {
            // First run: scan only the last 50 blocks to avoid block-range limits on initial boot
            net.lastScannedBlock = Math.max(0, safeBlock - 50);
        }

        if (net.lastScannedBlock >= safeBlock) return;

        type EthLog = { topics: string[]; address: string };
        const allLogs: EthLog[] = [];

        // Paginate in chunks of MAX_BLOCK_RANGE
        let from = net.lastScannedBlock;
        while (from <= safeBlock) {
            const to = Math.min(from + MAX_BLOCK_RANGE, safeBlock);
            const chunk = await jsonRpc(net.rpcUrl, "eth_getLogs", [{
                fromBlock: "0x" + from.toString(16),
                toBlock:   "0x" + to.toString(16),
                topics:    [QTOKEN_DEPLOYED_TOPIC],
            }]) as EthLog[];
            allLogs.push(...chunk);
            from = to + 1;
        }

        if (allLogs.length > 0) {
            logger.info({ network: net.name, count: allLogs.length }, "Auto-verify: found QTokenDeployed events");
        }

        for (const log of allLogs) {
            if (log.topics.length >= 3) {
                const qTokenAddr = "0x" + log.topics[2].slice(-40);
                if (!net.verifiedSet.has(qTokenAddr.toLowerCase())) {
                    await verifyQToken(net, qTokenAddr);
                }
            }
        }

        net.lastScannedBlock = safeBlock + 1;
    } catch (err) {
        logger.error({ err, network: net.name }, "Auto-verify: poll error (will retry next cycle)");
    }
}

// ── Public: start the background service ──────────────────────────────────────

export function startQTokenAutoVerify(): void {
    if (!ETHERSCAN_KEY) {
        logger.warn("Auto-verify: ETHERSCAN_API_KEY not set, service disabled");
        return;
    }

    const networks: NetworkState[] = [];

    // Sepolia: use configured RPC or fall back to public node (no key needed)
    const sepoliaRpc = process.env["SEPOLIA_RPC_URL"] || "https://ethereum-sepolia-rpc.publicnode.com";
    networks.push({
        name:             "sepolia",
        chainId:          "11155111",
        rpcUrl:           sepoliaRpc,
        lastScannedBlock: 0,
        verifiedSet:      new Set(),
    });
    logger.info({ rpc: sepoliaRpc }, "Auto-verify: Sepolia polling enabled");

    // Mainnet: only poll if a private RPC is configured (public nodes may throttle heavy log scans)
    const mainnetRpc = process.env["MAINNET_RPC_URL"] || "";
    if (mainnetRpc) {
        networks.push({
            name:             "mainnet",
            chainId:          "1",
            rpcUrl:           mainnetRpc,
            lastScannedBlock: 0,
            verifiedSet:      new Set(),
        });
        logger.info("Auto-verify: Mainnet polling enabled");
    } else {
        logger.info("Auto-verify: Mainnet polling skipped (MAINNET_RPC_URL not set)");
    }

    if (networks.length === 0) {
        logger.warn("Auto-verify: no RPC URLs configured (SEPOLIA_RPC_URL / MAINNET_RPC_URL), service disabled");
        return;
    }

    logger.info({ networks: networks.map((n) => n.name) }, "Auto-verify: qToken auto-verify service started (polling every 60s)");

    // First poll after 30s (give server time to boot), then every 60s per network
    setTimeout(() => {
        for (const net of networks) {
            void pollQTokenDeployed(net);
            setInterval(() => { void pollQTokenDeployed(net); }, POLL_INTERVAL_MS);
        }
    }, 30_000);
}
