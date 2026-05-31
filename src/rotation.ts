/**
 * $DELL — a single-stock machine. Every cycle buys + airdrops DELL (the verified
 * Backed/xStocks DELLx Token-2022 mint). No rotation: one stock, all Dell.
 *
 * Mints are VERIFIED Backed/xStocks Token-2022 tokens on Solana (decimals = 8,
 * "Xs" vanity prefix), resolved from the Jupiter token list and cross-checked
 * on-chain. You can still override with STOCK_ROTATION in .env (comma-separated
 * symbols that exist below) — but the default and intent is DELLx only.
 */

export interface Stock {
  /** On-chain symbol, e.g. "TSLAx". */
  symbol: string;
  /** Clean ticker for the UI, e.g. "TSLA". */
  ticker: string;
  /** Company / fund name. */
  name: string;
  /** Token-2022 mint address. */
  mint: string;
  /** Token decimals (all verified xStocks are 8). */
  decimals: number;
}

// The verified xStock universe. $DELL only pays out DELLx, but the other
// verified mints stay here so STOCK_ROTATION can be changed without code edits.
export const STOCKS: Record<string, Stock> = {
  // ── $DELL — the one and only stock this machine pays out ──────────────
  // VERIFIED Backed/xStocks DELLx mint (Token-2022, decimals 8). Cross-checked
  // on Jupiter (isVerified), on-chain RPC metadata, and xstocks.com. WARNING:
  // fake "DELLx" impostors exist on pump.fun — this Xsu7… address is the ONLY
  // legitimate Backed Dell mint. Do not change it without re-verifying.
  DELLx: { symbol: "DELLx", ticker: "DELL", name: "Dell Technologies", mint: "Xsu7Tc5J2fVUE4H5vYAiSr34cvLJeCsYPMjAYnayQn6", decimals: 8 },
  AAPLx: { symbol: "AAPLx", ticker: "AAPL", name: "Apple",          mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", decimals: 8 },
  TSLAx: { symbol: "TSLAx", ticker: "TSLA", name: "Tesla",          mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", decimals: 8 },
  NVDAx: { symbol: "NVDAx", ticker: "NVDA", name: "NVIDIA",         mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", decimals: 8 },
  MSFTx: { symbol: "MSFTx", ticker: "MSFT", name: "Microsoft",      mint: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX", decimals: 8 },
  AMZNx: { symbol: "AMZNx", ticker: "AMZN", name: "Amazon",         mint: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg", decimals: 8 },
  METAx: { symbol: "METAx", ticker: "META", name: "Meta",           mint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu", decimals: 8 },
  GOOGLx:{ symbol: "GOOGLx",ticker: "GOOGL",name: "Alphabet",       mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN", decimals: 8 },
  SPYx:  { symbol: "SPYx",  ticker: "SPY",  name: "S&P 500 ETF",    mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", decimals: 8 },
  COINx: { symbol: "COINx", ticker: "COIN", name: "Coinbase",       mint: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu", decimals: 8 },
  AMDx:  { symbol: "AMDx",  ticker: "AMD",  name: "AMD",            mint: "XsXcJ6GZ9kVnjqGsjBnktRcuwMBmvKWh8S93RefZ1rF", decimals: 8 },
  NFLXx: { symbol: "NFLXx", ticker: "NFLX", name: "Netflix",        mint: "XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL", decimals: 8 },
  MSTRx: { symbol: "MSTRx", ticker: "MSTR", name: "MicroStrategy",  mint: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ", decimals: 8 },
};

// $DELL is a single-stock machine: every cycle buys & airdrops DELL.
const DEFAULT_ORDER = ["DELLx"];

// Auto-fallback: DELLx currently has NO on-chain market (zero liquidity, no
// Jupiter route), so it physically can't be bought. To keep holders paid real
// tokenized equity every cycle, when DELL is untradable the machine buys the
// first liquid stock from this list instead — and automatically switches back
// to DELL the moment a DELL market appears. Override with STOCK_FALLBACK
// (comma-separated symbols). Set STOCK_FALLBACK="" to disable and only ever
// pay DELL (pool then carries over until DELL is tradable).
const DEFAULT_FALLBACK = ["AAPLx", "NVDAx", "TSLAx", "SPYx", "MSFTx"];

function buildFallback(): Stock[] {
  const raw = process.env.STOCK_FALLBACK?.trim();
  if (raw === "") return [];
  const order = raw
    ? raw.split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_FALLBACK;
  return order
    .map((sym) => STOCKS[sym] || STOCKS[sym + "x"] || STOCKS[sym.toUpperCase()] || STOCKS[sym.toUpperCase() + "x"])
    .filter((s): s is Stock => !!s);
}

export const FALLBACK: Stock[] = buildFallback();

/** Fallback candidates to try (in order) when the primary stock is untradable. */
export function fallbackStocks(primary: Stock): Stock[] {
  return FALLBACK.filter((s) => s.mint !== primary.mint);
}

function buildRotation(): Stock[] {
  const raw = process.env.STOCK_ROTATION?.trim();
  if (!raw) return DEFAULT_ORDER.map((s) => STOCKS[s]);
  const order = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const resolved = order
    .map((sym) => STOCKS[sym] || STOCKS[sym + "x"] || STOCKS[sym.toUpperCase()] || STOCKS[sym.toUpperCase() + "x"])
    .filter((s): s is Stock => !!s);
  return resolved.length ? resolved : DEFAULT_ORDER.map((s) => STOCKS[s]);
}

export const ROTATION: Stock[] = buildRotation();

/** Native SOL mint (Jupiter's wrapped-SOL input mint). */
export const SOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * The stock for a given cycle. cycleNumber is 1-based (the first cycle ever is
 * 1). Cycle 1 → ROTATION[0], cycle 13 → ROTATION[0] again, etc.
 */
export function stockForCycle(cycleNumber: number): Stock {
  const idx = ((cycleNumber - 1) % ROTATION.length + ROTATION.length) % ROTATION.length;
  return ROTATION[idx];
}

/** The stock that will be paid out NEXT cycle (for the dashboard's "up next"). */
export function nextStockForCycle(cycleNumber: number): Stock {
  return stockForCycle(cycleNumber + 1);
}

export const ROTATION_LENGTH = ROTATION.length;
