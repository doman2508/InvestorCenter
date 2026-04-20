export type AccountType = "IKE" | "IKZE" | "BROKERAGE" | "SAVINGS";
export type AssetClass = "ETF" | "STOCK" | "BOND" | "COMMODITY" | "CASH";
export type AlertPriority = "high" | "medium" | "low";
export type AlertCategory =
  | "allocation"
  | "price_move"
  | "trend"
  | "contribution"
  | "bond_maturity"
  | "news";

export interface PortfolioAccount {
  id: number;
  name: string;
  type: AccountType;
  baseCurrency: string;
  targetAllocationPct: number;
}

export interface Holding {
  id: number;
  accountId: number;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  quantity: number;
  averageCost: number;
  currentPrice: number;
  currency: string;
  costBasisPln?: number | null;
  impliedFxRateToPln?: number | null;
  targetAllocationPct: number;
  maturityDate: string | null;
}

export interface Transaction {
  id: number;
  accountId: number;
  symbol: string;
  tradeDate: string;
  type: "BUY" | "SELL" | "CONTRIBUTION" | "DIVIDEND" | "INTEREST" | "WITHDRAWAL" | "TAX";
  quantity: number;
  price: number;
  fees: number;
  currency: string;
  settlementValue?: number | null;
  settlementCurrency?: string | null;
}

export interface WatchlistItem {
  id: number;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  thesis: string;
  thesisTag: string;
  lastPrice: number;
  priceChange1dPct: number;
  momentum3mPct: number;
  dataFreshness: "fresh" | "stale";
}

export interface AlertRule {
  id: number;
  scope: "portfolio" | "watchlist";
  category: AlertCategory;
  symbol: string | null;
  threshold: number;
  enabled: boolean;
}

export interface AlertEvent {
  id: string;
  priority: AlertPriority;
  category: AlertCategory;
  title: string;
  changed: string;
  whyItMatters: string;
  considerAction: string;
  symbol?: string;
  accountName?: string;
  stale?: boolean;
}

export interface NewsItem {
  id: number;
  symbol: string | null;
  headline: string;
  source: string;
  summary: string;
  impact: "positive" | "neutral" | "negative";
  publishedAt: string;
}

export interface MarketSnapshot {
  symbol: string;
  marketSymbol?: string;
  lastPrice: number;
  previousClose: number;
  priceChange1dPct: number;
  momentum3mPct: number;
  quoteCurrency: string;
  fxRateToPln: number;
  updatedAt: string;
  source: string;
}

export interface InstrumentMapping {
  id: number;
  accountId: number | null;
  sourceSymbol: string;
  marketTicker: string;
  label: string | null;
}

export interface DailyBrief {
  generatedAt: string;
  summary: string;
  activeAlerts: AlertEvent[];
  opportunityRadar: Array<{
    id: string;
    symbol: string;
    title: string;
    assetClass: AssetClass;
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
  marketContext: {
    headline: string;
    detail: string;
  }[];
  newsDigest: NewsItem[];
  marketDataStatus: {
    lastUpdatedAt: string | null;
    mode: "live" | "fallback";
  };
}

export interface PortfolioSnapshot {
  totalValue: number;
  dayChangePct: number;
  allocationByClass: Array<{
    assetClass: AssetClass;
    value: number;
    pct: number;
    targetPct: number;
    driftPct: number;
  }>;
  accounts: Array<
    PortfolioAccount & {
      currentValue: number;
      holdings: Array<
        Holding & {
          marketValue: number;
          dayChangePct: number;
          unrealizedPnL: number;
        }
      >;
    }
  >;
}

export interface DashboardResponse {
  dailyBrief: DailyBrief;
  portfolio: PortfolioSnapshot;
  watchlist: WatchlistItem[];
}

export interface MarketScanItem {
  asset: string;
  label: string;
  marketSymbol: string;
  assetClass: AssetClass | "FX" | "INDEX";
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

export interface CsvImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export interface BrokerImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  notes: string[];
}

export interface MarketRefreshResult {
  ok: boolean;
  mode: "live" | "fallback";
  snapshotsUpdated: number;
  newsUpdated: number;
  lastUpdatedAt: string | null;
  message: string;
}

export interface CreateHoldingInput {
  accountId: number;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  quantity: number;
  averageCost: number;
  currentPrice: number;
  currency: string;
  targetAllocationPct: number;
  maturityDate: string | null;
}

export interface CreateWatchlistInput {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  thesis: string;
  thesisTag: string;
  lastPrice: number;
  priceChange1dPct: number;
  momentum3mPct: number;
  dataFreshness: "fresh" | "stale";
}
