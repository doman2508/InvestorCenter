export type AlertPriority = "high" | "medium" | "low";

export interface AlertEvent {
  id: string;
  priority: AlertPriority;
  category: string;
  title: string;
  changed: string;
  whyItMatters: string;
  considerAction: string;
  symbol?: string;
  accountName?: string;
  stale?: boolean;
}

export interface DailyBrief {
  generatedAt: string;
  summary: string;
  activeAlerts: AlertEvent[];
  opportunityRadar: Array<{
    id: string;
    symbol: string;
    title: string;
    assetClass: string;
    priceNow: number;
    quoteCurrency: string;
    change1dPct: number;
    momentum3mPct: number;
    setup: string;
    whyNow: string;
    risk: string;
    decisionNote: string;
    actionBias: "watch" | "buy-on-pullback" | "momentum" | "trim-risk";
    source: string;
    updatedAt: string;
  }>;
  marketContext: Array<{
    headline: string;
    detail: string;
  }>;
  newsDigest: Array<{
    id: number;
    symbol: string | null;
    headline: string;
    source: string;
    summary: string;
    impact: "positive" | "neutral" | "negative";
    publishedAt: string;
  }>;
  marketDataStatus: {
    lastUpdatedAt: string | null;
    mode: "live" | "fallback";
  };
}

export interface PortfolioSnapshot {
  totalValue: number;
  dayChangePct: number;
  allocationByClass: Array<{
    assetClass: string;
    value: number;
    pct: number;
    targetPct: number;
    driftPct: number;
  }>;
  accounts: Array<{
    id: number;
    name: string;
    type: string;
    baseCurrency: string;
    targetAllocationPct: number;
    currentValue: number;
    holdings: Array<{
      id: number;
      symbol: string;
      name: string;
      assetClass: string;
      quantity: number;
      averageCost: number;
      currentPrice: number;
      currency: string;
      costBasisPln?: number | null;
      impliedFxRateToPln?: number | null;
      targetAllocationPct: number;
      maturityDate: string | null;
      marketValue: number;
      dayChangePct: number;
      unrealizedPnL: number;
    }>;
  }>;
}

export interface WatchlistItem {
  id: number;
  symbol: string;
  name: string;
  assetClass: string;
  thesis: string;
  thesisTag: string;
  lastPrice: number;
  priceChange1dPct: number;
  momentum3mPct: number;
  dataFreshness: "fresh" | "stale";
}

export interface DashboardResponse {
  dailyBrief: DailyBrief;
  portfolio: PortfolioSnapshot;
  watchlist: WatchlistItem[];
}

export interface InstrumentMapping {
  id: number;
  accountId: number | null;
  sourceSymbol: string;
  marketTicker: string;
  label: string | null;
}
