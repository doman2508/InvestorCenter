import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { z } from "zod";
import {
  addHolding,
  addWatchlistItem,
  clearAccountPortfolioData,
  deleteHolding,
  deleteWatchlistItem,
  getAccounts,
  getInstrumentMappings,
  updateHolding,
  updateWatchlistItem,
  upsertInstrumentMapping
} from "./repository.js";
import { refreshMarketData } from "./services/marketData.js";
import { getMonthlyPerformance } from "./services/monthlyPerformance.js";
import { getDashboard } from "./services/portfolio.js";
import { scanMarket } from "./services/marketScanner.js";
import { getTradeSetup, isSupportedInstrument, isSupportedInterval } from "./services/signalService.js";
import { importTransactionsFromCsv } from "./services/importer.js";
import { importEmaklerHistory } from "./services/emaklerImporter.js";
import { importTreasuryBondsWorkbook } from "./services/treasuryBondsImporter.js";
import { importXtbWorkbook } from "./services/xtbImporter.js";
import { syncHoldingsForAccount, syncPortfolioHoldings } from "./services/holdingsSync.js";

const createHoldingSchema = z.object({
  accountId: z.coerce.number().int().positive(),
  symbol: z.string().min(1),
  name: z.string().min(1),
  assetClass: z.enum(["ETF", "STOCK", "BOND", "COMMODITY", "CASH"]),
  quantity: z.coerce.number().positive(),
  averageCost: z.coerce.number().nonnegative(),
  currentPrice: z.coerce.number().nonnegative(),
  currency: z.string().min(1),
  targetAllocationPct: z.coerce.number().min(0).max(100),
  maturityDate: z.string().optional().nullable()
});

const createWatchlistSchema = z.object({
  symbol: z.string().min(1),
  name: z.string().min(1),
  assetClass: z.enum(["ETF", "STOCK", "BOND", "COMMODITY", "CASH"]),
  thesis: z.string().min(3),
  thesisTag: z.string().min(1),
  lastPrice: z.coerce.number().nonnegative(),
  priceChange1dPct: z.coerce.number(),
  momentum3mPct: z.coerce.number(),
  dataFreshness: z.enum(["fresh", "stale"])
});

const importXtbPathSchema = z.object({
  filePath: z.string().min(3),
  accountName: z.string().min(1).default("XTB")
});

const importEmaklerPathSchema = z.object({
  filePath: z.string().min(3),
  accountName: z.string().min(1)
});

const importTreasuryBondsPathSchema = z.object({
  filePath: z.string().min(3)
});

const importEmaklerUploadSchema = z.object({
  accountName: z.enum(["IKE", "IKZE"])
});

const instrumentMappingSchema = z.object({
  accountId: z.coerce.number().int().positive(),
  sourceSymbol: z.string().min(1),
  marketTicker: z.string().min(1),
  label: z.string().optional().nullable()
});

const uploadDir = path.join(process.cwd(), "data", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      callback(null, uploadDir);
    },
    filename: (_req, file, callback) => {
      const ext = path.extname(file.originalname);
      const safeBase = path
        .basename(file.originalname, ext)
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
      callback(null, `${Date.now()}-${safeBase || "upload"}${ext}`);
    }
  })
});

function removeUploadedFile(filePath: string) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Best-effort cleanup for temporary uploads.
  }
}

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.text({ type: ["text/csv", "text/plain"] }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/dashboard", (_req, res) => {
    res.json(getDashboard());
  });

  app.get("/api/performance/monthly", async (_req, res) => {
    try {
      res.json(await getMonthlyPerformance());
    } catch (error) {
      res.status(500).json({
        message: error instanceof Error ? error.message : "Nie udalo sie pobrac miesiecznej historii portfela."
      });
    }
  });

  app.post("/api/market/refresh", async (_req, res) => {
    const result = await refreshMarketData();
    res.json(result);
  });

  app.get("/api/market/scan", async (_req, res) => {
    try {
      const result = await scanMarket();
      res.json(result);
    } catch (error) {
      res.status(500).json({
        message: error instanceof Error ? error.message : "Market scan unavailable."
      });
    }
  });

  app.get("/api/trade-setup", async (req, res) => {
    try {
      const rawInstrument = typeof req.query.instrument === "string" ? req.query.instrument.toUpperCase() : "WTI";
      const rawInterval = typeof req.query.interval === "string" ? req.query.interval : "15m";
      const instrument = isSupportedInstrument(rawInstrument) ? rawInstrument : "WTI";
      const interval = isSupportedInterval(rawInterval) ? rawInterval : "15m";
      const result = await getTradeSetup(instrument, interval);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        message: error instanceof Error ? error.message : "Trade setup unavailable."
      });
    }
  });

  app.post("/api/import/csv", (req, res) => {
    const result = importTransactionsFromCsv(req.body ?? "");
    if (result.errors.length > 0) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  });

  app.post("/api/import/xtb-path", (req, res) => {
    const parsed = importXtbPathSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid import request." });
      return;
    }
    const result = importXtbWorkbook(parsed.data.filePath, parsed.data.accountName);
    if (result.errors.length > 0) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  });

  app.post("/api/import/xtb-upload", upload.single("file"), (req, res) => {
    if (!req.file) {
      res.status(400).json({ message: "Brak pliku do importu XTB." });
      return;
    }
    try {
      const result = importXtbWorkbook(req.file.path, "XTB");
      if (result.errors.length > 0) {
        res.status(400).json(result);
        return;
      }
      res.json(result);
    } finally {
      removeUploadedFile(req.file.path);
    }
  });

  app.post("/api/import/emakler-path", (req, res) => {
    const parsed = importEmaklerPathSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid eMakler import request." });
      return;
    }
    const result = importEmaklerHistory(parsed.data.filePath, parsed.data.accountName);
    if (result.errors.length > 0) {
      res.status(400).json(result);
      return;
    }
    const syncResult = syncHoldingsForAccount(parsed.data.accountName);
    res.json({
      ...result,
      notes: [...result.notes, `Rebuilt ${syncResult.rebuilt} current holdings for ${parsed.data.accountName}.`]
    });
  });

  app.post("/api/import/emakler-upload", upload.single("file"), (req, res) => {
    if (!req.file) {
      res.status(400).json({ message: "Brak pliku do importu eMakler." });
      return;
    }
    const parsed = importEmaklerUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      removeUploadedFile(req.file.path);
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid eMakler import request." });
      return;
    }
    try {
      const result = importEmaklerHistory(req.file.path, parsed.data.accountName);
      if (result.errors.length > 0) {
        res.status(400).json(result);
        return;
      }
      const syncResult = syncHoldingsForAccount(parsed.data.accountName);
      res.json({
        ...result,
        notes: [...result.notes, `Rebuilt ${syncResult.rebuilt} current holdings for ${parsed.data.accountName}.`]
      });
    } finally {
      removeUploadedFile(req.file.path);
    }
  });

  app.post("/api/import/treasury-bonds-path", (req, res) => {
    const parsed = importTreasuryBondsPathSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid Treasury Bonds import request." });
      return;
    }
    const result = importTreasuryBondsWorkbook(parsed.data.filePath);
    if (result.errors.length > 0) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  });

  app.post("/api/import/treasury-bonds-upload", upload.single("file"), (req, res) => {
    if (!req.file) {
      res.status(400).json({ message: "Brak pliku do importu obligacji." });
      return;
    }
    try {
      const result = importTreasuryBondsWorkbook(req.file.path);
      if (result.errors.length > 0) {
        res.status(400).json(result);
        return;
      }
      res.json(result);
    } finally {
      removeUploadedFile(req.file.path);
    }
  });

  app.get("/api/instrument-mappings", (_req, res) => {
    res.json(getInstrumentMappings());
  });

  app.post("/api/instrument-mappings", (req, res) => {
    const parsed = instrumentMappingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid mapping payload." });
      return;
    }
    res.status(201).json(
      upsertInstrumentMapping({
        ...parsed.data,
        label: parsed.data.label ?? null
      })
    );
  });

  app.post("/api/holdings/sync", (_req, res) => {
    res.json(syncPortfolioHoldings());
  });

  app.post("/api/holdings/reset-xtb", (_req, res) => {
    const account = getAccounts().find((item) => item.name === "XTB");
    if (!account) {
      res.status(404).json({ message: "XTB account not found." });
      return;
    }
    res.json(clearAccountPortfolioData(account.id));
  });

  app.post("/api/holdings", (req, res) => {
    const parsed = createHoldingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid holding payload." });
      return;
    }
    const holding = addHolding({
      ...parsed.data,
      maturityDate: parsed.data.maturityDate || null
    });
    res.status(201).json(holding);
  });

  app.put("/api/holdings/:id", (req, res) => {
    const parsed = createHoldingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid holding payload." });
      return;
    }
    const updated = updateHolding(Number(req.params.id), {
      ...parsed.data,
      maturityDate: parsed.data.maturityDate || null
    });
    if (!updated) {
      res.status(404).json({ message: "Holding not found." });
      return;
    }
    res.json(updated);
  });

  app.delete("/api/holdings/:id", (req, res) => {
    const removed = deleteHolding(Number(req.params.id));
    if (!removed) {
      res.status(404).json({ message: "Holding not found." });
      return;
    }
    res.status(204).send();
  });

  app.post("/api/watchlist", (req, res) => {
    const parsed = createWatchlistSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid watchlist payload." });
      return;
    }
    const item = addWatchlistItem(parsed.data);
    res.status(201).json(item);
  });

  app.put("/api/watchlist/:id", (req, res) => {
    const parsed = createWatchlistSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid watchlist payload." });
      return;
    }
    const updated = updateWatchlistItem(Number(req.params.id), parsed.data);
    if (!updated) {
      res.status(404).json({ message: "Watchlist item not found." });
      return;
    }
    res.json(updated);
  });

  app.delete("/api/watchlist/:id", (req, res) => {
    const removed = deleteWatchlistItem(Number(req.params.id));
    if (!removed) {
      res.status(404).json({ message: "Watchlist item not found." });
      return;
    }
    res.status(204).send();
  });

  return app;
}
