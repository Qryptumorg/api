import { Router } from "express";
import { verifyQTokenManual, verifyQTokenDebug, checkVerifyStatus } from "../lib/qtoken-autoverify";
import { logger } from "../lib/logger";

const router = Router();

/**
 * POST /verify/qtoken
 * Body: { address: string, chainId: number }
 *
 * Manually triggers Etherscan verification for a specific qToken.
 * Useful for tokens created before the auto-verify service was running.
 */
router.post("/verify/qtoken", async (req, res) => {
    const { address, chainId, force } = req.body as { address?: string; chainId?: number; force?: boolean };

    if (!address || !address.match(/^0x[0-9a-fA-F]{40}$/)) {
        return res.status(400).json({ error: "Missing or invalid address (must be 0x... 40 hex chars)" });
    }
    if (!chainId || !Number.isInteger(chainId)) {
        return res.status(400).json({ error: "Missing or invalid chainId" });
    }

    logger.info({ address, chainId, force }, "Manual qToken verify triggered");

    try {
        const result = await verifyQTokenManual(address, chainId, force === true);
        return res.json(result);
    } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        logger.error({ err, address, chainId }, "Manual verify failed");
        return res.status(500).json({ ok: false, message: msg });
    }
});

router.post("/verify/qtoken/debug", async (req, res) => {
    const { address, chainId } = req.body as { address?: string; chainId?: number };
    if (!address || !address.match(/^0x[0-9a-fA-F]{40}$/))
        return res.status(400).json({ error: "Invalid address" });
    if (!chainId || !Number.isInteger(chainId))
        return res.status(400).json({ error: "Invalid chainId" });
    try {
        const result = await verifyQTokenDebug(address, chainId);
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
});

router.get("/verify/status/:guid", async (req, res) => {
    const { guid } = req.params;
    const { chainId } = req.query as { chainId?: string };
    if (!guid) return res.status(400).json({ error: "Missing guid" });
    try {
        const result = await checkVerifyStatus(String(chainId ?? "1"), guid);
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
});

export default router;
