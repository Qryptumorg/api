import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

// 25 s timeout - Railway hard-kills at 30 s. Express must respond first so
// the CORS headers we set at app level actually reach the browser. Without a
// server-side timeout the upstream hangs until Railway drops the TCP connection
// at the infra layer (no headers = browser sees "No Access-Control-Allow-Origin").
const PROXY_TIMEOUT_MS = 25_000;

async function proxyRpc(rpcUrl: string, req: Request, res: Response) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), PROXY_TIMEOUT_MS);
    try {
        const upstream = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req.body),
            signal: ac.signal,
        });
        clearTimeout(timer);
        const data = await upstream.json();
        res.status(upstream.status).json(data);
    } catch (err: any) {
        clearTimeout(timer);
        const timedOut = err?.name === "AbortError";
        res.status(timedOut ? 504 : 502).json({
            jsonrpc: "2.0",
            error: {
                code: -32603,
                message: timedOut ? "RPC proxy timeout" : "RPC proxy upstream error",
            },
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
 * POST /api/rpc/11155111
 * Proxy to DRPC_SEPOLIA_URL (dRPC testnet) — keeps RPC key out of browser bundle.
 * Returns 503 if DRPC_SEPOLIA_URL is not set so the client falls back to public RPCs.
 */
router.post("/rpc/11155111", async (req: Request, res: Response) => {
    const rpcUrl = process.env["DRPC_SEPOLIA_URL"];
    if (!rpcUrl) {
        res.status(503).json({ jsonrpc: "2.0", error: { code: -32603, message: "Sepolia dRPC proxy not configured" }, id: req.body?.id ?? null });
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
 * The aggregator drops browser XHR connections (ERR_CONNECTION_CLOSED) but
 * responds correctly to server-side Node.js fetch. This proxy fixes that gap.
 * The RAILGUN engine is configured to use this URL instead of the aggregator directly.
 */
const POI_AGGREGATOR = "https://ppoi-agg.horsewithsixlegs.xyz";

router.post("/poi", async (req: Request, res: Response) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), PROXY_TIMEOUT_MS);
    try {
        const upstream = await fetch(POI_AGGREGATOR, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            body: JSON.stringify(req.body),
            signal: ac.signal,
        });
        clearTimeout(timer);
        const data = await upstream.json();
        res.status(upstream.status).json(data);
    } catch (err: any) {
        clearTimeout(timer);
        const timedOut = err?.name === "AbortError";
        res.status(timedOut ? 504 : 502).json({
            jsonrpc: "2.0",
            error: {
                code: -32603,
                message: timedOut ? "POI proxy timeout" : "POI proxy upstream error",
            },
            id: req.body?.id ?? null,
        });
    }
});

export default router;
