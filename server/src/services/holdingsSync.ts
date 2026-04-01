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

function reconstructAccountHoldings(accountName: string) {
  const account = getAccounts().find((item) => item.name === accountName);
  if (!account) {
    return [];
  }

  const transactions = getTransactions()
    .filter((tx) => tx.accountId === account.id && (tx.type === "BUY" || tx.type === "SELL"))
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));

  const snapshots = new Map(getMarketSnapshots().map((item) => [item.symbol, item]));
  const mappings = new Map(getInstrumentMappings().map((item) => [item.sourceSymbol, item]));
  const state = new Map<
    string,
    {
      quantity: number;
      costValue: number;
      currency: string;
      costBasisPln: number;
    }
  >();

  for (const tx of transactions) {
    const current = state.get(tx.symbol) ?? {
      quantity: 0,
      costValue: 0,
      currency: tx.currency,
      costBasisPln: 0
    };

    if (tx.type === "BUY") {
      current.quantity += tx.quantity;
      current.costValue += tx.quantity * tx.price + tx.fees;
      current.currency = tx.currency;
      current.costBasisPln += tx.settlementCurrency === "PLN" && typeof tx.settlementValue === "number"
        ? tx.settlementValue
        : tx.quantity * tx.price + tx.fees;
      state.set(tx.symbol, current);
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
        state.delete(tx.symbol);
      } else {
        state.set(tx.symbol, current);
      }
    }
  }

  const holdings: Omit<Holding, "id">[] = Array.from(state.entries())
    .filter(([, item]) => item.quantity > 0.000001)
    .map(([symbol, item]) => {
      const snapshot = snapshots.get(symbol);
      const mapping = mappings.get(symbol);
      const averageCost = item.quantity === 0 ? 0 : item.costValue / item.quantity;
      const costBasisPln = Number(item.costBasisPln.toFixed(6));
      const impliedFxRateToPln =
        item.quantity === 0 || averageCost === 0 ? null : Number((costBasisPln / (item.quantity * averageCost)).toFixed(6));
      return {
        accountId: account.id,
        symbol,
        name: buildName(symbol),
        assetClass: inferAssetClass(symbol, mapping?.label),
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
