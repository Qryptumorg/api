import { Router } from "express";
import { verifyQTokenManual } from "../lib/qtoken-autoverify";
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

export default router;
