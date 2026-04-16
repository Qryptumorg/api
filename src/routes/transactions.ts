import { Router } from "express";
import { db } from "@workspace/db";
import { transactionsTable } from "@workspace/db/schema";
import {
  GetTransactionsParams,
  GetTransactionsQueryParams,
  RecordTransactionBody,
} from "@workspace/api-zod";
import { eq, desc, count, and } from "drizzle-orm";

const router = Router();

router.get("/transactions/:walletAddress", async (req, res) => {
  const params = GetTransactionsParams.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: "Invalid wallet address" });
  }

  const query = GetTransactionsQueryParams.safeParse(req.query);
  const limit = query.success ? (query.data.limit ?? 50) : 50;
  const offset = query.success ? (query.data.offset ?? 0) : 0;

  const address = params.data.walletAddress.toLowerCase();
  const networkIdRaw = req.query.networkId;
  const networkId = networkIdRaw !== undefined ? parseInt(String(networkIdRaw), 10) : null;
  const networkFilter = networkId !== null && !isNaN(networkId)
    ? eq(transactionsTable.networkId, networkId)
    : undefined;

  const whereClause = networkFilter
    ? and(eq(transactionsTable.walletAddress, address), networkFilter)
    : eq(transactionsTable.walletAddress, address);

  const [rows, totalResult] = await Promise.all([
    db
      .select()
      .from(transactionsTable)
      .where(whereClause)
      .orderBy(desc(transactionsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: count() })
      .from(transactionsTable)
      .where(whereClause),
  ]);

  return res.json({
    transactions: rows,
    total: totalResult[0]?.count ?? 0,
  });
});

router.post("/transactions", async (req, res) => {
  const body = RecordTransactionBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: "Invalid request body", details: body.error.issues });
  }

  const existing = await db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.txHash, body.data.txHash))
    .limit(1);

  if (existing.length > 0) {
    return res.status(200).json(existing[0]);
  }

  const inserted = await db
    .insert(transactionsTable)
    .values({
      walletAddress: body.data.walletAddress.toLowerCase(),
      txHash: body.data.txHash,
      type: body.data.type,
      tokenAddress: body.data.tokenAddress.toLowerCase(),
      tokenSymbol: body.data.tokenSymbol,
      tokenName: body.data.tokenName,
      amount: body.data.amount,
      fromAddress: body.data.fromAddress.toLowerCase(),
      toAddress: body.data.toAddress ? body.data.toAddress.toLowerCase() : null,
      networkId: body.data.networkId,
    })
    .returning();

  return res.status(201).json(inserted[0]);
});

export default router;
