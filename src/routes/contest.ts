import { Router } from "express";
import { ethers } from "ethers";
import { logger } from "../lib/logger";

const router = Router();

// Contest vault ABI - minimal interface for claim function
// Vault: proof-only auth, no msg.sender check, QryptumSigner broadcasts
const CONTEST_VAULT_ABI = [
    "function claim(address recipient, string calldata proof) external",
    "function claimed() external view returns (bool)",
    "function proofHash() external view returns (bytes32)",
];

// Rate limit: max 5 attempts per IP per minute
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

// POST /contest/claim
// Body: { proof: string, recipient: string }
// QryptumSigner broadcasts claim() to contest vault via Flashbots private mempool
router.post("/contest/claim", async (req, res) => {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
    if (!checkRateLimit(ip)) {
        return res.status(429).json({ error: "Too many attempts. Wait 1 minute." });
    }

    const { proof, recipient } = req.body as { proof?: string; recipient?: string };
    if (!proof || typeof proof !== "string" || proof.trim().length === 0) {
        return res.status(400).json({ error: "Missing proof" });
    }
    if (!recipient || !ethers.isAddress(recipient)) {
        return res.status(400).json({ error: "Invalid recipient address" });
    }

    const vaultAddress = process.env["CONTEST_VAULT_ADDRESS"];
    if (!vaultAddress) {
        return res.status(503).json({ error: "Contest vault not configured yet" });
    }

    const signerKey = process.env["QRYPTUM_SIGNER_PK"];
    if (!signerKey) {
        return res.status(503).json({ error: "Signer not configured" });
    }

    try {
        // Use Flashbots RPC for private mempool - prevents front-running of valid proofs
        const provider = new ethers.JsonRpcProvider("https://rpc.flashbots.net");
        const signer = new ethers.Wallet(signerKey, provider);
        const vault = new ethers.Contract(vaultAddress, CONTEST_VAULT_ABI, signer);

        // Check if already claimed
        const claimed = await vault.claimed().catch(() => false);
        if (claimed) {
            return res.status(410).json({ error: "Vault already claimed. Contest over." });
        }

        // Simulate first - if proof is wrong the TX reverts, save gas
        await vault.claim.staticCall(recipient, proof.trim());

        // Broadcast via Flashbots private mempool
        const tx = await vault.claim(recipient, proof.trim(), {
            gasLimit: 120_000,
        });

        logger.info({ txHash: tx.hash, recipient, ip }, "Contest claim broadcast");
        return res.json({ txHash: tx.hash });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ msg, ip }, "Contest claim failed");

        if (msg.includes("Wrong proof") || msg.includes("execution reverted") || msg.includes("CALL_EXCEPTION")) {
            return res.status(400).json({ error: "Wrong proof" });
        }
        if (msg.includes("Already claimed")) {
            return res.status(410).json({ error: "Vault already claimed. Contest over." });
        }
        return res.status(500).json({ error: "Broadcast failed: " + msg.slice(0, 120) });
    }
});

// GET /contest/status - check if vault is still active
router.get("/contest/status", async (_req, res) => {
    const vaultAddress = process.env["CONTEST_VAULT_ADDRESS"];
    if (!vaultAddress) return res.json({ active: false, reason: "not_configured" });

    try {
        const provider = new ethers.JsonRpcProvider(process.env["MAINNET_RPC_URL"] ?? "https://eth.drpc.org");
        const vault = new ethers.Contract(vaultAddress, CONTEST_VAULT_ABI, provider);
        const claimed = await vault.claimed();
        return res.json({ active: !claimed, vaultAddress });
    } catch {
        return res.json({ active: true, vaultAddress });
    }
});

export default router;
