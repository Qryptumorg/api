import { Router } from "express";
import { pbkdf2 } from "node:crypto";
import { promisify } from "node:util";

const pbkdf2Async = promisify(pbkdf2);
const router = Router();

const PROOF_SALT = process.env.PROOF_SALT ?? "";

if (!PROOF_SALT) {
  console.warn("[proof] PROOF_SALT env var not set — H0 derivation will use empty salt");
}

router.post("/generate-h0", async (req, res) => {
  const { vaultProof, vaultAddress } = req.body as {
    vaultProof?: string;
    vaultAddress?: string;
  };

  if (
    typeof vaultProof !== "string" ||
    vaultProof.length !== 6 ||
    typeof vaultAddress !== "string" ||
    !vaultAddress.startsWith("0x")
  ) {
    res.status(400).json({ error: "Invalid vaultProof or vaultAddress" });
    return;
  }

  const saltStr = vaultAddress.toLowerCase() + PROOF_SALT;

  const key = await pbkdf2Async(
    Buffer.from(vaultProof, "utf8"),
    Buffer.from(saltStr, "utf8"),
    200_000,
    32,
    "sha256"
  );

  res.json({ h0: "0x" + key.toString("hex") });
});

export default router;
