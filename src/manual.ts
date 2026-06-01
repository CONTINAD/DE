/**
 * One-shot MANUAL airdrop. Spends a FIXED amount of treasury SOL (default 5)
 * to buy the payable stock (DELL if tradable, else the first liquid fallback)
 * and airdrops it, proportionally, to every wallet holding ≥ MIN_HOLDER_BALANCE
 * $DELL — then exits. Does NOT claim fees and does NOT loop.
 *
 * Run it with the real wallet/RPC/DB injected from Railway, no secrets on disk:
 *     npm run build && railway run node dist/manual.js 5
 * The trailing number is the SOL budget (optional, defaults to 5).
 *
 * Add `dry` to preview qualified holders + buy size and spend NOTHING:
 *     railway run node dist/manual.js 5 dry
 */
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { config } from "./config";
import {
  loadTreasuryWallet,
  getSolBalance,
  ata2022,
  whichAtasExist,
  discoverAtaRent,
} from "./wallet";
import { snapshotHolders } from "./holders";
import { computeProportionalStockPayouts, dispenseStock, PAYOUT_BATCH_SIZE } from "./payout";
import { buyStock, resolvePayableStock } from "./swap";
import { stockForCycle } from "./rotation";
import { tracker } from "./activity";
import { logger } from "./logger";

const MIN_WALLET_KEEP_LAMPORTS = Math.floor(0.01 * LAMPORTS_PER_SOL);
const TX_FEE_RESERVE_LAMPORTS = 15_000;
// Fallback $DELL mint if XSTOCKS_MINT isn't pinned in the environment.
const DELL_MINT_FALLBACK = "BxihZJMeYqjVVaPoE21Hzzk4TiAaPBAgXPyBCTWapump";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.some((a) => a.toLowerCase() === "dry" || a === "--dry");
  const budgetSol = Math.max(0, Number(args.find((a) => /^[0-9.]+$/.test(a)) || "5"));
  if (!config.botReady) {
    logger.error(`Cannot run: ${config.configError || "wallet not configured"}.`);
    process.exit(1);
  }

  const treasury = loadTreasuryWallet();
  const dellMint = config.xstocksMint || DELL_MINT_FALLBACK;
  const target = stockForCycle(1); // DELL — the stock we always try first

  logger.info(`=== MANUAL airdrop · budget ${budgetSol} SOL ===`);
  logger.info(`Treasury: ${treasury.publicKey.toBase58()}`);
  logger.info(`Qualify : hold ≥ ${config.minHolderBalance.toLocaleString()} $DELL (${dellMint})`);

  // ── Budget: cap to the requested SOL AND to what the wallet can spare ──────
  const walletLamports = Math.floor((await getSolBalance(treasury.publicKey)) * LAMPORTS_PER_SOL);
  const walletSpendable = Math.max(0, walletLamports - MIN_WALLET_KEEP_LAMPORTS);
  let budgetLamports = Math.min(Math.floor(budgetSol * LAMPORTS_PER_SOL), walletSpendable);
  if (budgetLamports <= 0) {
    logger.error(`Nothing spendable: wallet holds ${(walletLamports / LAMPORTS_PER_SOL).toFixed(5)} SOL.`);
    process.exit(1);
  }

  // ── Resolve which stock we can actually buy ───────────────────────────────
  const stock = await resolvePayableStock(target, budgetLamports);
  if (!stock) {
    logger.error(`$${target.ticker} has no market and no fallback was tradable — aborting.`);
    process.exit(1);
  }
  if (stock.mint !== target.mint) {
    logger.info(`$${target.ticker} not tradable yet — paying out $${stock.ticker} instead.`);
  }

  // ── Snapshot + qualify holders ────────────────────────────────────────────
  const holders = await snapshotHolders(dellMint);
  const excludes = new Set<string>([treasury.publicKey.toBase58()]);
  if (config.marketingWallet) excludes.add(config.marketingWallet);
  const qualified = holders
    .filter((h) => !excludes.has(h.owner) && h.uiBalance >= config.minHolderBalance)
    .sort((a, b) => b.uiBalance - a.uiBalance)
    .slice(0, config.maxRecipientsPerCycle);
  if (qualified.length === 0) {
    logger.error(`No wallets hold ≥ ${config.minHolderBalance.toLocaleString()} $DELL — nothing to pay.`);
    process.exit(1);
  }
  logger.info(`${qualified.length} qualified holder(s).`);

  // ── Reserve ATA rent + tx fees, then size the buy ─────────────────────────
  const stockMint = new PublicKey(stock.mint);
  const holderAtas = qualified.map((h) => ata2022(new PublicKey(h.owner), stockMint));
  const exist = await whichAtasExist(holderAtas);
  const newAtaCount = exist.filter((e) => !e).length;
  const batches = Math.ceil(qualified.length / PAYOUT_BATCH_SIZE);
  const reservedCostLamports =
    newAtaCount * Math.floor(config.ataRentEstimateSol * LAMPORTS_PER_SOL) +
    (batches + 1) * TX_FEE_RESERVE_LAMPORTS;
  const swapLamports = budgetLamports - reservedCostLamports;
  if (swapLamports <= 0) {
    logger.error(
      `Budget ${(budgetLamports / LAMPORTS_PER_SOL).toFixed(5)} SOL all consumed by ${newAtaCount} new ATAs' rent — raise the budget.`
    );
    process.exit(1);
  }
  logger.info(
    `Buying with ${(swapLamports / LAMPORTS_PER_SOL).toFixed(5)} SOL · reserving ` +
    `${(reservedCostLamports / LAMPORTS_PER_SOL).toFixed(5)} for ${newAtaCount} new ATA(s).`
  );

  if (dryRun) {
    logger.info("=== DRY RUN — no SOL spent, no tokens sent. Plan: ===");
    logger.info(`  would buy ~${(swapLamports / LAMPORTS_PER_SOL).toFixed(5)} SOL of $${stock.ticker} (${stock.symbol})`);
    logger.info(`  would pay ${qualified.length} holder(s); ${newAtaCount} need a new ATA:`);
    for (const h of qualified) logger.info(`    ${h.owner}  holds ${h.uiBalance.toLocaleString()} $DELL`);
    process.exit(0);
  }

  // ── Buy ───────────────────────────────────────────────────────────────────
  const balBefore = Math.floor((await getSolBalance(treasury.publicKey)) * LAMPORTS_PER_SOL);
  const swap = await buyStock(treasury, stock, swapLamports);
  if (!swap || swap.receivedRaw <= 0n) {
    logger.error(`Could not buy $${stock.ticker} — aborting (no stock dispensed).`);
    process.exit(1);
  }
  logger.info(`Bought ${swap.receivedUi.toFixed(6)} ${stock.symbol} for ${(swap.spentLamports / LAMPORTS_PER_SOL).toFixed(5)} SOL.`);

  // ── Plan + dispense ────────────────────────────────────────────────────────
  const plan = computeProportionalStockPayouts(qualified, swap.receivedRaw, config.maxRecipientsPerCycle);
  if (plan.length === 0) {
    logger.error("Every slice rounded to 0 — buy more so each holder gets a non-zero amount.");
    process.exit(1);
  }
  const totalPlanRaw = plan.reduce((s, p) => s + p.amountRaw, 0n);
  const totalPlanUi = Number(totalPlanRaw) / 10 ** stock.decimals;
  const newAtaOwners = new Set<string>();
  qualified.forEach((h, i) => { if (!exist[i]) newAtaOwners.add(h.owner); });
  const ataRentLamports = await discoverAtaRent(stockMint);

  logger.info(`Dispensing ${totalPlanUi.toFixed(6)} ${stock.symbol} to ${plan.length} holder(s)…`);
  const results = await dispenseStock(treasury, stock, plan, { ataRentLamports, newAtaOwners });

  // ── Record to the dashboard (best-effort) ─────────────────────────────────
  try {
    await tracker.init();
    const winners = results.map((r) => {
      const amountUi = Number(r.amountRaw) / 10 ** stock.decimals;
      const share = totalPlanRaw > 0n ? Number(r.amountRaw) / Number(totalPlanRaw) : 0;
      return { owner: r.owner, amountUi, solValue: (swap.spentLamports / LAMPORTS_PER_SOL) * share, signature: r.signature };
    });
    tracker.recordSwap({ stock, solSpent: swap.spentLamports / LAMPORTS_PER_SOL, receivedUi: swap.receivedUi, txSignature: swap.signature });
    tracker.recordDispense({ stock, solSpent: swap.spentLamports / LAMPORTS_PER_SOL, winners });
    const balAfter = Math.floor((await getSolBalance(treasury.publicKey)) * LAMPORTS_PER_SOL);
    tracker.debitClaimPool(Math.max(0, balBefore - balAfter));
  } catch (e) {
    logger.warn(`Dashboard record skipped: ${e instanceof Error ? e.message : e}`);
  }

  logger.info(`=== DONE · paid ${results.length} holder(s) ${stock.symbol}. ===`);
  for (const r of results) {
    logger.info(`  ${r.owner}  ${(Number(r.amountRaw) / 10 ** stock.decimals).toFixed(6)} ${stock.symbol}  tx ${r.signature}`);
  }
  process.exit(0);
}

main().catch((e) => { logger.error(`Manual airdrop failed: ${e instanceof Error ? e.stack || e.message : e}`); process.exit(1); });
