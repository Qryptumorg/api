import { Router } from "express";
import { ethers } from "ethers";
import { pbkdf2 } from "node:crypto";
import { promisify } from "node:util";

const pbkdf2Async = promisify(pbkdf2);
const router = Router();

// ─── Config ───────────────────────────────────────────────────────────────────
const PROOF_SALT = process.env.PROOF_SALT ?? "";
const DRPC_API_KEY = process.env.DRPC_API_KEY ?? "";
const MAINNET_RPC = DRPC_API_KEY
  ? `https://lb.drpc.org/ogrpc?network=ethereum&dkey=${DRPC_API_KEY}`
  : (process.env.MAINNET_RPC_URL ?? "https://ethereum-rpc.publicnode.com");
const DEPLOYER_PK = process.env.DEPLOYER_PRIVATE_KEY ?? "";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";
const USDC_MAINNET = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

// CONTEST_VAULT_ADDRESS is set after deployment
let runtimeVaultAddress: string = process.env.CONTEST_VAULT_ADDRESS ?? "";

// ─── QryptSafeExperiment compiled bytecode & ABI ─────────────────────────────
// Compiled from QryptSafeExperiment.sol (solc 0.8.34, optimizer 200 runs)
// No msg.sender check — OTP proof is the only auth factor
const EXPERIMENT_BYTECODE =
  "0x60a0604052348015600e575f5ffd5b506040516109b83803806109b8833981016040819052602b916039565b5f553360805242600255604f565b5f602082840312156048575f5ffd5b5051919050565b60805161094a61006e5f395f818161011d01526101bf015261094a5ff3fe60806040526004361061007b575f3560e01c8063d5f394881161004c578063d5f394881461010c578063e819301814610157578063e834a83414610176578063eae4c19f1461019f575f5ffd5b80628f51c614610086578063084fe72f146100ad5780631b0380de146100ce5780636d9ff542146100ed575f5ffd5b3661008257005b5f5ffd5b348015610091575f5ffd5b5061009a5f5481565b6040519081526020015b60405180910390f35b3480156100b8575f5ffd5b506100cc6100c73660046107c9565b6101b4565b005b3480156100d9575f5ffd5b506100cc6100e83660046107fa565b61034c565b3480156100f8575f5ffd5b506100cc61010736600461083b565b61052c565b348015610117575f5ffd5b5061013f7f000000000000000000000000000000000000000000000000000000000000000081565b6040516001600160a01b0390911681526020016100a4565b348015610162575f5ffd5b506100cc610171366004610852565b6105ec565b348015610181575f5ffd5b5060015461018f9060ff1681565b60405190151581526020016100a4565b3480156101aa575f5ffd5b5061009a60025481565b336001600160a01b037f000000000000000000000000000000000000000000000000000000000000000016146102205760405162461bcd60e51b815260206004820152600c60248201526b2737ba103232b83637bcb2b960a11b60448201526064015b60405180910390fd5b600254610230906276a70061088b565b421161026a5760405162461bcd60e51b8152602060048201526009602482015268546f6f206561726c7960b81b6044820152606401610217565b6040516370a0823160e01b81523060048201525f906001600160a01b038416906370a0823190602401602060405180830381865afa1580156102ae573d5f5f3e3d5ffd5b505050506040513d601f19601f820116820180604052508101906102d291906108b0565b60405163a9059cbb60e01b81526001600160a01b038481166004830152602482018390529192509084169063a9059cbb906044016020604051808303815f875af1158015610322573d5f5f3e3d5ffd5b505050506040513d601f19601f8201168201806040525081019061034691906108c7565b50505050565b60015460ff16156103975760405162461bcd60e51b815260206004820152601560248201527415985d5b1d08185b1c9958591e4818db185a5b5959605a1b6044820152606401610217565b6001600160a01b0382166103de5760405162461bcd60e51b815260206004820152600e60248201526d16995c9bc81c9958da5c1a595b9d60921b6044820152606401610217565b5f54604080516020810187905201604051602081830303815290604052805190602001201461041f5760405162461bcd60e51b8152600401610217906108ed565b6001805460ff1916811790555f84905560405163a9059cbb60e01b81526001600160a01b0383811660048301526024820183905284169063a9059cbb906044015b6020604051808303815f875af115801561047c573d5f5f3e3d5ffd5b505050506040513d601f19601f820116820180604052508101906104a091906108c7565b6104de5760405162461bcd60e51b815260206004820152600f60248201526e151c985b9cd9995c8819985a5b1959608a1b6044820152606401610217565b604080516001600160a01b0385811682526020820184905284169133917f6cab958d7fbd0eba6bc1018afa64536d89c45f4248d596237343a8d3810b187e910160405180910390a350505050565b60015460ff16156105715760405162461bcd60e51b815260206004820152600f60248201526e105b1c9958591e4818db185a5b5959608a1b6044820152606401610217565b5f5460408051602081018490520160405160208183030381529060405280519060200120146105b25760405162461bcd60e51b8152600401610217906108ed565b5f8190556040518181527f4ffc70022ca77f82460c7e373b5bb33c4ebef8e0c6463b32afbf93e0593cdc619060200160405180910390a150565b60015460ff16156106375760405162461bcd60e51b815260206004820152601560248201527415985d5b1d08185b1c9958591e4818db185a5b5959605a1b6044820152606401610217565b6001600160a01b03811661067e5760405162461bcd60e51b815260206004820152600e60248201526d16995c9bc81c9958da5c1a595b9d60921b6044820152606401610217565b5f5460408051602081018690520160405160208183030381529060405280519060200120146106bf5760405162461bcd60e51b8152600401610217906108ed565b6001805460ff1916811790555f8381556040516370a0823160e01b81523060048201526001600160a01b038416906370a0823190602401602060405180830381865afa158015610711573d5f5f3e3d5ffd5b505050506040513d601f19601f8201168201806040525081019061073591906108b0565b90505f81116107795760405162461bcd60e51b815260206004820152601060248201526f4e6f7468696e6720746f20636c61696d60801b6044820152606401610217565b60405163a9059cbb60e01b81526001600160a01b0383811660048301526024820183905284169063a9059cbb90604401610460565b80356001600160a01b03811681146107c4575f5ffd5b919050565b5f5f604083850312156107da575f5ffd5b6107e3836107ae565b91506107f1602084016107ae565b90509250929050565b5f5f5f5f6080858703121561080d575f5ffd5b8435935061081d602086016107ae565b925061082b604086016107ae565b9396929550929360600135925050565b5f6020828403121561084b575f5ffd5b5035919050565b5f5f5f60608486031215610864575f5ffd5b83359250610874602085016107ae565b9150610882604085016107ae565b90509250925092565b808201808211156108aa57634e487b7160e01b5f52601160045260245ffd5b92915050565b5f602082840312156108c0575f5ffd5b5051919050565b5f602082840312156108d7575f5ffd5b815180151581146108e6575f5ffd5b9392505050565b6020808252600d908201526c24b73b30b634b210383937b7b360991b60408201526060019056fea264697066735822122004e41392966334d20aa4af6db65cd255e3b9b317ac7e65226466a7344867e2a164736f6c63430008220033";

const EXPERIMENT_ABI = [
  { type: "function", name: "chainHead", inputs: [], outputs: [{ type: "bytes32" }], stateMutability: "view" },
  { type: "function", name: "claimed", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "deployer", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "claimAll", inputs: [{ name: "proof", type: "bytes32" }, { name: "token", type: "address" }, { name: "recipient", type: "address" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "claimAmount", inputs: [{ name: "proof", type: "bytes32" }, { name: "token", type: "address" }, { name: "recipient", type: "address" }, { name: "amount", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "advanceChain", inputs: [{ name: "proof", type: "bytes32" }], outputs: [], stateMutability: "nonpayable" },
  { type: "constructor", inputs: [{ name: "initialChainHead", type: "bytes32" }], stateMutability: "nonpayable" },
] as const;

const ERC20_BALANCE_ABI = [
  { type: "function", name: "balanceOf", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validateProofFormat(proof: string): boolean {
  if (proof.length !== 6) return false;
  let letters = 0, digits = 0;
  for (const c of proof) {
    if (/[a-zA-Z]/.test(c)) letters++;
    else if (/[0-9]/.test(c)) digits++;
    else return false;
  }
  return letters === 3 && digits === 3;
}

async function deriveH0(vaultProof: string, vaultAddress: string): Promise<string> {
  const saltStr = vaultAddress.toLowerCase() + PROOF_SALT;
  const key = await pbkdf2Async(
    Buffer.from(vaultProof, "utf8"),
    Buffer.from(saltStr, "utf8"),
    200_000,
    32,
    "sha256"
  );
  return "0x" + key.toString("hex");
}

function keccak256Chain(h: string, steps: number): string {
  for (let i = 0; i < steps; i++) {
    h = ethers.keccak256(h);
  }
  return h;
}

/**
 * Scan H0→H1→...→H100 to find Hn where keccak256(Hn) === chainHead.
 * Returns the valid proof (Hn) or null if the password is wrong.
 */
function findValidProof(H0: string, chainHead: string): string | null {
  let prev = H0;
  for (let i = 0; i < 100; i++) {
    const next = ethers.keccak256(prev);
    if (next === chainHead) return prev; // prev = H{i}, keccak256(H{i}) = chainHead
    prev = next;
  }
  return null;
}

function getProvider() {
  return new ethers.JsonRpcProvider(MAINNET_RPC);
}

function getDeployerSigner() {
  if (!DEPLOYER_PK) throw new Error("DEPLOYER_PRIVATE_KEY not set");
  return new ethers.Wallet(DEPLOYER_PK, getProvider());
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /contest/status
 * Returns current state of the Experiment vault.
 */
router.get("/contest/status", async (_req, res) => {
  const vaultAddress = runtimeVaultAddress;
  if (!vaultAddress) {
    return res.json({ deployed: false, active: false, vaultAddress: null, balance: "0" });
  }

  try {
    const provider = getProvider();
    const vault = new ethers.Contract(vaultAddress, EXPERIMENT_ABI, provider);
    const usdc = new ethers.Contract(USDC_MAINNET, ERC20_BALANCE_ABI, provider);

    const [claimed, balance] = await Promise.all([
      vault.claimed() as Promise<boolean>,
      usdc.balanceOf(vaultAddress) as Promise<bigint>,
    ]);

    return res.json({
      deployed: true,
      active: !claimed,
      claimed,
      vaultAddress,
      balance: balance.toString(),
      balanceFormatted: (Number(balance) / 1e6).toFixed(2),
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: "RPC error", details: String(err) });
  }
});

/**
 * POST /contest/setup
 * Admin only. Deploys the QryptSafeExperiment vault.
 * Body: { vaultProof: string, adminToken: string }
 */
router.post("/contest/setup", async (req, res) => {
  const { vaultProof, adminToken } = req.body as { vaultProof?: string; adminToken?: string };

  if (!ADMIN_TOKEN || adminToken !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "Invalid admin token" });
  }
  if (!vaultProof || !validateProofFormat(vaultProof)) {
    return res.status(400).json({ error: "Invalid vault proof. Need exactly 3 letters + 3 digits (e.g. abc123)" });
  }

  try {
    const signer = getDeployerSigner();
    const nonce = await signer.getNonce();
    const futureAddress = ethers.getCreateAddress({ from: signer.address, nonce });

    // Derive H0 using the future vault address (matches how password.ts does it)
    const H0 = await deriveH0(vaultProof, futureAddress);

    // Compute H100 = initialChainHead
    const H100 = keccak256Chain(H0, 100);

    // Deploy QryptSafeExperiment(H100)
    const factory = new ethers.ContractFactory(EXPERIMENT_ABI, EXPERIMENT_BYTECODE, signer);
    const contract = await factory.deploy(H100);
    const deployTx = contract.deploymentTransaction();
    await contract.waitForDeployment();
    const deployedAddress = await contract.getAddress();

    // Cache in memory (survives until restart)
    runtimeVaultAddress = deployedAddress;

    return res.json({
      vaultAddress: deployedAddress,
      chainHead: H100,
      deployTxHash: deployTx?.hash ?? null,
      note: `Set env CONTEST_VAULT_ADDRESS=${deployedAddress} and restart to persist across restarts`,
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: String(err) });
  }
});

/**
 * POST /contest/preview
 * Admin only. Previews H100 without deploying.
 * Body: { vaultProof: string, adminToken: string }
 */
router.post("/contest/preview", async (req, res) => {
  const { vaultProof, adminToken } = req.body as { vaultProof?: string; adminToken?: string };

  if (!ADMIN_TOKEN || adminToken !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "Invalid admin token" });
  }
  if (!vaultProof || !validateProofFormat(vaultProof)) {
    return res.status(400).json({ error: "Invalid vault proof format" });
  }

  try {
    const signer = getDeployerSigner();
    const nonce = await signer.getNonce();
    const futureAddress = ethers.getCreateAddress({ from: signer.address, nonce });
    const H0 = await deriveH0(vaultProof, futureAddress);
    const H100 = keccak256Chain(H0, 100);

    return res.json({
      futureVaultAddress: futureAddress,
      chainHead: H100,
      deployerAddress: signer.address,
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: String(err) });
  }
});

/**
 * POST /contest/claim
 * Public. Attempt to claim the Experiment vault.
 * Body: { vaultProof: string, recipient: string }
 * QryptumSigner broadcasts the TX if proof is valid.
 */
router.post("/contest/claim", async (req, res) => {
  const { vaultProof, recipient } = req.body as { vaultProof?: string; recipient?: string };

  const vaultAddress = runtimeVaultAddress;
  if (!vaultAddress) {
    return res.status(503).json({ error: "Experiment vault not deployed yet. Check back soon." });
  }

  if (!vaultProof || typeof vaultProof !== "string") {
    return res.status(400).json({ error: "Missing vault proof" });
  }
  if (!recipient || !ethers.isAddress(recipient)) {
    return res.status(400).json({ error: "Invalid recipient address" });
  }

  try {
    const provider = getProvider();
    const vault = new ethers.Contract(vaultAddress, EXPERIMENT_ABI, provider);

    // Check if already claimed
    const alreadyClaimed = await vault.claimed() as boolean;
    if (alreadyClaimed) {
      return res.status(410).json({ error: "Vault already claimed. Contest over." });
    }

    // Read current chain head from contract
    const chainHead = await vault.chainHead() as string;

    // Derive H0 from the guess
    const H0 = await deriveH0(vaultProof, vaultAddress);

    // Scan for matching proof
    const proof = findValidProof(H0, chainHead);
    if (!proof) {
      return res.status(400).json({ error: "Wrong vault proof. Try again." });
    }

    // Broadcast via QryptumSigner
    const signer = getDeployerSigner();
    const vaultWithSigner = new ethers.Contract(vaultAddress, EXPERIMENT_ABI, signer);

    const tx = await (vaultWithSigner as any).claimAll(proof, USDC_MAINNET, recipient);
    const receipt = await tx.wait();

    return res.json({
      success: true,
      txHash: receipt.hash,
      recipient,
      broadcaster: signer.address,
    });
  } catch (err: unknown) {
    const msg = String(err);
    if (msg.includes("Invalid proof")) {
      return res.status(400).json({ error: "Wrong vault proof. Try again." });
    }
    if (msg.includes("Already claimed")) {
      return res.status(410).json({ error: "Vault already claimed." });
    }
    return res.status(500).json({ error: msg });
  }
});

/**
 * POST /contest/set-vault
 * Admin only. Update the vault address at runtime (e.g. after manual deploy).
 */
router.post("/contest/set-vault", (req, res) => {
  const { vaultAddress, adminToken } = req.body as { vaultAddress?: string; adminToken?: string };
  if (!ADMIN_TOKEN || adminToken !== ADMIN_TOKEN) return res.status(401).json({ error: "Unauthorized" });
  if (!vaultAddress || !ethers.isAddress(vaultAddress)) return res.status(400).json({ error: "Invalid address" });
  runtimeVaultAddress = vaultAddress;
  return res.json({ ok: true, vaultAddress });
});

// ─── Auto-deploy on startup ───────────────────────────────────────────────────
// If CONTEST_VAULT_PROOF env var is set and no vault is deployed yet,
// auto-deploy QryptSafeExperiment when the module loads.
// Flow: set DEPLOYER_PRIVATE_KEY + CONTEST_VAULT_PROOF in Railway, restart API.

const CONTEST_VAULT_PROOF = process.env.CONTEST_VAULT_PROOF ?? "";

async function autoDeployIfNeeded(): Promise<void> {
  if (runtimeVaultAddress) {
    console.log("[contest] Vault already set:", runtimeVaultAddress);
    return;
  }
  if (!CONTEST_VAULT_PROOF || !validateProofFormat(CONTEST_VAULT_PROOF)) {
    return; // No proof configured — skip auto-deploy
  }
  if (!DEPLOYER_PK) {
    console.warn("[contest] DEPLOYER_PRIVATE_KEY not set — skipping auto-deploy");
    return;
  }

  try {
    console.log("[contest] Auto-deploying QryptSafeExperiment...");
    const signer = getDeployerSigner();
    const nonce = await signer.getNonce();
    const futureAddress = ethers.getCreateAddress({ from: signer.address, nonce });

    const H0 = await deriveH0(CONTEST_VAULT_PROOF, futureAddress);
    const H100 = keccak256Chain(H0, 100);

    const factory = new ethers.ContractFactory(EXPERIMENT_ABI, EXPERIMENT_BYTECODE, signer);
    const contract = await factory.deploy(H100);
    await contract.waitForDeployment();
    const deployedAddr = await contract.getAddress();

    runtimeVaultAddress = deployedAddr;
    console.log("[contest] QryptSafeExperiment deployed:", deployedAddr);
    console.log("[contest] chainHead (H100):", H100);
    console.log("[contest] Set CONTEST_VAULT_ADDRESS=" + deployedAddr + " in env to persist across restarts");
  } catch (err) {
    console.error("[contest] Auto-deploy failed:", err);
  }
}

// Fire and forget — does not block route registration
autoDeployIfNeeded();

export default router;
