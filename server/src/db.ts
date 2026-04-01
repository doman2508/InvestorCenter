import fs from "node:fs";
import path from "node:path";
import type { AlertRule, Holding, InstrumentMapping, MarketSnapshot, NewsItem, PortfolioAccount, Transaction, WatchlistItem } from "./types.js";

export interface DataStore {
  accounts: PortfolioAccount[];
  holdings: Holding[];
  transactions: Transaction[];
  watchlist: WatchlistItem[];
  alertRules: AlertRule[];
  news: NewsItem[];
  marketSnapshots: MarketSnapshot[];
  marketDataMode: "live" | "fallback";
  marketDataUpdatedAt: string | null;
  instrumentMappings: InstrumentMapping[];
}

function getDbPath() {
  const configuredPath = process.env.INVESTOR_CENTER_DB_PATH;
  if (configuredPath) {
    return path.resolve(configuredPath);
  }
  return path.resolve(process.cwd(), "data", "investor-center.json");
}

function getDataDir(dbPath: string) {
  return path.dirname(dbPath);
}

function emptyStore(): DataStore {
  return {
    accounts: [],
    holdings: [],
    transactions: [],
    watchlist: [],
    alertRules: [],
    news: [],
    marketSnapshots: [],
    marketDataMode: "fallback",
    marketDataUpdatedAt: null,
    instrumentMappings: []
  };
}

export function initDb() {
  const dbPath = getDbPath();
  const dataDir = getDataDir(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify(emptyStore(), null, 2), "utf-8");
  }
}

export function readStore(): DataStore {
  const dbPath = getDbPath();
  initDb();
  return JSON.parse(fs.readFileSync(dbPath, "utf-8")) as DataStore;
}

export function writeStore(store: DataStore) {
  const dbPath = getDbPath();
  const dataDir = getDataDir(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(dbPath, JSON.stringify(store, null, 2), "utf-8");
}

export function resetStore() {
  writeStore(emptyStore());
}
