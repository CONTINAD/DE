/**
 * One-shot SWEEP. Distributes stock that is ALREADY sitting in the treasury
 * (e.g. left undispensed when a cycle's payout batches failed) out to every
 * qualified $DELL holder, proportional to their bag — using the same relay
 * mechanism as a normal cycle. Buys nothing; only moves stock the treasury
 * already holds.
 *
 *     npm run build && railway run node dist/sweep.js MSFTx GOOGLx AMZNx
 *     railway run node dist/sweep.js all          # every stock with a balance
 *     railway run node dist/sweep.js MSFTx dry     # preview, send nothing
 */
import { PublicKey } from "@solana/web3.js";
import { config } from "./config";
import {
  loadTreasuryWallet,
  ata2022,
  getRawTokenBalance,
  whichAtasExist,
  discoverAtaRent,
} from "./wallet";
import { snapshotHolders } from "./holders";
import { computeProportionalStockPayouts, dispenseStock } from "./payout";
import { STOCKS, type Stock } from "./rotation";
import { tracker } from "./activity";
import { logger } from "./logger";

const DELL_MINT_FALLBACK = "BxihZJMeYqjVVaPoE21Hzzk4TiAaPBAgXPyBCTWapump";
// Below this many UI units a balance is treated as floor-dust and skipped.
const DUST_UI = 0.0005;

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.some((a) => a.toLowerCase() === "dry" || a === "--dry");
  const symbolArgs = args.filter((a) => a.toLowerCase() !== "dry" && a !== "--dry");
  if (!config.botReady) {
    logger.error(`Cannot run: ${config.configError || "wallet not configured"}.`);
    process.exit(1);
  }

  const treasury = loadTreasuryWallet();
  const dellMint = config.xstocksMint || DELL_MINT_FALLBACK;

  // Which stocks to sweep: explicit symbols, or "all" = scan the whole universe.
  let candidates: Stock[];
  if (symbolArgs.length === 0 || symbolArgs.some((a) => a.toLowerCase() === "all")) {
    candidates = Object.values(STOCKS);
  } else {
    candidates = symbolArgs
      .map((s) => STOCKS[s] || STOCKS[s + "x"] || STOCKS[s.toUpperCase()] || STOCKS[s.toUpperCase() + "x"])
      .filter((s): s is Stock => !!s);
    if (candidates.length !== symbolArgs.length) {
      logger.warn(`Some symbols were not recognized; sweeping: ${candidates.map((c) => c.symbol).join(", ")}`);
    }
  }

  // Find which candidates actually have a non-dust treasury balance.
  const stuck: { stock: Stock; balanceRaw: bigint; balanceUi: number }[] = [];
  for (const stock of candidates) {
    const ata = ata2022(treasury.publicKey, new PublicKey(stock.mint));
    const balanceRaw = await getRawTokenBalance(ata);
    const balanceUi = Number(balanceRaw) / 10 ** stock.decimals;
    if (balanceUi > DUST_UI) stuck.push({ stock, balanceRaw, balanceUi });
  }
  if (stuck.length === 0) {
    logger.info("Nothing to sweep — no stock balances above the dust threshold.");
    process.exit(0);
  }
  logger.info(`=== SWEEP${dryRun ? " (DRY RUN)" : ""} — stuck balances: ${stuck.map((s) => `${s.balanceUi.toFixed(4)} ${s.stock.symbol}`).join(", ")} ===`);

  // Snapshot + qualify holders ONCE (same set for every stock).
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

  let dbReady = false;
  if (!dryRun) { try { await tracker.init(); dbReady = true; } catch { /* best effort */ } }

  for (const { stock, balanceRaw, balanceUi } of stuck) {
    const stockMint = new PublicKey(stock.mint);
    const plan = computeProportionalStockPayouts(qualified, balanceRaw, config.maxRecipientsPerCycle);
    if (plan.length === 0) {
      logger.warn(`${stock.symbol}: ${balanceUi} too small to split across ${qualified.length} holders — skipping.`);
      continue;
    }
    const holderAtas = qualified.map((h) => ata2022(new PublicKey(h.owner), stockMint));
    const exist = await whichAtasExist(holderAtas);
    const newAtaOwners = new Set<string>();
    qualified.forEach((h, i) => { if (!exist[i]) newAtaOwners.add(h.owner); });
    const totalPlanRaw = plan.reduce((s, p) => s + p.amountRaw, 0n);
    const totalPlanUi = Number(totalPlanRaw) / 10 ** stock.decimals;

    if (dryRun) {
      logger.info(`  ${stock.symbol}: would send ${totalPlanUi.toFixed(6)} to ${plan.length} holder(s); ${newAtaOwners.size} need a new ATA.`);
      continue;
    }

    const ataRentLamports = await discoverAtaRent(stockMint);
    logger.info(`Sweeping ${totalPlanUi.toFixed(6)} ${stock.symbol} → ${plan.length} holder(s) (${newAtaOwners.size} new ATAs)…`);
    const results = await dispenseStock(treasury, stock, plan, { ataRentLamports, newAtaOwners });
    const paid = results.filter((r) => r.signature).length;
    logger.info(`  ${stock.symbol}: paid ${paid}/${results.length} holder(s).`);

    if (dbReady) {
      try {
        const winners = results.map((r) => {
          const amountUi = Number(r.amountRaw) / 10 ** stock.decimals;
          const share = totalPlanRaw > 0n ? Number(r.amountRaw) / Number(totalPlanRaw) : 0;
          return { owner: r.owner, amountUi, solValue: 0, signature: r.signature };
        });
        tracker.recordDispense({ stock, solSpent: 0, winners });
      } catch (e) { logger.warn(`Dashboard record skipped for ${stock.symbol}: ${e instanceof Error ? e.message : e}`); }
    }
  }

  logger.info("=== SWEEP DONE ===");
  process.exit(0);
}

main().catch((e) => { logger.error(`Sweep failed: ${e instanceof Error ? e.stack || e.message : e}`); process.exit(1); });
