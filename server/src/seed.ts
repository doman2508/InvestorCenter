import { readStore, writeStore } from "./db.js";

export function seedDb() {
  const store = readStore();
  if (store.accounts.length > 0) {
    return;
  }

  store.accounts = [
    { id: 1, name: "IKE", type: "IKE", baseCurrency: "PLN", targetAllocationPct: 0 },
    { id: 2, name: "IKZE", type: "IKZE", baseCurrency: "PLN", targetAllocationPct: 0 },
    { id: 3, name: "XTB", type: "BROKERAGE", baseCurrency: "PLN", targetAllocationPct: 0 },
    { id: 4, name: "Obligacje Skarbowe", type: "SAVINGS", baseCurrency: "PLN", targetAllocationPct: 0 }
  ];

  store.holdings = [];
  store.transactions = [];
  store.watchlist = [];
  store.alertRules = [
    { id: 1, scope: "portfolio", category: "allocation", symbol: null, threshold: 5, enabled: true },
    { id: 2, scope: "portfolio", category: "bond_maturity", symbol: null, threshold: 365, enabled: true },
    { id: 3, scope: "portfolio", category: "contribution", symbol: null, threshold: 30, enabled: true },
    { id: 4, scope: "watchlist", category: "price_move", symbol: null, threshold: 3, enabled: true },
    { id: 5, scope: "watchlist", category: "trend", symbol: null, threshold: 10, enabled: true }
  ];
  store.news = [];
  store.marketSnapshots = [];
  store.marketDataMode = "fallback";
  store.marketDataUpdatedAt = null;
  store.instrumentMappings = [];

  writeStore(store);
}
