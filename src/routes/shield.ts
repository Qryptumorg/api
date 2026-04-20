import { Router } from "express";
import { ethers } from "ethers";
import { logger } from "../lib/logger";

const router = Router();

// All known Railgun proxy + relayAdapt contract addresses (from @railgun-community/shared-models NETWORK_CONFIG).
// Lowercased for case-insensitive comparison.
// Any TX whose `to` is not in this set is rejected before signing.
const RAILGUN_ALLOWED = new Set<string>([
    // Ethereum mainnet + Arbitrum (share the same proxy address)
    "0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9",
    // Ethereum mainnet relayAdapt (current + historical)
    "0xac9f360ae85469b27aedddeafc579ef2d052ad405",
    "0x22af4edbe3de885dda8f0a0653e6209e44e5b84",
    "0xc3f2c8f9d5f0705de706b1302b7a039e1e11ac88",
    // Arbitrum relayAdapt
    "0xb4f2d77bd12c6b548ae398244d7fad4abce4d89b",
    // Ethereum Sepolia proxy + relayAdapt
    "0xecfcf3b4ec647c4ca6d49108b311b7a7c9543fea",
    "0x7e3d929ebd5bdc84d02bd3205c777578f33a214d",
    // Polygon proxy + relayAdapt
    "0x19b620929f97b7b990801496c3b361ca5def8c71",
    "0xf82d00fc51f730f42a00f85e74895a2849fff2dd",
    // BNB Chain proxy (relayAdapt same as Polygon above)
    "0x590162bf4b50f6576a459b75309ee21d92178a10",
]);

function getRpcUrl(chainId: number): string | undefined {
    if (chainId === 1) {
        // Use private RPC if configured, fall back to public
        return process.env["MAINNET_RPC_URL"] ?? "https://eth.llamarpc.com";
    }
    const RPCS: Record<number, string> = {
        11155111: process.env["DRPC_SEPOLIA_URL"] ?? "https://ethereum-sepolia-rpc.publicnode.com",
        137:      "https://polygon.llamarpc.com",
        42161:    "https://arbitrum.llamarpc.com",
        56:       "https://binance.llamarpc.com",
    };
    return RPCS[chainId];
}

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = rateLimitMap.get(ip);
    if (!entry || now > entry.resetAt) {
        rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
        return true;
    }
    if (entry.count >= 5) return false;
    entry.count++;
    return true;
}

router.post("/shield/broadcast", async (req, res) => {
    const ip =
        (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
        req.socket.remoteAddress ??
        "unknown";

    if (!checkRateLimit(ip)) {
        return res.status(429).json({ error: "Rate limit exceeded. Max 5 broadcasts per minute." });
    }

    const { to, data, value, chainId } = req.body as {
        to?: string;
        data?: string;
        value?: string;
        chainId?: number;
    };

    if (!to || !data || !chainId) {
        return res.status(400).json({ error: "Missing required fields: to, data, chainId" });
    }

    if (!RAILGUN_ALLOWED.has(to.toLowerCase())) {
        logger.warn({ to, ip }, "Broadcast rejected: target is not a known Railgun contract");
        return res.status(403).json({ error: "Target address is not a whitelisted Railgun contract." });
    }

    const rpcUrl = getRpcUrl(chainId);
    if (!rpcUrl) {
        return res.status(400).json({ error: `Unsupported chainId: ${chainId}` });
    }

    const signerPk = process.env["QRYPTUM_SIGNER_PK"];
    if (!signerPk) {
        logger.error("QRYPTUM_SIGNER_PK secret not configured");
        return res.status(503).json({
            error: "Broadcaster not configured.",
            fallback: true,
        });
    }

    try {
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const signer = new ethers.Wallet(signerPk, provider);

        logger.info({ to, chainId, signerAddress: signer.address }, "Broadcasting unshield TX via QryptumSigner");

        const tx = await signer.sendTransaction({
            to,
            data,
            value: value ? BigInt(value) : 0n,
            gasLimit: 5_000_000n,
        });

        logger.info({ txHash: tx.hash, signerAddress: signer.address }, "Broadcast TX submitted");

        return res.json({ txHash: tx.hash, broadcaster: signer.address });
    } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        logger.error({ err, to, chainId }, "Broadcast TX failed");
        return res.status(500).json({ error: `Broadcast failed: ${msg}`, fallback: true });
    }
});

router.get("/shield/broadcaster-address", (_req, res) => {
    const signerPk = process.env["QRYPTUM_SIGNER_PK"];
    if (!signerPk) {
        return res.json({ address: null, configured: false });
    }
    try {
        const wallet = new ethers.Wallet(signerPk);
        return res.json({ address: wallet.address, configured: true });
    } catch {
        return res.json({ address: null, configured: false });
    }
});

export default router;
