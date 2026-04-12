import { Router } from "express";
import { ethers } from "ethers";
import { logger } from "../lib/logger";

const router = Router();

const RAILGUN_CONTRACTS: Record<number, string> = {
    11155111: "0xeCFCf3b4eC647c4Ca6D49108b311b7a7C9543fea",
};

const RPCS: Record<number, string> = {
    11155111: "https://ethereum-sepolia-rpc.publicnode.com",
    1:        "https://eth.llamarpc.com",
    137:      "https://polygon.llamarpc.com",
    42161:    "https://arbitrum.llamarpc.com",
    56:       "https://binance.llamarpc.com",
};

const RAILGUN_CONTRACTS_LOWER = new Set(
    Object.values(RAILGUN_CONTRACTS).map(a => a.toLowerCase())
);

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

    if (!RAILGUN_CONTRACTS_LOWER.has(to.toLowerCase())) {
        logger.warn({ to, ip }, "Broadcast rejected: target is not a known Railgun contract");
        return res.status(403).json({ error: "Target address is not a whitelisted Railgun contract." });
    }

    const rpcUrl = RPCS[chainId];
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
            gasLimit: 2_000_000n,
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
