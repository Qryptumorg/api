import { Router } from "express";
import { db } from "@workspace/db";
import { vaultsTable } from "@workspace/db/schema";
import {
  GetVaultParams,
  RegisterVaultBody,
  VerifyVaultBody,
} from "@workspace/api-zod";
import { eq } from "drizzle-orm";
import crypto from "crypto";

const router = Router();

function hashProof(raw: string): string {
  const salt = process.env["PROOF_SALT"] ?? "qryptum-default-salt";
  return crypto.pbkdf2Sync(raw, salt, 100_000, 64, "sha512").toString("hex");
}

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
    return res.status(400).json({ error: "Invalid request body" });
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

  const proofHashSalted = body.data.proofHashSalted
    ? hashProof(body.data.proofHashSalted)
    : null;

  const inserted = await db
    .insert(vaultsTable)
    .values({
      walletAddress: address,
      vaultContractAddress: body.data.vaultContractAddress
        ? body.data.vaultContractAddress.toLowerCase()
        : null,
      proofHashSalted,
      networkId: body.data.networkId ?? 11155111,
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
