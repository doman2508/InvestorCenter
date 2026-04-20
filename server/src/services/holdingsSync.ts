import { getAccounts, getInstrumentMappings, getMarketSnapshots, getTransactions, replaceHoldingsForAccount } from "../repository.js";
import type { AssetClass, Holding, Transaction } from "../types.js";

function inferAssetClass(symbol: string, label?: string | null): AssetClass {
  const upper = `${symbol} ${label ?? ""}`.toUpperCase();
  if (upper.includes("MSCI") || upper.includes("ETF") || upper.includes(".UK")) {
    return "ETF";
  }
  if (upper.includes("OIL") || upper === "CL=F") {
    return "COMMODITY";
  }
  if (upper.includes("BOND") || upper.startsWith("EDO") || upper.startsWith("COI")) {
    return "BOND";
  }
  return "STOCK";
}

function buildName(symbol: string) {
  return symbol
    .replace(/\.UK$/i, "")
    .replace(/\.PL$/i, "")
    .replace(/\.US$/i, "")
    .replace(/-/g, " ");
}

function buildSymbolCanonicalizer() {
  const mappings = getInstrumentMappings();
  const sourceToMarket = new Map(mappings.map((item) => [item.sourceSymbol, item.marketTicker]));
  const marketToLabel = new Map(mappings.map((item) => [item.marketTicker, item.label ?? item.sourceSymbol]));
  const sourceToLabel = new Map(mappings.map((item) => [item.sourceSymbol, item.label ?? item.sourceSymbol]));

  function canonicalSymbol(symbol: string) {
    return sourceToMarket.get(symbol) ?? symbol;
  }

  function resolveLabel(symbol: string) {
    return sourceToLabel.get(symbol) ?? marketToLabel.get(symbol) ?? null;
  }

  return {
    canonicalSymbol,
    resolveLabel,
    hasMapping(symbol: string) {
      return sourceToMarket.has(symbol);
    }
  };
}

function normalizeTransactionsForHoldings(transactions: Transaction[]) {
  type EnrichedTransaction = Transaction & { canonical: string };
  type GroupedBucket = {
    canonical: string;
    rows: EnrichedTransaction[];
    byRaw: Map<string, { quantity: number; rows: EnrichedTransaction[] }>;
  };
  const { canonicalSymbol, hasMapping } = buildSymbolCanonicalizer();
  const grouped = new Map<string, GroupedBucket>();

  for (const tx of transactions) {
    const canonical = canonicalSymbol(tx.symbol);
    const key = `${canonical}|${tx.type}|${tx.tradeDate}|${tx.price}`;
    const bucket: GroupedBucket = grouped.get(key) ?? {
      canonical,
      rows: [],
      byRaw: new Map<string, { quantity: number; rows: EnrichedTransaction[] }>()
    };
    const enriched: EnrichedTransaction = { ...tx, canonical };
    bucket.rows.push(enriched);
    const raw = bucket.byRaw.get(tx.symbol) ?? { quantity: 0, rows: [] as EnrichedTransaction[] };
    raw.quantity += tx.quantity;
    raw.rows.push(enriched);
    bucket.byRaw.set(tx.symbol, raw);
    grouped.set(key, bucket);
  }

  const result: Transaction[] = [];

  for (const bucket of grouped.values()) {
    if (bucket.byRaw.size <= 1) {
      result.push(...bucket.rows);
      continue;
    }

    const canonicalRaw = bucket.byRaw.get(bucket.canonical);
    if (!canonicalRaw) {
      result.push(...bucket.rows);
      continue;
    }

    const legacyQuantity = Array.from(bucket.byRaw.entries())
      .filter(([raw]) => raw !== bucket.canonical && hasMapping(raw))
      .reduce((sum, [, item]) => sum + item.quantity, 0);

    if (legacyQuantity > 0 && Math.abs(legacyQuantity - canonicalRaw.quantity) < 0.000001) {
      result.push(...canonicalRaw.rows);
      continue;
    }

    result.push(...bucket.rows);
  }

  return result.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
}

function reconstructAccountHoldings(accountName: string) {
  const account = getAccounts().find((item) => item.name === accountName);
  if (!account) {
    return [];
  }

  const transactions = getTransactions()
    .filter((tx) => tx.accountId === account.id && (tx.type === "BUY" || tx.type === "SELL"))
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));

  const normalizedTransactions = normalizeTransactionsForHoldings(transactions);

  const snapshots = new Map(getMarketSnapshots().map((item) => [item.symbol, item]));
  const { canonicalSymbol, resolveLabel } = buildSymbolCanonicalizer();
  const state = new Map<
    string,
    {
      quantity: number;
      costValue: number;
      currency: string;
      costBasisPln: number;
      label: string | null;
    }
  >();

  for (const tx of normalizedTransactions) {
    const symbol = canonicalSymbol(tx.symbol);
    const current = state.get(symbol) ?? {
      quantity: 0,
      costValue: 0,
      currency: tx.currency,
      costBasisPln: 0,
      label: resolveLabel(tx.symbol)
    };

    if (tx.type === "BUY") {
      current.quantity += tx.quantity;
      current.costValue += tx.quantity * tx.price + tx.fees;
      current.currency = tx.currency;
      current.label = current.label ?? resolveLabel(tx.symbol);
      current.costBasisPln += tx.settlementCurrency === "PLN" && typeof tx.settlementValue === "number"
        ? tx.settlementValue
        : tx.quantity * tx.price + tx.fees;
      state.set(symbol, current);
      continue;
    }

    if (tx.type === "SELL") {
      if (current.quantity <= 0) {
        continue;
      }
      const averageCost = current.quantity === 0 ? 0 : current.costValue / current.quantity;
      const averageCostPln = current.quantity === 0 ? 0 : current.costBasisPln / current.quantity;
      const reducedQty = Math.min(current.quantity, tx.quantity);
      current.quantity -= reducedQty;
      current.costValue -= averageCost * reducedQty;
      current.costBasisPln -= averageCostPln * reducedQty;
      if (current.quantity <= 0.000001) {
        state.delete(symbol);
      } else {
        state.set(symbol, current);
      }
    }
  }

  const holdings: Omit<Holding, "id">[] = Array.from(state.entries())
    .filter(([, item]) => item.quantity > 0.000001)
    .map(([symbol, item]) => {
      const snapshot = snapshots.get(symbol);
      const averageCost = item.quantity === 0 ? 0 : item.costValue / item.quantity;
      const costBasisPln = Number(item.costBasisPln.toFixed(6));
      const impliedFxRateToPln =
        item.quantity === 0 || averageCost === 0 ? null : Number((costBasisPln / (item.quantity * averageCost)).toFixed(6));
      const label = item.label ?? resolveLabel(symbol);
      return {
        accountId: account.id,
        symbol,
        name: label ?? buildName(symbol),
        assetClass: inferAssetClass(symbol, label),
        quantity: Number(item.quantity.toFixed(6)),
        averageCost: Number(averageCost.toFixed(6)),
        currentPrice: snapshot?.lastPrice ?? averageCost,
        currency: item.currency,
        costBasisPln,
        impliedFxRateToPln,
        targetAllocationPct: 0,
        maturityDate: null
      };
    });

  return replaceHoldingsForAccount(account.id, holdings);
}

export function syncHoldingsForAccount(accountName: string) {
  const rebuilt = reconstructAccountHoldings(accountName);
  return {
    accountName,
    rebuilt: rebuilt.length
  };
}

export function syncPortfolioHoldings() {
  const rebuiltXtb = reconstructAccountHoldings("XTB");
  return {
    rebuiltXtb: rebuiltXtb.length
  };
}
