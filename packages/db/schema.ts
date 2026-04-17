import { pgTable, text, serial, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

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

export const airVouchersTable = pgTable("air_vouchers", {
    id: serial("id").primaryKey(),
    voucherId: text("voucher_id").notNull().unique(),
    walletAddress: text("wallet_address").notNull(),
    tokenAddress: text("token_address").notNull(),
    tokenSymbol: text("token_symbol").notNull(),
    amount: text("amount").notNull(),
    recipient: text("recipient").notNull(),
    vaultAddress: text("vault_address").notNull(),
    deadline: integer("deadline").notNull(),
    chainId: integer("chain_id").notNull().default(11155111),
    signature: text("signature").notNull(),
    qrData: text("qr_data").notNull(),
    status: text("status").notNull().default("pending"),
    isExpired: boolean("is_expired").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const railgunPendingTable = pgTable("railgun_pending", {
    id: serial("id").primaryKey(),
    walletAddress: text("wallet_address").notNull(),
    chainId: integer("chain_id").notNull(),
    atomicHash: text("atomic_hash").notNull(),
    tokenAddress: text("token_address").notNull(),
    tokenSymbol: text("token_symbol").notNull(),
    amount: text("amount").notNull(),
    recipient: text("recipient").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const kvStateTable = pgTable("kv_state", {
    key:       text("key").primaryKey(),
    value:     text("value").notNull(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertVaultSchema = createInsertSchema(vaultsTable).omit({ id: true, createdAt: true });
export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({ id: true, createdAt: true });
export const insertAirVoucherSchema = createInsertSchema(airVouchersTable).omit({ id: true, createdAt: true });
export const insertRailgunPendingSchema = createInsertSchema(railgunPendingTable).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertVault = z.infer<typeof insertVaultSchema>;
export type Vault = typeof vaultsTable.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactionsTable.$inferSelect;
export type InsertAirVoucher = z.infer<typeof insertAirVoucherSchema>;
export type AirVoucher = typeof airVouchersTable.$inferSelect;
export type InsertRailgunPending = z.infer<typeof insertRailgunPendingSchema>;
export type RailgunPending = typeof railgunPendingTable.$inferSelect;
