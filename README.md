# Qryptum API

[![License: MIT](https://img.shields.io/badge/License-MIT-white.svg)](LICENSE)

Backend API for the Qryptum protocol, built with Express and TypeScript.

## Endpoints

### Vaults

| Method | Path | Description |
|---|---|---|
| POST | /api/vaults | Register a new vault after on-chain creation |
| GET | /api/vaults/:walletAddress | Get vault metadata for a wallet |
| POST | /api/vault/verify | Check if a vault exists, returns `{ exists: boolean }` |

### Transactions

| Method | Path | Description |
|---|---|---|
| POST | /api/transactions | Record a new shield, unshield, or transfer operation |
| GET | /api/transactions/:address | Get the last 50 transactions for a wallet, newest first |

### Health

| Method | Path | Description |
|---|---|---|
| GET | /api/health | Returns `{ status: "ok", db: "connected" }` with a live DB ping |

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

## Environment Variables

| Variable | Description |
|---|---|
| PORT | Server port (default: 8080) |
| DATABASE_URL | PostgreSQL connection string |
| SESSION_SECRET | Express session secret |
| PROOF_SALT | Salt for hashing vault proofs server-side |

## Security Notes

- The server never receives or stores raw vault proofs
- All vault proof verification happens on-chain via the smart contracts
- PROOF_SALT is used only for server-side proof hash storage, never exposed to clients

## License

[![License: MIT](https://img.shields.io/badge/License-MIT-white.svg)](LICENSE)

Copyright (c) 2026 [wei-zuan](https://github.com/wei-zuan). See [LICENSE](LICENSE) for full terms.
