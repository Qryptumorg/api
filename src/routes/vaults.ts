import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db";
import { vaultsTable } from "../schema";
import { eq } from "drizzle-orm";

const router = Router();

const EthAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Invalid Ethereum address");

const GetVaultParams = z.object({ walletAddress: EthAddress });

const RegisterVaultBody = z.object({
  walletAddress: EthAddress,
  vaultContractAddress: EthAddress,
  networkId: z.number().int().positive(),
});

const VerifyVaultBody = z.object({
  walletAddress: EthAddress,
});

router.get("/vaults/:walletAddress", async (req, res) => {
  const params = GetVaultParams.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: "Invalid wallet address" });
  }

  const vault = await db
    .select()
    .from(vaultsTable)
    .where(eq(vaultsTable.walletAddress, params.data.walletAddress.toLowerCase()))
    .limit(1);

  if (vault.length === 0) {
    return res.status(404).json({ error: "Vault not found" });
  }

  const v = vault[0]!;
  return res.json({
    id: v.id,
    walletAddress: v.walletAddress,
    vaultContractAddress: v.vaultContractAddress ?? null,
    networkId: v.networkId,
    createdAt: v.createdAt,
    exists: true,
  });
});

router.post("/vaults", async (req, res) => {
  const body = RegisterVaultBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: "Invalid request body", details: body.error.flatten() });
  }

  const address = body.data.walletAddress.toLowerCase();

  const existing = await db
    .select()
    .from(vaultsTable)
    .where(eq(vaultsTable.walletAddress, address))
    .limit(1);

  if (existing.length > 0) {
    const v = existing[0]!;
    return res.status(200).json({
      id: v.id,
      walletAddress: v.walletAddress,
      vaultContractAddress: v.vaultContractAddress ?? null,
      networkId: v.networkId,
      createdAt: v.createdAt,
      exists: true,
    });
  }

  const inserted = await db
    .insert(vaultsTable)
    .values({
      walletAddress: address,
      vaultContractAddress: body.data.vaultContractAddress.toLowerCase(),
      networkId: body.data.networkId,
    })
    .returning();

  const v = inserted[0]!;
  return res.status(201).json({
    id: v.id,
    walletAddress: v.walletAddress,
    vaultContractAddress: v.vaultContractAddress ?? null,
    networkId: v.networkId,
    createdAt: v.createdAt,
    exists: true,
  });
});

router.post("/vault/verify", async (req, res) => {
  const body = VerifyVaultBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const vault = await db
    .select({ id: vaultsTable.id })
    .from(vaultsTable)
    .where(eq(vaultsTable.walletAddress, body.data.walletAddress.toLowerCase()))
    .limit(1);

  return res.json({ exists: vault.length > 0 });
});

export default router;
