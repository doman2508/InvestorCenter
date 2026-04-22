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

export interface AuthSessionResponse {
  authenticated: boolean;
  configured: boolean;
  username: string;
  message?: string;
}

export interface MonthlyPerformancePoint {
  month: string;
  label: string;
  value: number;
  netFlow: number;
  changeValue: number | null;
  changePct: number | null;
  flowAdjustedChangeValue: number | null;
  flowAdjustedChangePct: number | null;
}

export interface MonthlyPerformanceResponse {
  generatedAt: string;
  total: {
    points: MonthlyPerformancePoint[];
  };
  accounts: Array<{
    accountId: number;
    accountName: string;
    accountType: string;
    points: MonthlyPerformancePoint[];
  }>;
}

export interface MarketScanItem {
  asset: string;
  label: string;
  marketSymbol: string;
  assetClass: string;
  signal: "WATCH LONG" | "WATCH SHORT" | "AVOID";
  strength: "HIGH" | "MEDIUM" | "LOW";
  priceNow: number;
  quoteCurrency: string;
  change1hPct: number;
  change1dPct: number;
  atr: number;
  breakout: "up" | "down" | "none";
  score: number;
  reason: string;
  riskNote: string;
  source: string;
  updatedAt: string;
}

export interface InstrumentMapping {
  id: number;
  accountId: number | null;
  sourceSymbol: string;
  marketTicker: string;
  label: string | null;
}

export interface TradeSetupResponse {
  instrument: string;
  instrumentLabel: string;
  interval: "15m" | "30m" | "1h";
  title: string;
  signal: "LONG" | "SHORT" | "WAIT";
  setupQuality: "Wysoka" | "Srednia" | "Niska";
  tradeInvalid: boolean;
  invalidReason: string | null;
  minAcceptedRR: number;
  price: number;
  quoteCurrency: string;
  fxRateToPln: number;
  dayChangePct: number;
  momentum3mPct: number;
  preferredAction: "LONG" | "SHORT" | "WAIT";
  contractSize: number;
  sizingMode: "lots" | "units";
  sizingLabel: string;
  isLeveraged: boolean;
  leverage: number;
  requiredMarginPct: number;
  minPositionSize: number;
  maxPositionSize: number;
  swapLongPerLotPerDay: number | null;
  swapShortPerLotPerDay: number | null;
  atr: number;
  setupType: string;
  watchZoneLow: number;
  watchZoneHigh: number;
  breakoutTrigger: number;
  breakdownTrigger: number;
  invalidation: number;
  tp1: number;
  tp2: number;
  riskReward: number;
  scenarioA: string;
  scenarioB: string;
  riskNote: string;
  executionNote: string;
  source: string;
  updatedAt: string;
  marketDataMode: "live" | "fallback";
  atrPlan: {
    direction: "LONG" | "SHORT";
    entry: number;
    sl: number;
    tp1: number;
    tp2: number;
    riskReward: number;
    comment: string;
  };
  structurePlan: {
    direction: "LONG" | "SHORT";
    entry: number;
    sl: number;
    tp1: number;
    tp2: number;
    riskReward: number;
    basis: string;
    comment: string;
  };
  candles: Array<{
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
  }>;
}
