import type { MarketScanItem } from "../types.js";

type SupportedAsset = {
  asset: string;
  label: string;
  marketSymbol: string;
  assetClass: MarketScanItem["assetClass"];
};

type ChartResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      meta?: {
        currency?: string;
      };
      indicators?: {
        quote?: Array<{
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
        }>;
      };
    }>;
  };
};

const RADAR_ASSETS: SupportedAsset[] = [
  { asset: "WTI", label: "WTI Oil", marketSymbol: "CL=F", assetClass: "COMMODITY" },
  { asset: "GOLD", label: "Gold", marketSymbol: "GLD", assetClass: "COMMODITY" },
  { asset: "SP500", label: "S&P 500", marketSymbol: "SPY", assetClass: "INDEX" },
  { asset: "NASDAQ", label: "NASDAQ", marketSymbol: "QQQ", assetClass: "INDEX" },
  { asset: "EURUSD", label: "EUR/USD", marketSymbol: "EURUSD=X", assetClass: "FX" },
  { asset: "ETF_ENERGY", label: "ETF Energy", marketSymbol: "XLE", assetClass: "ETF" },
  { asset: "ETF_MSCI_ACWI", label: "ETF MSCI ACWI", marketSymbol: "ACWI", assetClass: "ETF" },
  { asset: "MSCI_WORLD", label: "MSCI World", marketSymbol: "IQQW.DE", assetClass: "ETF" },
  { asset: "NVIDIA", label: "Nvidia", marketSymbol: "NVDA", assetClass: "STOCK" },
  { asset: "KGHM", label: "KGHM", marketSymbol: "KGH.WA", assetClass: "STOCK" },
  { asset: "ORLEN", label: "Orlen", marketSymbol: "PKN.WA", assetClass: "STOCK" },
  { asset: "PKO_BP", label: "PKO BP", marketSymbol: "PKO.WA", assetClass: "STOCK" },
  { asset: "PZU", label: "PZU", marketSymbol: "PZU.WA", assetClass: "STOCK" },
  { asset: "MBANK", label: "mBank", marketSymbol: "MBK.WA", assetClass: "STOCK" },
  { asset: "TAURON", label: "Tauron", marketSymbol: "TPE.WA", assetClass: "STOCK" }
];

function round(value: number) {
  return Number(value.toFixed(2));
}

function calculateAtr(closes: number[], highs: number[], lows: number[], period: number) {
  if (closes.length < 2 || highs.length < 2 || lows.length < 2) {
    return 0;
  }

  const trueRanges: number[] = [];
  for (let index = 1; index < closes.length; index += 1) {
    trueRanges.push(
      Math.max(
        highs[index] - lows[index],
        Math.abs(highs[index] - closes[index - 1]),
        Math.abs(lows[index] - closes[index - 1])
      )
    );
  }
  const lookback = Math.max(1, Math.min(period, trueRanges.length));
  const recent = trueRanges.slice(-lookback);
  return recent.reduce((sum, value) => sum + value, 0) / recent.length;
}

async function scanOneAsset(fetchImpl: typeof fetch, asset: SupportedAsset): Promise<MarketScanItem | null> {
  const response = await fetchImpl(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(asset.marketSymbol)}?interval=1h&range=5d`,
    {
      headers: {
        "User-Agent": "InvestorCenter/1.0"
      }
    }
  );

  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as ChartResponse;
  const result = body.chart?.result?.[0];
  const closesRaw = result?.indicators?.quote?.[0]?.close ?? [];
  const highsRaw = result?.indicators?.quote?.[0]?.high ?? [];
  const lowsRaw = result?.indicators?.quote?.[0]?.low ?? [];
  const timestamps = result?.timestamp ?? [];

  const points = closesRaw
    .map((close, index) => ({
      close,
      high: highsRaw[index],
      low: lowsRaw[index],
      timestamp: timestamps[index]
    }))
    .filter(
      (item): item is { close: number; high: number; low: number; timestamp: number } =>
        typeof item.close === "number" &&
        typeof item.high === "number" &&
        typeof item.low === "number" &&
        typeof item.timestamp === "number"
    );

  if (points.length < 30) {
    return null;
  }

  const closes = points.map((item) => item.close);
  const highs = points.map((item) => item.high);
  const lows = points.map((item) => item.low);
  const latest = closes[closes.length - 1];
  const oneHourAgo = closes[closes.length - 2];
  const oneDayAgo = closes[Math.max(0, closes.length - 8)];
  const recentHigh = Math.max(...highs.slice(-20, -1));
  const recentLow = Math.min(...lows.slice(-20, -1));
  const atr = calculateAtr(closes, highs, lows, 14);
  const atrPct = latest === 0 ? 0 : (atr / latest) * 100;
  const change1hPct = oneHourAgo === 0 ? 0 : ((latest - oneHourAgo) / oneHourAgo) * 100;
  const change1dPct = oneDayAgo === 0 ? 0 : ((latest - oneDayAgo) / oneDayAgo) * 100;
  const brokeUp = latest > recentHigh;
  const brokeDown = latest < recentLow;

  let score = 0;
  if (change1hPct > 0.35) score += 1;
  if (change1dPct > 1.1) score += 2;
  if (brokeUp) score += 2;
  if (change1hPct < -0.35) score -= 1;
  if (change1dPct < -1.1) score -= 2;
  if (brokeDown) score -= 2;
  if (atrPct > 1.8) score += score >= 0 ? 1 : -1;

  let signal: MarketScanItem["signal"] = "AVOID";
  let breakout: MarketScanItem["breakout"] = "none";
  let reason = "Brak wyraznej przewagi. Rynek jest w srodku zakresu albo sygnaly sa mieszane.";
  let riskNote = "Bez potwierdzenia lepiej traktowac to jako obserwacje, nie trade.";

  if (score >= 3) {
    signal = "WATCH LONG";
    breakout = brokeUp ? "up" : "none";
    reason = brokeUp
      ? "Wybicie lokalnych szczytow + dodatnie momentum 1h i 1d."
      : "Rosnace momentum i wystarczajaca zmiennosc do dalszej obserwacji long.";
    riskNote = "Sprawdz, czy rynek nie jest juz rozciagniety. Najlepiej szukac wejscia dopiero po potwierdzeniu.";
  } else if (score <= -3) {
    signal = "WATCH SHORT";
    breakout = brokeDown ? "down" : "none";
    reason = brokeDown
      ? "Zlamanie lokalnych dolkow + ujemne momentum 1h i 1d."
      : "Slabosc intraday i dzienna zaczyna przechodzic w scenariusz short.";
    riskNote = "Short wymaga kontroli ryzyka, bo szybki powrot nad zakres moze zanegowac uklad.";
  }

  const strength: MarketScanItem["strength"] =
    Math.abs(score) >= 4 ? "HIGH" : Math.abs(score) >= 2 ? "MEDIUM" : "LOW";

  return {
    asset: asset.asset,
    label: asset.label,
    marketSymbol: asset.marketSymbol,
    assetClass: asset.assetClass,
    signal,
    strength,
    priceNow: round(latest),
    quoteCurrency: (result?.meta?.currency ?? "USD").toUpperCase(),
    change1hPct: round(change1hPct),
    change1dPct: round(change1dPct),
    atr: round(atr),
    breakout,
    score,
    reason,
    riskNote,
    source: "yahoo-finance",
    updatedAt: new Date(points[points.length - 1].timestamp * 1000).toISOString()
  };
}

export async function scanMarket(fetchImpl: typeof fetch = fetch): Promise<MarketScanItem[]> {
  const results = await Promise.all(RADAR_ASSETS.map((asset) => scanOneAsset(fetchImpl, asset)));
  return results
    .filter((item): item is MarketScanItem => item !== null)
    .sort((a, b) => {
      const order = { "WATCH LONG": 0, "WATCH SHORT": 1, AVOID: 2 };
      return order[a.signal] - order[b.signal] || Math.abs(b.score) - Math.abs(a.score);
    });
}
