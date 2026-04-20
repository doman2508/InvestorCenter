import { readStore, writeStore } from "./db.js";
import type {
  AlertRule,
  CreateHoldingInput,
  CreateWatchlistInput,
  Holding,
  InstrumentMapping,
  MarketSnapshot,
  NewsItem,
  PortfolioAccount,
  Transaction,
  WatchlistItem
} from "./types.js";

export function getAccounts(): PortfolioAccount[] {
  return readStore().accounts.sort((a, b) => a.id - b.id);
}

export function ensureAccount(input: Omit<PortfolioAccount, "id">) {
  const store = readStore();
  const existing = store.accounts.find((account) => account.name === input.name);
  if (existing) {
    return existing;
  }
  const nextId = store.accounts.length === 0 ? 1 : Math.max(...store.accounts.map((item) => item.id)) + 1;
  const account: PortfolioAccount = {
    id: nextId,
    ...input
  };
  store.accounts.push(account);
  writeStore(store);
  return account;
}

export function renameAccount(accountId: number, name: string) {
  const store = readStore();
  const account = store.accounts.find((item) => item.id === accountId);
  if (!account) {
    return null;
  }
  account.name = name;
  writeStore(store);
  return account;
}

export function getHoldings(): Holding[] {
  return readStore().holdings.sort((a, b) => a.accountId - b.accountId || a.symbol.localeCompare(b.symbol));
}

export function getTransactions(): Transaction[] {
  return readStore().transactions.sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));
}

export function getWatchlist(): WatchlistItem[] {
  return readStore().watchlist.sort((a, b) => a.dataFreshness.localeCompare(b.dataFreshness) || Math.abs(b.priceChange1dPct) - Math.abs(a.priceChange1dPct));
}

export function getAlertRules(): AlertRule[] {
  return readStore().alertRules.filter((rule) => rule.enabled);
}

export function getNews(): NewsItem[] {
  return readStore().news.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 5);
}

export function getMarketSnapshots(): MarketSnapshot[] {
  return readStore().marketSnapshots;
}

export function getInstrumentMappings(): InstrumentMapping[] {
  return readStore().instrumentMappings.sort((a, b) => a.sourceSymbol.localeCompare(b.sourceSymbol));
}

export function getMarketDataStatus() {
  const store = readStore();
  return {
    mode: store.marketDataMode,
    lastUpdatedAt: store.marketDataUpdatedAt
  };
}

export function upsertTransactions(rows: Omit<Transaction, "id">[]) {
  const store = readStore();
  let imported = 0;
  let skipped = 0;
  const transactionKey = (item: Omit<Transaction, "id"> | Transaction) =>
    [
      item.accountId,
      item.symbol,
      item.tradeDate,
      item.type,
      item.quantity,
      item.price,
      item.currency
    ].join("|");
  const existingCounts = new Map<string, number>();

  for (const transaction of store.transactions) {
    const key = transactionKey(transaction);
    existingCounts.set(key, (existingCounts.get(key) ?? 0) + 1);
  }

  const seenIncoming = new Map<string, number>();

  for (const item of rows) {
    const key = transactionKey(item);
    const currentIncomingCount = (seenIncoming.get(key) ?? 0) + 1;
    seenIncoming.set(key, currentIncomingCount);
    const existingCount = existingCounts.get(key) ?? 0;

    if (currentIncomingCount <= existingCount) {
      const duplicate = store.transactions.find(
        (tx) =>
          tx.accountId === item.accountId &&
          tx.symbol === item.symbol &&
          tx.tradeDate === item.tradeDate &&
          tx.type === item.type &&
          tx.quantity === item.quantity &&
          tx.price === item.price &&
          tx.currency === item.currency
      );
      if (
        duplicate &&
        (duplicate.settlementValue == null || duplicate.settlementCurrency == null) &&
        (item.settlementValue != null || item.settlementCurrency != null)
      ) {
        duplicate.settlementValue = item.settlementValue ?? duplicate.settlementValue ?? null;
        duplicate.settlementCurrency = item.settlementCurrency ?? duplicate.settlementCurrency ?? null;
        writeStore(store);
      }
      skipped += 1;
      continue;
    }

    store.transactions.push({
      ...item,
      id: store.transactions.length === 0 ? 1 : Math.max(...store.transactions.map((tx) => tx.id)) + 1
    });
    imported += 1;
  }

  writeStore(store);
  return { imported, skipped };
}

export function replaceHoldingsForAccount(accountId: number, holdings: Omit<Holding, "id">[]) {
  const store = readStore();
  const preserved = store.holdings.filter((item) => item.accountId !== accountId);
  let nextId = preserved.length === 0 ? 1 : Math.max(...preserved.map((item) => item.id)) + 1;
  const rebuilt = holdings.map((holding) => ({
    id: nextId++,
    ...holding
  }));
  store.holdings = [...preserved, ...rebuilt];
  writeStore(store);
  return rebuilt;
}

export function replaceTransactionsForAccount(accountId: number, rows: Omit<Transaction, "id">[]) {
  const store = readStore();
  const preserved = store.transactions.filter((item) => item.accountId !== accountId);
  let nextId = preserved.length === 0 ? 1 : Math.max(...preserved.map((item) => item.id)) + 1;
  const rebuilt = rows.map((row) => ({
    id: nextId++,
    ...row
  }));
  store.transactions = [...preserved, ...rebuilt];
  writeStore(store);
  return rebuilt;
}

export function clearAccountPortfolioData(accountId: number) {
  const store = readStore();
  const removedTransactions = store.transactions.filter((item) => item.accountId === accountId).length;
  const removedHoldings = store.holdings.filter((item) => item.accountId === accountId).length;
  const removedMappings = store.instrumentMappings.filter((item) => item.accountId === accountId).length;

  store.transactions = store.transactions.filter((item) => item.accountId !== accountId);
  store.holdings = store.holdings.filter((item) => item.accountId !== accountId);
  store.instrumentMappings = store.instrumentMappings.filter((item) => item.accountId !== accountId);
  writeStore(store);

  return {
    removedTransactions,
    removedHoldings,
    removedMappings
  };
}

export function addHolding(input: CreateHoldingInput) {
  const store = readStore();
  const nextId = store.holdings.length === 0 ? 1 : Math.max(...store.holdings.map((item) => item.id)) + 1;
  const holding: Holding = {
    id: nextId,
    ...input
  };
  store.holdings.push(holding);
  writeStore(store);
  return holding;
}

export function addWatchlistItem(input: CreateWatchlistInput) {
  const store = readStore();
  const nextId = store.watchlist.length === 0 ? 1 : Math.max(...store.watchlist.map((item) => item.id)) + 1;
  const item: WatchlistItem = {
    id: nextId,
    ...input
  };
  store.watchlist.push(item);
  writeStore(store);
  return item;
}

export function updateHolding(id: number, input: CreateHoldingInput) {
  const store = readStore();
  const index = store.holdings.findIndex((item) => item.id === id);
  if (index < 0) {
    return null;
  }
  store.holdings[index] = { id, ...input };
  writeStore(store);
  return store.holdings[index];
}

export function deleteHolding(id: number) {
  const store = readStore();
  const before = store.holdings.length;
  store.holdings = store.holdings.filter((item) => item.id !== id);
  writeStore(store);
  return store.holdings.length !== before;
}

export function updateWatchlistItem(id: number, input: CreateWatchlistInput) {
  const store = readStore();
  const index = store.watchlist.findIndex((item) => item.id === id);
  if (index < 0) {
    return null;
  }
  store.watchlist[index] = { id, ...input };
  writeStore(store);
  return store.watchlist[index];
}

export function deleteWatchlistItem(id: number) {
  const store = readStore();
  const before = store.watchlist.length;
  store.watchlist = store.watchlist.filter((item) => item.id !== id);
  writeStore(store);
  return store.watchlist.length !== before;
}

export function saveMarketData(input: {
  snapshots: MarketSnapshot[];
  news: NewsItem[];
  mode: "live" | "fallback";
  updatedAt: string | null;
}) {
  const store = readStore();
  store.marketSnapshots = input.snapshots;
  store.news = input.news;
  store.marketDataMode = input.mode;
  store.marketDataUpdatedAt = input.updatedAt;
  writeStore(store);
}

export function upsertInstrumentMapping(input: Omit<InstrumentMapping, "id">) {
  const store = readStore();
  const existing = store.instrumentMappings.find(
    (item) => item.accountId === input.accountId && item.sourceSymbol === input.sourceSymbol
  );
  if (existing) {
    existing.marketTicker = input.marketTicker;
    existing.label = input.label;
    writeStore(store);
    return existing;
  }
  const id = store.instrumentMappings.length === 0 ? 1 : Math.max(...store.instrumentMappings.map((item) => item.id)) + 1;
  const mapping: InstrumentMapping = { id, ...input };
  store.instrumentMappings.push(mapping);
  writeStore(store);
  return mapping;
}
