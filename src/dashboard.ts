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
