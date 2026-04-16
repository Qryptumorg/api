/**
 * QToken Auto-Verify Service
 *
 * How it works:
 *   1. Scans factory QryptSafeCreated events (address-filtered, efficient) to build a list of
 *      all deployed vault contracts.
 *   2. Scans QTokenDeployed events from those vault addresses to find newly created qTokens.
 *   3. Verifies each new qToken on Etherscan using standard JSON input.
 *   4. Persists lastScannedBlock per network to Postgres so restarts never lose progress.
 *
 * Required env vars:
 *   ETHERSCAN_API_KEY   Etherscan API key (v2 unified endpoint)
 *   MAINNET_RPC_URL     enables Mainnet polling
 *   SEPOLIA_RPC_URL     (optional) Sepolia polling, falls back to public node
 */

import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ethers } from "ethers";
import { db } from "@workspace/db";
import { kvStateTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ─────────────────────────────────────────────────────────────────────

const ETHERSCAN_KEY    = process.env["ETHERSCAN_API_KEY"] ?? "";
const POLL_INTERVAL_MS = 60_000;
const CONFIRM_BLOCKS   = 3;
const MAX_RANGE        = 10_000; // safe for address-filtered eth_getLogs on most providers

// ── Topics (computed once at startup) ──────────────────────────────────────────

const TOPIC_QRYPT_SAFE_CREATED = ethers.id("QryptSafeCreated(address,address)");
const TOPIC_QTOKEN_DEPLOYED    = ethers.id("QTokenDeployed(address,address)");

// ── Network definitions ─────────────────────────────────────────────────────────

interface NetworkConfig {
    name: string;
    chainId: string;
    factoryAddress: string;
    factoryDeployBlock: number;
    rpcUrl: () => string | null;
}

const NETWORK_CONFIGS: NetworkConfig[] = [
    {
        name:               "mainnet",
        chainId:            "1",
        factoryAddress:     "0xE3583f8cA00Edf89A00d9D8c46AE456487a4C56f",
        factoryDeployBlock: 21_000_000,
        rpcUrl:             () => process.env["MAINNET_RPC_URL"] ?? null,
    },
    {
        name:               "sepolia",
        chainId:            "11155111",
        factoryAddress:     "0xeaa722e996888b662E71aBf63d08729c6B6802F4",
        factoryDeployBlock: 7_000_000,
        rpcUrl:             () => process.env["SEPOLIA_RPC_URL"] ?? "https://ethereum-sepolia-rpc.publicnode.com",
    },
];

// ── Runtime state per network ───────────────────────────────────────────────────

interface NetworkState {
    config:          NetworkConfig;
    rpcUrl:          string;
    vaultScanBlock:  number;
    qtokenScanBlock: number;
    knownVaults:     Set<string>;
    verifiedSet:     Set<string>;
}

// ── DB key helpers ──────────────────────────────────────────────────────────────

function dbKey(network: string, kind: "vault_scan" | "qtoken_scan"): string {
    return `autoverify:${network}:${kind}`;
}

async function readBlock(network: string, kind: "vault_scan" | "qtoken_scan"): Promise<number | null> {
    try {
        const rows = await db.select().from(kvStateTable).where(eq(kvStateTable.key, dbKey(network, kind))).limit(1);
        if (rows.length && rows[0]) return parseInt(rows[0].value, 10);
    } catch (err) {
        logger.warn({ err }, "Auto-verify: DB read failed, will use default start block");
    }
    return null;
}

async function writeBlock(network: string, kind: "vault_scan" | "qtoken_scan", block: number): Promise<void> {
    try {
        await db.insert(kvStateTable)
            .values({ key: dbKey(network, kind), value: String(block), updatedAt: new Date() })
            .onConflictDoUpdate({ target: kvStateTable.key, set: { value: String(block), updatedAt: new Date() } });
    } catch (err) {
        logger.warn({ err }, "Auto-verify: DB write failed");
    }
}

// ── Raw JSON-RPC ────────────────────────────────────────────────────────────────

function jsonRpc(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
        const url  = new URL(rpcUrl);
        const opts: https.RequestOptions = {
            hostname: url.hostname,
            port:     url.port || 443,
            path:     url.pathname + url.search,
            method:   "POST",
            headers:  { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
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

type EthLog = { topics: string[]; data: string; address: string };

async function getLogs(rpcUrl: string, fromBlock: number, toBlock: number, address: string | string[], topics: string[]): Promise<EthLog[]> {
    const all: EthLog[] = [];
    let from = fromBlock;
    while (from <= toBlock) {
        const to = Math.min(from + MAX_RANGE, toBlock);
        const chunk = await jsonRpc(rpcUrl, "eth_getLogs", [{
            fromBlock: "0x" + from.toString(16),
            toBlock:   "0x" + to.toString(16),
            address,
            topics,
        }]) as EthLog[];
        all.push(...chunk);
        from = to + 1;
    }
    return all;
}

// ── Etherscan API v2 ────────────────────────────────────────────────────────────

function etherscanPost(chainId: string, params: Record<string, string>): Promise<{ status: string; message: string; result: string }> {
    return new Promise((resolve, reject) => {
        const body = new URLSearchParams(params).toString();
        const req  = https.request({
            hostname: "api.etherscan.io",
            path:     `/v2/api?chainid=${chainId}`,
            method:   "POST",
            headers:  { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) },
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

function etherscanGet(chainId: string, params: Record<string, string>): Promise<{ status: string; result: string }> {
    return new Promise((resolve, reject) => {
        const qs  = new URLSearchParams({ chainid: chainId, ...params }).toString();
        const req = https.request({ hostname: "api.etherscan.io", path: `/v2/api?${qs}`, method: "GET" }, (res) => {
            let d = "";
            res.on("data", (c: Buffer) => (d += c));
            res.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
        });
        req.on("error", reject);
        req.end();
    });
}

// ── ABI helpers ─────────────────────────────────────────────────────────────────

function decodeAbiString(hex: string): string {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (clean.length < 128) return "";
    const len = parseInt(clean.slice(64, 128), 16);
    return Buffer.from(clean.slice(128, 128 + len * 2), "hex").toString("utf8");
}

function abiEncodeConstructorArgs(name: string, symbol: string, vault: string, decimals: number): string {
    const enc = (s: string) => {
        const bytes   = Buffer.from(s, "utf8");
        const lenHex  = bytes.length.toString(16).padStart(64, "0");
        const dataHex = bytes.toString("hex").padEnd(Math.ceil(bytes.length / 32) * 64, "0");
        return lenHex + dataHex;
    };
    const nameEnc   = enc(name);
    const symbolEnc = enc(symbol);
    const offset1   = (128).toString(16).padStart(64, "0");
    const offset2   = (128 + nameEnc.length / 2).toString(16).padStart(64, "0");
    const addrHex   = vault.toLowerCase().replace("0x", "").padStart(64, "0");
    const decHex    = decimals.toString(16).padStart(64, "0");
    return offset1 + offset2 + addrHex + decHex + nameEnc + symbolEnc;
}

async function readQTokenMeta(rpcUrl: string, address: string): Promise<{ name: string; symbol: string; vault: string; decimals: number }> {
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

let cachedVerifyInput: string | null = null;
function loadVerifyInput(): string | null {
    if (cachedVerifyInput) return cachedVerifyInput;
    const p = path.join(__dirname, "../../verify-inputs/shield-token.json");
    if (!fs.existsSync(p)) {
        logger.warn({ path: p }, "Auto-verify: shield-token.json not found");
        return null;
    }
    cachedVerifyInput = fs.readFileSync(p, "utf8");
    return cachedVerifyInput;
}

// ── Verify one qToken ───────────────────────────────────────────────────────────

export async function verifyQToken(rpcUrl: string, chainId: string, qTokenAddress: string, verifiedSet: Set<string>): Promise<void> {
    const addr = qTokenAddress.toLowerCase();
    if (verifiedSet.has(addr)) return;

    logger.info({ chainId, qTokenAddress }, "Auto-verify: reading qToken metadata");

    let meta: { name: string; symbol: string; vault: string; decimals: number };
    try {
        meta = await readQTokenMeta(rpcUrl, qTokenAddress);
    } catch (err) {
        logger.error({ err, chainId, qTokenAddress }, "Auto-verify: failed to read qToken metadata");
        return;
    }

    logger.info({ chainId, qTokenAddress, ...meta }, "Auto-verify: submitting to Etherscan");

    const verifyInput = loadVerifyInput();
    if (!verifyInput) return;

    const constructorArgs = abiEncodeConstructorArgs(meta.name, meta.symbol, meta.vault, meta.decimals);

    let res: { status: string; message: string; result: string };
    try {
        res = await etherscanPost(chainId, {
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
        logger.error({ err, chainId, qTokenAddress }, "Auto-verify: Etherscan submit error");
        return;
    }

    if (res.status !== "1") {
        if (res.result?.includes("already verified") || res.result?.includes("Already Verified")) {
            verifiedSet.add(addr);
            logger.info({ chainId, qTokenAddress }, "Auto-verify: already verified on Etherscan");
        } else {
            logger.warn({ chainId, qTokenAddress, result: res.result }, "Auto-verify: submit rejected");
        }
        return;
    }

    const guid = res.result;
    logger.info({ chainId, qTokenAddress, guid }, "Auto-verify: polling Etherscan for result...");

    for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 8_000));
        try {
            const check = await etherscanGet(chainId, {
                module: "contract",
                action: "checkverifystatus",
                guid,
                apikey: ETHERSCAN_KEY,
            });
            logger.info({ chainId, qTokenAddress, status: check.result }, "Auto-verify: poll");
            if (check.result === "Pass - Verified") {
                verifiedSet.add(addr);
                logger.info({ chainId, qTokenAddress }, "Auto-verify: VERIFIED on Etherscan");
                return;
            }
            if (check.result?.startsWith("Fail") || check.result?.toLowerCase().includes("already verified")) {
                verifiedSet.add(addr);
                logger.info({ chainId, qTokenAddress, status: check.result }, "Auto-verify: done");
                return;
            }
        } catch (err) {
            logger.warn({ err }, "Auto-verify: poll error");
        }
    }

    logger.warn({ chainId, qTokenAddress }, "Auto-verify: timed out, will retry next cycle");
}

// ── Poll one network ────────────────────────────────────────────────────────────

async function pollNetwork(net: NetworkState): Promise<void> {
    const { config, rpcUrl } = net;
    try {
        const currentBlockHex = await jsonRpc(rpcUrl, "eth_blockNumber", []) as string;
        const safeBlock       = parseInt(currentBlockHex, 16) - CONFIRM_BLOCKS;

        // ── Step 1: Scan factory for new vault addresses ──────────────────────
        if (net.vaultScanBlock <= safeBlock) {
            const vaultLogs = await getLogs(
                rpcUrl,
                net.vaultScanBlock,
                safeBlock,
                config.factoryAddress,
                [TOPIC_QRYPT_SAFE_CREATED],
            );
            let newVaults = 0;
            for (const log of vaultLogs) {
                if (log.topics.length >= 3) {
                    const vaultAddr = ("0x" + log.topics[2].slice(-40)).toLowerCase();
                    if (!net.knownVaults.has(vaultAddr)) {
                        net.knownVaults.add(vaultAddr);
                        newVaults++;
                    }
                }
            }
            if (newVaults > 0) {
                logger.info({ network: config.name, newVaults, totalVaults: net.knownVaults.size }, "Auto-verify: found new vaults");
            }
            net.vaultScanBlock = safeBlock + 1;
            await writeBlock(config.name, "vault_scan", net.vaultScanBlock);
        }

        // ── Step 2: Scan vault addresses for new qTokens ──────────────────────
        if (net.knownVaults.size === 0) {
            logger.debug({ network: config.name }, "Auto-verify: no vaults found yet, skipping qToken scan");
            return;
        }
        if (net.qtokenScanBlock > safeBlock) return;

        const vaultList   = [...net.knownVaults];
        const qtokenLogs  = await getLogs(
            rpcUrl,
            net.qtokenScanBlock,
            safeBlock,
            vaultList,
            [TOPIC_QTOKEN_DEPLOYED],
        );

        if (qtokenLogs.length > 0) {
            logger.info({ network: config.name, count: qtokenLogs.length }, "Auto-verify: found QTokenDeployed events");
        }

        for (const log of qtokenLogs) {
            if (log.topics.length >= 3) {
                const qTokenAddr = "0x" + log.topics[2].slice(-40);
                if (!net.verifiedSet.has(qTokenAddr.toLowerCase())) {
                    await verifyQToken(rpcUrl, config.chainId, qTokenAddr, net.verifiedSet);
                }
            }
        }

        net.qtokenScanBlock = safeBlock + 1;
        await writeBlock(config.name, "qtoken_scan", net.qtokenScanBlock);

    } catch (err) {
        logger.error({ err, network: config.name }, "Auto-verify: poll error (will retry next cycle)");
    }
}

// ── Manual verify trigger (exported for HTTP endpoint) ─────────────────────────

const networkStates: Map<string, NetworkState> = new Map();

export async function verifyQTokenManual(qTokenAddress: string, chainId: number): Promise<{ ok: boolean; message: string }> {
    const config = NETWORK_CONFIGS.find(n => n.chainId === String(chainId));
    if (!config) return { ok: false, message: `Unsupported chainId: ${chainId}` };

    const rpcUrl = config.rpcUrl();
    if (!rpcUrl) return { ok: false, message: `No RPC configured for chainId ${chainId}` };

    const state = networkStates.get(config.name);
    const verifiedSet = state?.verifiedSet ?? new Set<string>();

    if (verifiedSet.has(qTokenAddress.toLowerCase())) {
        return { ok: true, message: "Already verified (cached)" };
    }

    await verifyQToken(rpcUrl, config.chainId, qTokenAddress, verifiedSet);
    return { ok: true, message: "Verification submitted. Check Railway logs for Etherscan result." };
}

// ── Public: start background service ───────────────────────────────────────────

export async function startQTokenAutoVerify(): Promise<void> {
    if (!ETHERSCAN_KEY) {
        logger.warn("Auto-verify: ETHERSCAN_API_KEY not set, service disabled");
        return;
    }

    const activeNetworks: NetworkState[] = [];

    for (const config of NETWORK_CONFIGS) {
        const rpcUrl = config.rpcUrl();
        if (!rpcUrl) {
            logger.info({ network: config.name }, "Auto-verify: no RPC URL, polling disabled for this network");
            continue;
        }

        const [savedVaultBlock, savedQTokenBlock] = await Promise.all([
            readBlock(config.name, "vault_scan"),
            readBlock(config.name, "qtoken_scan"),
        ]);

        const startBlock = savedVaultBlock ?? config.factoryDeployBlock;
        logger.info({
            network:        config.name,
            vaultScanStart: startBlock,
            qtokenScanStart: savedQTokenBlock ?? config.factoryDeployBlock,
            fromDb:         savedVaultBlock !== null,
        }, "Auto-verify: network polling enabled");

        const state: NetworkState = {
            config,
            rpcUrl,
            vaultScanBlock:  startBlock,
            qtokenScanBlock: savedQTokenBlock ?? config.factoryDeployBlock,
            knownVaults:     new Set(),
            verifiedSet:     new Set(),
        };
        activeNetworks.push(state);
        networkStates.set(config.name, state);
    }

    if (activeNetworks.length === 0) {
        logger.warn("Auto-verify: no networks configured, service not started");
        return;
    }

    logger.info({ networks: activeNetworks.map(n => n.config.name) }, "Auto-verify: service started");

    // First poll after 15s, then every 60s
    setTimeout(() => {
        for (const net of activeNetworks) {
            void pollNetwork(net);
            setInterval(() => { void pollNetwork(net); }, POLL_INTERVAL_MS);
        }
    }, 15_000);
}
