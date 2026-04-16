import { Router } from "express";
import { db } from "@workspace/db";
import { railgunPendingTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";

const router = Router();

// GET /railgun-pending/:walletAddress/:chainId - returns ALL pending for wallet+chain
router.get("/railgun-pending/:walletAddress/:chainId", async (req, res) => {
    const { walletAddress, chainId } = req.params;
    const chainIdNum = parseInt(chainId, 10);
    if (!walletAddress || isNaN(chainIdNum)) return res.status(400).json({ error: "Invalid params" });
    try {
        const rows = await db
            .select()
            .from(railgunPendingTable)
            .where(
                and(
                    eq(railgunPendingTable.walletAddress, walletAddress.toLowerCase()),
                    eq(railgunPendingTable.chainId, chainIdNum),
                )
            );
        return res.json({ pending: rows });
    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
});

// PUT /railgun-pending - upsert per (wallet, chain, token)
router.put("/railgun-pending", async (req, res) => {
    const { walletAddress, chainId, atomicHash, tokenAddress, tokenSymbol, amount, recipient } = req.body;
    if (!walletAddress || !chainId || !atomicHash || !tokenAddress || !tokenSymbol || !amount || !recipient) {
        return res.status(400).json({ error: "Missing required fields" });
    }
    const chainIdNum = parseInt(String(chainId), 10);
    if (isNaN(chainIdNum)) return res.status(400).json({ error: "Invalid chainId" });
    try {
        // Delete existing for this wallet+chain+token, then insert fresh
        await db.delete(railgunPendingTable).where(
            and(
                eq(railgunPendingTable.walletAddress, walletAddress.toLowerCase()),
                eq(railgunPendingTable.chainId, chainIdNum),
                eq(railgunPendingTable.tokenAddress, tokenAddress.toLowerCase()),
            )
        );
        const rows = await db.insert(railgunPendingTable).values({
            walletAddress: walletAddress.toLowerCase(),
            chainId: chainIdNum,
            atomicHash,
            tokenAddress: tokenAddress.toLowerCase(),
            tokenSymbol,
            amount,
            recipient: recipient.toLowerCase(),
        }).returning();
        return res.json({ pending: rows[0] });
    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
});

// DELETE /railgun-pending/:walletAddress/:chainId/:tokenAddress
router.delete("/railgun-pending/:walletAddress/:chainId/:tokenAddress", async (req, res) => {
    const { walletAddress, chainId, tokenAddress } = req.params;
    const chainIdNum = parseInt(chainId, 10);
    if (!walletAddress || isNaN(chainIdNum) || !tokenAddress) return res.status(400).json({ error: "Invalid params" });
    try {
        await db.delete(railgunPendingTable).where(
            and(
                eq(railgunPendingTable.walletAddress, walletAddress.toLowerCase()),
                eq(railgunPendingTable.chainId, chainIdNum),
                eq(railgunPendingTable.tokenAddress, tokenAddress.toLowerCase()),
            )
        );
        return res.json({ ok: true });
    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
});

export default router;
