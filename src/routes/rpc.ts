import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

async function proxyRpc(rpcUrl: string, req: Request, res: Response) {
    try {
        const upstream = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req.body),
        });
        const data = await upstream.json();
        res.status(upstream.status).json(data);
    } catch {
        res.status(502).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "RPC proxy upstream error" },
            id: req.body?.id ?? null,
        });
    }
}

/**
 * POST /api/rpc/1
 * Proxy to MAINNET_RPC_URL (keeps private RPC key out of browser bundle).
 */
router.post("/rpc/1", async (req: Request, res: Response) => {
    const rpcUrl = process.env["MAINNET_RPC_URL"];
    if (!rpcUrl) {
        res.status(503).json({ jsonrpc: "2.0", error: { code: -32603, message: "RPC proxy not configured" }, id: req.body?.id ?? null });
        return;
    }
    await proxyRpc(rpcUrl, req, res);
});

/**
 * POST /api/rpc/drpc
 * Proxy to dRPC paid endpoint using DRPC_API_KEY env var.
 * dRPC paid: no block range limits, archive access, better uptime than free nodes.
 * Returns 503 if DRPC_API_KEY is not set so the client falls back gracefully.
 */
router.post("/rpc/drpc", async (req: Request, res: Response) => {
    const key = process.env["DRPC_API_KEY"];
    if (!key) {
        res.status(503).json({ jsonrpc: "2.0", error: { code: -32603, message: "dRPC not configured" }, id: req.body?.id ?? null });
        return;
    }
    const rpcUrl = `https://lb.drpc.org/ogrpc?network=ethereum&dkey=${key}`;
    await proxyRpc(rpcUrl, req, res);
});

/**
 * POST /api/poi
 * Proxy to RAILGUN Private POI aggregator.
 * Browser XHR drops connection (ERR_CONNECTION_CLOSED) to the aggregator directly.
 * Node.js server-side fetch works reliably. This proxy bridges the gap.
 */
const POI_AGGREGATOR = "https://ppoi-agg.horsewithsixlegs.xyz";

router.post("/poi", async (req: Request, res: Response) => {
    try {
        const upstream = await fetch(POI_AGGREGATOR, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            body: JSON.stringify(req.body),
        });
        const data = await upstream.json();
        res.status(upstream.status).json(data);
    } catch {
        res.status(502).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "POI proxy upstream error" },
            id: req.body?.id ?? null,
        });
    }
});

export default router;
