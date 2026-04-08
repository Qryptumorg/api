import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.js";
import { transactionsTable, TRANSACTION_TYPES } from "../schema/index.js";
import { eq, desc, count } from "drizzle-orm";

const router = Router();

const EthAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Invalid Ethereum address");
const TxHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Invalid transaction hash");

const GetTransactionsParams = z.object({ walletAddress: EthAddress });

const GetTransactionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const RecordTransactionBody = z.object({
  walletAddress: EthAddress,
  txHash: TxHash,
  type: z.enum(TRANSACTION_TYPES),
  tokenAddress: EthAddress,
  tokenSymbol: z.string().min(1).max(20),
  tokenName: z.string().min(1).max(100),
  amount: z.string().regex(/^d+$/, "Amount must be a non-negative integer string"),
  fromAddress: EthAddress,
  toAddress: EthAddress.optional(),
  networkId: z.number().int().positive(),
});

router.get("/transactions/:walletAddress", async (req, res) => {
  const params = GetTransactionsParams.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: "Invalid wallet address" });
  }

  const query = GetTransactionsQuery.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: "Invalid query params", details: query.error.flatten() });
  }

  const address = params.data.walletAddress.toLowerCase();
  const { limit, offset } = query.data;

  const [rows, totalResult] = await Promise.all([
    db
      .select()
      .from(transactionsTable)
      .where(eq(transactionsTable.walletAddress, address))
      .orderBy(desc(transactionsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: count() })
      .from(transactionsTable)
      .where(eq(transactionsTable.walletAddress, address)),
  ]);

  return res.json({
    transactions: rows,
    total: Number(totalResult[0]?.count ?? 0),
    limit,
    offset,
  });
});

router.post("/transactions", async (req, res) => {
  const body = RecordTransactionBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: "Invalid request body", details: body.error.flatten() });
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
