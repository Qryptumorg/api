import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const vaultsTable = pgTable("vaults", {
  id: serial("id").primaryKey(),
  walletAddress: text("wallet_address").notNull().unique(),
  vaultContractAddress: text("vault_contract_address"),
  networkId: integer("network_id").notNull().default(11155111),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
