import { Router } from "express";

const router = Router();

const ETHERSCAN_V2_BASE = "https://api.etherscan.io/v2/api";

const API_KEY = process.env.ETHERSCAN_API_KEY ?? "";

async function etherscan(chainId: number, params: Record<string, string>) {
    const qs = new URLSearchParams({ chainid: String(chainId), ...params, apikey: API_KEY }).toString();
    const resp = await fetch(`${ETHERSCAN_V2_BASE}?${qs}`);
    if (!resp.ok) throw new Error(`Etherscan HTTP ${resp.status}`);
    return resp.json() as Promise<{ status: string; message: string; result: unknown }>;
}

router.get("/portfolio/:address", async (req, res) => {
    const { address } = req.params;
    const chainId = parseInt((req.query.chainId as string) || "11155111", 10);

    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
        return res.status(400).json({ error: "Invalid address" });
    }

    if (!API_KEY) {
        return res.status(503).json({ error: "ETHERSCAN_API_KEY not configured" });
    }

    try {
        const txResp = await etherscan(chainId, {
            module: "account",
            action: "tokentx",
            address,
            sort: "desc",
            offset: "1000",
            page: "1",
        });

        if (txResp.status !== "1" || !Array.isArray(txResp.result)) {
            return res.json({ tokens: [] });
        }

        const transfers = txResp.result as Array<{
            contractAddress: string;
            tokenName: string;
            tokenSymbol: string;
            tokenDecimal: string;
        }>;

        const seen = new Map<string, { address: string; symbol: string; name: string; decimals: number }>();
        for (const tx of transfers) {
            const addr = tx.contractAddress.toLowerCase();
            if (!seen.has(addr)) {
                seen.set(addr, {
                    address: tx.contractAddress,
                    symbol: tx.tokenSymbol,
                    name: tx.tokenName,
                    decimals: parseInt(tx.tokenDecimal, 10) || 18,
                });
            }
        }

        const uniqueTokens = Array.from(seen.values()).slice(0, 30);

        const balanceResults = await Promise.all(
            uniqueTokens.map(t =>
                etherscan(chainId, {
                    module: "account",
                    action: "tokenbalance",
                    contractaddress: t.address,
                    address,
                    tag: "latest",
                }).catch(() => ({ status: "0", message: "", result: "0" }))
            )
        );

        function safeBalance(raw: unknown): string {
            const s = String(raw ?? "0").trim();
            return /^\d+$/.test(s) ? s : "0";
        }

        const tokens = uniqueTokens
            .map((t, i) => {
                const resp = balanceResults[i];
                const balance = resp?.status === "1"
                    ? safeBalance(resp.result)
                    : "0";
                return { ...t, balance };
            })
            .filter(t => t.balance !== "0" && t.balance !== "");

        return res.json({ tokens });
    } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return res.status(500).json({ error: msg });
    }
});

export default router;
