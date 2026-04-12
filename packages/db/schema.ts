import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
  import { createInsertSchema } from "drizzle-zod";
  import { z } from "zod";

  export const vaultsTable = pgTable("vaults", {
      id: serial("id").primaryKey(),
      walletAddress: text("wallet_address").notNull().unique(),
      vaultContractAddress: text("vault_contract_address"),
      proofHashSalted: text("proof_hash_salted"),
      networkId: integer("network_id").notNull().default(11155111),
      createdAt: timestamp("created_at").defaultNow().notNull(),
  });

  export const transactionsTable = pgTable("transactions", {
      id: serial("id").primaryKey(),
      walletAddress: text("wallet_address").notNull(),
      txHash: text("tx_hash").notNull().unique(),
      type: text("type").notNull(),
      tokenAddress: text("token_address").notNull(),
      tokenSymbol: text("token_symbol").notNull(),
      tokenName: text("token_name").notNull(),
      amount: text("amount").notNull(),
      fromAddress: text("from_address").notNull(),
      toAddress: text("to_address"),
      networkId: integer("network_id").notNull().default(11155111),
      createdAt: timestamp("created_at").defaultNow().notNull(),
  });

  export const insertVaultSchema = createInsertSchema(vaultsTable).omit({ id: true, createdAt: true });
  export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({ id: true, createdAt: true });
  