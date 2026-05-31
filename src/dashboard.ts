import express, { Request, Response } from "express";
import * as path from "path";
import * as fs from "fs";
import { config } from "./config";
import { tracker } from "./activity";
import { logger } from "./logger";

export function startDashboard() {
  const app = express();

  // The front-end is the static design in public/index.html. express.static
  // serves it at "/" automatically; it polls the two /api routes below.
  const publicDir = path.join(process.cwd(), "public");
  if (fs.existsSync(publicDir)) app.use(express.static(publicDir));

  // Live NYSE:DELL price + chart series, proxied from Yahoo Finance (free, no
  // key). Server-side so the browser isn't blocked by CORS; cached per range so
  // we don't hammer the upstream on every poll.
  const RANGE_MAP: Record<string, { range: string; interval: string }> = {
    "1D": { range: "1d", interval: "5m" },
    "1W": { range: "5d", interval: "30m" },
    "1M": { range: "1mo", interval: "1d" },
    "1Y": { range: "1y", interval: "1wk" },
  };
  const priceCache = new Map<string, { ts: number; body: unknown }>();

  function fmtLabel(sec: number, r: string): string {
    const d = new Date(sec * 1000);
    const ny: Intl.DateTimeFormatOptions = { timeZone: "America/New_York" };
    if (r === "1D") return d.toLocaleTimeString("en-US", { ...ny, hour: "numeric", minute: "2-digit" });
    if (r === "1W") return d.toLocaleDateString("en-US", { ...ny, weekday: "short" });
    if (r === "1M") return d.toLocaleDateString("en-US", { ...ny, month: "short", day: "numeric" });
    return d.toLocaleDateString("en-US", { ...ny, month: "short", year: "2-digit" });
  }

  app.get("/api/price", async (req: Request, res: Response) => {
    const r = String(req.query.range || "1W").toUpperCase();
    const m = RANGE_MAP[r] || RANGE_MAP["1W"];
    const cached = priceCache.get(r);
    if (cached && Date.now() - cached.ts < 60_000) {
      res.json(cached.body);
      return;
    }
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/DELL?range=${m.range}&interval=${m.interval}`;
      const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!resp.ok) throw new Error(`yahoo ${resp.status}`);
      const j: any = await resp.json();
      const result = j?.chart?.result?.[0];
      const meta = result?.meta || {};
      const tstamps: number[] = result?.timestamp || [];
      const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close || [];
      const points: number[] = [];
      const tsKept: number[] = [];
      for (let i = 0; i < closes.length; i++) {
        const c = closes[i];
        if (typeof c === "number" && isFinite(c)) {
          points.push(Math.round(c * 100) / 100);
          tsKept.push(tstamps[i]);
        }
      }
      if (points.length < 2) throw new Error("no points");
      const price = typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : points[points.length - 1];
      const prevClose = r === "1D" && typeof meta.chartPreviousClose === "number" ? meta.chartPreviousClose : points[0];
      const labels: string[] = [];
      for (let k = 0; k < 5; k++) {
        const idx = Math.round((k / 4) * (tsKept.length - 1));
        labels.push(fmtLabel(tsKept[idx], r));
      }
      const body = { price: Math.round(price * 100) / 100, prevClose: Math.round(prevClose * 100) / 100, points, labels };
      priceCache.set(r, { ts: Date.now(), body });
      res.json(body);
    } catch (e) {
      logger.warn(`/api/price failed: ${String(e)}`);
      if (cached) {
        res.json(cached.body);
        return;
      }
      res.status(502).json({ error: "price unavailable" });
    }
  });

  app.get("/api/state", (_req: Request, res: Response) => {
    // Polling endpoint — trim to what the dashboard actually renders. Full
    // recipients map is queried via /api/holder/:addr; historical winners arrays
    // and dispense rows aren't shown anywhere in the UI. Without this, the
    // payload grows to multiple MB over a day's cycles → slow polls.
    const s = tracker.snapshot();
    const slim: Record<string, unknown> = {
      ...s,
      recentWinners: (s.recentWinners || []).slice(0, 40),
      dispenses: (s.dispenses || []).slice(-10).map((d) => ({
        ts: d.ts, cycle: d.cycle, symbol: d.symbol, ticker: d.ticker,
        totalUi: d.totalUi, solSpent: d.solSpent, recipientCount: d.recipientCount,
      })),
      events: (s.events || []).slice(-60),
    };
    delete slim.recipients;
    res.json(slim);
  });

  // Lifetime airdrop lookup for any wallet (the "check your bag" feature).
  app.get("/api/holder/:address", (req: Request, res: Response) => {
    const addr = String(req.params.address || "").trim();
    if (addr.length < 32 || addr.length > 44) {
      res.status(400).json({ error: "Not a valid Solana address." });
      return;
    }
    res.json(tracker.getHolderSummary(addr));
  });

  app.listen(config.port, "0.0.0.0", () => {
    logger.info(`Dashboard listening on 0.0.0.0:${config.port}`);
  });
}
