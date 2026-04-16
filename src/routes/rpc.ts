import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

/**
 * POST /api/rpc/1
 * Transparent JSON-RPC proxy to the private mainnet RPC URL (MAINNET_RPC_URL env var).
 * The client never sees the private URL - it only calls this endpoint.
 * Only supports chainId 1 (Ethereum mainnet).
 */
router.post("/rpc/1", async (req: Request, res: Response) => {
    const rpcUrl = process.env["MAINNET_RPC_URL"];
    if (!rpcUrl) {
        res.status(503).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "RPC proxy not configured" },
            id: req.body?.id ?? null,
        });
        return;
    }

    try {
        const upstream = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req.body),
        });
        const data = await upstream.json();
        res.status(upstream.status).json(data);
    } catch (err) {
        res.status(502).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "RPC proxy upstream error" },
            id: req.body?.id ?? null,
        });
    }
});

export default router;
