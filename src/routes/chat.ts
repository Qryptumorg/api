import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
    ?? process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY
    ?? "no-key",
  ...(process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
    ? { baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL }
    : {}),
});

const router = Router();

const QRYPTUM_SYSTEM_PROMPT = `You are Ask Qryptum, an AI assistant embedded in the official Qryptum documentation site. You have deep expertise on the Qryptum V6 protocol and answer questions clearly, accurately, and concisely.

ABOUT QRYPTUM:
Qryptum is a non-custodial protocol on Ethereum L1 that lets users shield ERC-20 tokens inside a personal cryptographic vault called a QryptSafe. Once shielded, tokens are tracked by non-transferable qTokens. Vault access requires both the owner wallet AND a one-time-password (OTP) proof derived from a keccak256 chain. The OTP layer uses keccak256 (SHA-3 family) which retains 128-bit security under quantum attacks.

ARCHITECTURE (V6):
Each user deploys their own PersonalQryptSafeV6 smart contract via the QryptSafeV6 factory. The vault holds real ERC-20 tokens and issues non-transferable qTokens as receipts. No third party has access. The deployer has zero admin keys.

OTP CHAIN:
- Before creating a vault, the user picks a secret and hashes it 100 times with keccak256.
- proofs[99] = chain head, committed to the contract as initialChainHead (bytes32).
- Each vault operation consumes one proof in descending order: proofs[98], proofs[97], etc.
- When proofs run out, the user calls commitChain to load a new chain.
- Proofs are never stored on any server; they are generated locally by the user.

DUAL-FACTOR PROTECTION:
Every vault operation requires both the Ethereum private key (onlyOwner modifier) AND the current OTP proof simultaneously. An attacker with only the private key cannot move tokens because the OTP check fails. An attacker with only the proof cannot call vault functions because onlyOwner blocks them.

qTOKENS:
Non-transferable receipt tokens issued when real ERC-20 tokens are qrypted. transfer(), transferFrom(), and approve() always revert unconditionally at the contract level. No wallet, DEX, or tool can move them.

KEY OPERATIONS:
- qrypt(token, amount, otpProof): Deposit real ERC-20 tokens into the QryptSafe. Mints qTokens 1:1 to the user wallet. Consumes one OTP proof.
- unqrypt(token, amount, otpProof): Withdraw real tokens from the vault. Burns qTokens and returns the real ERC-20 tokens. Consumes one OTP proof.
- commitChain(newChainHead, otpProof): Load a new 100-proof OTP chain when the current one is exhausted.
- createQryptSafe(initialChainHead): Factory function. Deploys a personal vault for msg.sender.
- getQryptSafe(owner): Factory read. Returns the vault address for a given wallet.

QRYPTAIR:
QryptAir is the offline transfer feature. The user creates an offToken and QR code entirely offline. The recipient redeems it on-chain without any prior setup. Only the main dashboard (qryptum.eth.limo) handles receiving; QryptAir handles sending and history.
- offToken naming: "off" + tokenSymbol (e.g. offUSDC).
- The user funds an air budget, signs the offToken with the current OTP proof (no internet needed at signing time), then shares the QR code.

SMART CONTRACTS (Sepolia testnet, V6 ACTIVE):
- QryptSafeV6 Factory: 0xeaa722e996888b662E71aBf63d08729c6B6802F4
- Sepolia USDC (for testing): 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
- Mainnet contracts: pending deployment.

SECURITY MODEL:
Post-Quantum: keccak256 is only weakened by Grover algorithm, giving quadratic speedup. A 256-bit hash retains 128-bit security against quantum adversaries, the NIST post-quantum minimum.

Attack Scenarios (all fail):
- Send qToken via MetaMask: transfer() always reverts.
- Approve a DEX to spend qToken: approve() always reverts.
- Call vault with wrong OTP proof: OTP check fails.
- Call vault from different wallet: onlyOwner blocks.
- Replay a used proof: chain position already advanced.
- Reentrancy attack: ReentrancyGuard from OpenZeppelin.

FACTORY SELECTOR:
- createQryptSafe = 0x7db67f4c, param: initialChainHead (bytes32)

FAQ:
Q: What if I run out of OTP proofs?
A: Call commitChain on your vault with the next OTP chain head and your last remaining proof. This loads a fresh 100-proof chain.

Q: Can Qryptum access my funds?
A: No. Qryptum has zero admin keys. The protocol is fully non-custodial. Code is open source and verifiable on Etherscan.

Q: What is the minimum qrypt amount?
A: 1,000,000 token units (prevents dust attacks).

Q: How does QryptAir work offline?
A: The user signs the offToken with their OTP proof locally. The signature is self-contained in the QR code. The recipient redeems it on-chain; no server is involved at signing time.

TONE: Be concise, technical when appropriate, and honest about limitations. Do not make claims beyond what the protocol actually provides. If asked something outside Qryptum scope, say so clearly.

FORMATTING RULE: Never use the em dash character or the pattern " - " as a substitute em dash. Use a colon, comma, or rewrite the sentence instead.`;

router.post("/chat", async (req, res) => {
  try {
    const { messages, lang } = req.body as {
      messages: Array<{ role: "user" | "assistant"; content: string }>;
      lang?: string;
    };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "messages array is required" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const langNames: Record<string, string> = {
      en: "English", ru: "Russian", zh: "Chinese", id: "Indonesian", ms: "Malay",
      es: "Spanish", fr: "French", de: "German", ja: "Japanese", ko: "Korean", pt: "Portuguese",
    };
    const langCode = (lang ?? "en").toLowerCase().split("-")[0];
    const langName = langNames[langCode] ?? "English";
    const systemPrompt = langCode === "en"
      ? QRYPTUM_SYSTEM_PROMPT
      : `${QRYPTUM_SYSTEM_PROMPT}\n\nLANGUAGE RULE: The user interface language is ${langName}. Always respond entirely in ${langName}, including all technical terms where a standard translation exists. Only keep code snippets and contract addresses in their original form.`;

    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: systemPrompt,
      messages,
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        res.write(`data: ${JSON.stringify({ content: event.delta.text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    console.error("Chat error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to process chat request" });
    } else {
      res.write(`data: ${JSON.stringify({ error: "Stream interrupted" })}\n\n`);
      res.end();
    }
  }
});

export default router;
