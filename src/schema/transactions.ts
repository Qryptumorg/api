import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const TRANSACTION_TYPES = ["shield", "unshield", "transfer"] as const;
export type TransactionType = typeof TRANSACTION_TYPES[number];

export const transactionsTable = pgTable("transactions", {
  id: serial("id").primaryKey(),
  walletAddress: text("wallet_address").notNull(),
  txHash: text("tx_hash").notNull().unique(),
  type: text("type").$type<TransactionType>().notNull(),
  tokenAddress: text("token_address").notNull(),
  tokenSymbol: text("token_symbol").notNull(),
  tokenName: text("token_name").notNull(),
  amount: text("amount").notNull(),
  fromAddress: text("from_address").notNull(),
  toAddress: text("to_address"),
  networkId: integer("network_id").notNull().default(11155111),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
