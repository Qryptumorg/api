import * as zod from "zod";

  export const HealthCheckResponse = zod.object({ status: zod.string() });
  export const HealthCheckFullResponse = zod.object({ status: zod.string(), db: zod.string() });
  export const GetVaultParams = zod.object({ walletAddress: zod.coerce.string() });
  export const GetVaultResponse = zod.object({ id: zod.number(), walletAddress: zod.string(), vaultContractAddress: zod.string().nullable().optional(), networkId: zod.number(), createdAt: zod.coerce.date(), exists: zod.boolean() });
  export const RegisterVaultBody = zod.object({ walletAddress: zod.string(), vaultContractAddress: zod.string().optional(), proofHashSalted: zod.string().optional(), networkId: zod.number().optional() });
  export const VerifyVaultBody = zod.object({ walletAddress: zod.string() });
  export const VaultExistsResponse = zod.object({ exists: zod.boolean() });
  export const GetTransactionsParams = zod.object({ walletAddress: zod.coerce.string() });
  export const getTransactionsQueryLimitDefault = 50;
  export const getTransactionsQueryOffsetDefault = 0;
  export const GetTransactionsQueryParams = zod.object({ limit: zod.coerce.number().default(50), offset: zod.coerce.number().default(0) });
  export const GetTransactionsResponse = zod.object({ transactions: zod.array(zod.object({ id: zod.number(), walletAddress: zod.string(), txHash: zod.string(), type: zod.enum(["shield", "unshield", "transfer", "receive", "fund", "reclaim", "voucher", "air-send", "air-receive"]), tokenAddress: zod.string(), tokenSymbol: zod.string(), tokenName: zod.string(), amount: zod.string(), fromAddress: zod.string(), toAddress: zod.string().nullable().optional(), networkId: zod.number(), createdAt: zod.coerce.date() })), total: zod.number() });
  export const RecordTransactionBody = zod.object({ walletAddress: zod.string(), txHash: zod.string(), type: zod.enum(["shield", "unshield", "transfer", "receive", "fund", "reclaim", "voucher", "air-send", "air-receive"]), tokenAddress: zod.string(), tokenSymbol: zod.string(), tokenName: zod.string(), amount: zod.string(), fromAddress: zod.string(), toAddress: zod.string().optional(), networkId: zod.number() });
  