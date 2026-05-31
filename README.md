# 📈 $DELL — the machine pays you back in Dell

> **Hold the coin. Get paid in real Dell.**

A pump.fun coin with an automated **claim → buy DELL → airdrop every holder** loop. One stock, all Dell.

Every `CYCLE_INTERVAL_SECONDS` (default **300s = 5 min**):

1. The bot **claims** pump.fun creator fees (SOL) on the treasury (dev) wallet.
2. It **buys real tokenized Dell** — the verified Backed/xStocks **DELLx** token — on **Jupiter** with the spendable share of the claim.
3. It **snapshots every $DELL holder** and keeps wallets holding **≥ `MIN_HOLDER_BALANCE`** (default **500,000**).
4. It **airdrops the DELL to every qualified holder, proportional to how much they hold**, routed through fresh bot-generated relay wallets straight into their wallet.

This is the exact same engine as the 12-stock version — only the rotation changed: **it's just DELL now.**

## The Dell token

Real tokenized Dell equity on Solana (Token-2022, 8 decimals), issued by Backed Finance, distributed as an xStock, tradeable on Jupiter:

```
DELLx  →  Xsu7Tc5J2fVUE4H5vYAiSr34cvLJeCsYPMjAYnayQn6
```

✅ Verified on Jupiter (`isVerified`), confirmed on-chain (Token-2022 program owner) and on xstocks.com.
⚠️ **Fake "DELLx" impostors exist on pump.fun** — this `Xsu7…` address is the only legitimate one and is hard-wired in `src/rotation.ts`.
ℹ️ DELLx liquidity is thinner than flagship xStocks, so large buys will have slippage (`SWAP_SLIPPAGE_BPS`).

## 🚀 Deploy on Railway

1. **New Project → Deploy from GitHub repo** → pick `CONTINAD/DE`.
2. **Add a Postgres database** (so lifetime totals never reset): `+ New → Database → Add PostgreSQL`.
3. **Variables** — set:
   | Variable | Value |
   |---|---|
   | `SOLANA_RPC_URL` | your paid Helius/QuickNode/Triton URL |
   | `CREATOR_WALLET_PRIVATE_KEY` | **your new dev wallet's** base58 private key (the wallet that owns the $DELL pump.fun token) |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
   | `XSTOCKS_MINT` | `auto` (or hard-code your $DELL mint once it's live) |

   Everything else has sane defaults — see [.env.example](.env.example) for the full list.
4. **Networking → Generate Domain** → that's the URL you point your domain at (CNAME).

The build/start is already wired in [railway.json](railway.json) (`npm install && npm run build` → `npm start`).

### 🔒 Persistence — totals never reset
With `DATABASE_URL` set, the **entire dashboard state** (total DELL shipped, SOL spent, holder payouts, cycles, per-holder history) is snapshotted to Postgres each cycle and reloaded on boot, so **nothing resets across redeploys** (`src/store.ts`). Without it, state falls back to a local JSON file which is **ephemeral on Railway** — so always add the Postgres DB in production.

## Local dev

```bash
npm install
cp .env.example .env     # fill in SOLANA_RPC_URL + CREATOR_WALLET_PRIVATE_KEY
npm run build
npm start                # dashboard at http://localhost:3000
```

## Architecture

- [src/index.ts](src/index.ts) — cycle loop: claim → buy DELL → snapshot → proportional airdrop → reconcile ledger
- [src/rotation.ts](src/rotation.ts) — the verified DELLx mint (single-stock rotation)
- [src/swap.ts](src/swap.ts) — Jupiter quote + swap (SOL → DELL), measured by token-balance delta
- [src/payout.ts](src/payout.ts) — proportional Token-2022 airdrop via fresh treasury → relay → holders atomic batches
- [src/claim-rewards.ts](src/claim-rewards.ts) — pump.fun creator-fee claim with retry + priority escalation
- [src/holders.ts](src/holders.ts) — per-owner $DELL holder snapshot (needs a paid RPC)
- [src/store.ts](src/store.ts) — durable persistence: Postgres (JSONB) with local JSON fallback
- [src/dashboard.ts](src/dashboard.ts) — Express server + the live animated dashboard

## Links
- X: [@DellStocksSol](https://x.com/DellStocksSol)

---

Memecoin. Entertainment only — not financial advice and not an offer of securities. The project buys the tokenized-equity token "DELLx" (an xStock issued by Backed Finance, a third party) on the open market with claimed creator fees and distributes it proportionally to qualifying holders; amounts vary and can be zero. DELLx, xStocks, Backed, and Dell Technologies are not affiliated with this project. No payout or outcome is guaranteed.
