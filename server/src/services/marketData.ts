import {
  getInstrumentMappings,
  getMarketDataStatus,
  getMarketSnapshots,
  getHoldings,
  getNews,
  getWatchlist,
  saveMarketData
} from "../repository.js";
import type { MarketRefreshResult, MarketSnapshot, NewsItem } from "../types.js";

type ChartResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      meta?: {
        currency?: string;
      };
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
        }>;
      };
    }>;
  };
};

type SnapshotFetchResult =
  | {
      snapshot: MarketSnapshot;
      error?: never;
    }
  | {
      snapshot?: never;
      error: string;
    };

const FX_REFERENCE: Record<string, number> = {
  PLN: 1,
  USD: 3.7,
  EUR: 4.3,
  GBP: 5
};

const OPPORTUNITY_SYMBOLS = [
  { sourceSymbol: "OPP-OIL-BRENT", marketSymbol: "BZ=F" },
  { sourceSymbol: "OPP-OIL-WTI", marketSymbol: "CL=F" },
  { sourceSymbol: "OPP-ENERGY", marketSymbol: "XLE" },
  { sourceSymbol: "OPP-WORLD", marketSymbol: "ACWI" },
  { sourceSymbol: "OPP-GOLD", marketSymbol: "GLD" },
  { sourceSymbol: "OPP-TECH", marketSymbol: "QQQ" },
  { sourceSymbol: "OPP-DEFENSE", marketSymbol: "ITA" },
  { sourceSymbol: "OPP-SEMIS", marketSymbol: "SOXX" },
  { sourceSymbol: "OPP-QUALITY", marketSymbol: "QUAL" },
  { sourceSymbol: "OPP-EM", marketSymbol: "EEM" }
];

function uniqueSymbols() {
  const mappings = new Map(getInstrumentMappings().map((item) => [item.sourceSymbol, item.marketTicker]));
  const targets = new Map<string, string>();
  getHoldings().forEach((item) => {
    targets.set(item.symbol, mappings.get(item.symbol) ?? item.symbol);
  });
  getWatchlist().forEach((item) => {
    targets.set(item.symbol, mappings.get(item.symbol) ?? item.symbol);
  });
  OPPORTUNITY_SYMBOLS.forEach((item) => {
    if (!targets.has(item.sourceSymbol)) {
      targets.set(item.sourceSymbol, item.marketSymbol);
    }
  });
  return Array.from(targets.entries()).map(([sourceSymbol, marketSymbol]) => ({ sourceSymbol, marketSymbol }));
}

function normalizeProviderTicker(symbol: string) {
  const upper = symbol.trim().toUpperCase();
  if (!upper) {
    return upper;
  }
  if (upper.endsWith(".US")) {
    return upper.slice(0, -3);
  }
  if (upper.endsWith(".UK")) {
    return `${upper.slice(0, -3)}.L`;
  }
  if (upper.endsWith(".NL")) {
    return `${upper.slice(0, -3)}.AS`;
  }
  if (upper.endsWith(".PL")) {
    return `${upper.slice(0, -3)}.WA`;
  }
  return upper;
}

function candidateTickers(symbol: string) {
  const raw = symbol.trim().toUpperCase();
  const normalized = normalizeProviderTicker(raw);
  return Array.from(new Set([raw, normalized].filter(Boolean)));
}

function decodeHtml(input: string) {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"");
}

function extractTag(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decodeHtml(match[1].trim()) : "";
}

function parseNewsRss(xml: string): NewsItem[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  return items.slice(0, 5).map((block, index) => ({
    id: index + 1,
    symbol: null,
    headline: extractTag(block, "title"),
    source: extractTag(block, "source") || "Google News",
    summary: extractTag(block, "description").replace(/<[^>]+>/g, "").slice(0, 220),
    impact: "neutral" as const,
    publishedAt: extractTag(block, "pubDate") || new Date().toISOString()
  }));
}

function buildFallbackResult(message: string): MarketRefreshResult {
  const status = getMarketDataStatus();
  return {
    ok: true,
    mode: "fallback",
    snapshotsUpdated: getMarketSnapshots().length,
    newsUpdated: getNews().length,
    lastUpdatedAt: status.lastUpdatedAt,
    message
  };
}

async function fetchChartSnapshot(
  fetchImpl: typeof fetch,
  sourceSymbol: string,
  marketSymbol: string
): Promise<SnapshotFetchResult> {
  const errors: string[] = [];

  for (const candidate of candidateTickers(marketSymbol)) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(candidate)}?interval=1d&range=3mo`;
    const response = await fetchImpl(url, {
      headers: {
        "User-Agent": "InvestorCenter/1.0"
      }
    });

    if (!response.ok) {
      errors.push(`${candidate}: ${response.status}`);
      continue;
    }

    const body = (await response.json()) as ChartResponse;
    const result = body.chart?.result?.[0];
    const timestamps = result?.timestamp ?? [];
    const closes: Array<number | null> = result?.indicators?.quote?.[0]?.close ?? [];
    const validCloses = closes.filter((value: number | null): value is number => typeof value === "number");

    if (timestamps.length < 2 || validCloses.length < 2) {
      errors.push(`${candidate}: no usable candles`);
      continue;
    }

    const lastPrice = validCloses[validCloses.length - 1];
    const previousClose = validCloses[validCloses.length - 2];
    const startClose = validCloses[0];

    return {
      snapshot: {
        symbol: sourceSymbol,
        marketSymbol: candidate,
        lastPrice,
        previousClose,
        priceChange1dPct: previousClose === 0 ? 0 : ((lastPrice - previousClose) / previousClose) * 100,
        momentum3mPct: startClose === 0 ? 0 : ((lastPrice - startClose) / startClose) * 100,
        quoteCurrency: (result?.meta?.currency ?? "PLN").toUpperCase(),
        fxRateToPln: 1,
        updatedAt: new Date((timestamps[timestamps.length - 1] as number) * 1000).toISOString(),
        source: "yahoo-finance"
      } satisfies MarketSnapshot
    };
  }

  return {
    error: `Market request failed for ${marketSymbol}. ${errors.join("; ")}`
  };
}

async function fetchFxRates(fetchImpl: typeof fetch, currencies: string[]) {
  const rates = new Map<string, number>([["PLN", 1]]);

  await Promise.all(
    currencies
      .filter((currency) => currency && currency !== "PLN")
      .map(async (currency) => {
        try {
          const response = await fetchImpl(
            `https://api.nbp.pl/api/exchangerates/rates/a/${encodeURIComponent(currency.toLowerCase())}/?format=json`,
            {
              headers: {
                "User-Agent": "InvestorCenter/1.0"
              }
            }
          );
          if (!response.ok) {
            rates.set(currency, FX_REFERENCE[currency] ?? 1);
            return;
          }
          const body = (await response.json()) as { rates?: Array<{ mid?: number }> };
          const mid = body.rates?.[0]?.mid;
          rates.set(currency, typeof mid === "number" ? mid : FX_REFERENCE[currency] ?? 1);
        } catch {
          rates.set(currency, FX_REFERENCE[currency] ?? 1);
        }
      })
  );

  return rates;
}

function mergeSnapshots(nextSnapshots: MarketSnapshot[]) {
  const merged = new Map(getMarketSnapshots().map((item) => [item.symbol, item]));
  nextSnapshots.forEach((item) => {
    merged.set(item.symbol, item);
  });
  return Array.from(merged.values());
}

export async function refreshMarketData(fetchImpl: typeof fetch = fetch): Promise<MarketRefreshResult> {
  const symbols = uniqueSymbols();
  if (symbols.length === 0) {
    return buildFallbackResult("No symbols to refresh.");
  }

  const results = await Promise.all(
    symbols.map(({ sourceSymbol, marketSymbol }) => fetchChartSnapshot(fetchImpl, sourceSymbol, marketSymbol))
  );

  const successfulSnapshots: MarketSnapshot[] = [];
  results.forEach((result) => {
    if (result.snapshot) {
      successfulSnapshots.push(result.snapshot);
    }
  });
  const errors = results.flatMap((result) => ("error" in result ? [result.error] : []));

  if (successfulSnapshots.length === 0) {
    return buildFallbackResult(errors[0] ?? "Live providers returned no usable market snapshots.");
  }

  const fxRates = await fetchFxRates(
    fetchImpl,
    Array.from(new Set(successfulSnapshots.map((item) => item.quoteCurrency)))
  );
  const pricedSnapshots: MarketSnapshot[] = successfulSnapshots.map((item) => ({
    ...item,
    fxRateToPln: fxRates.get(item.quoteCurrency) ?? FX_REFERENCE[item.quoteCurrency] ?? 1
  }));

  let news = getNews();
  try {
    const newsSymbols = pricedSnapshots.slice(0, 4).map((item) => item.marketSymbol ?? item.symbol);
    const rssQuery = encodeURIComponent(`${newsSymbols.join(" OR ")} stock market OR investing OR oil`);
    const rssResponse = await fetchImpl(`https://news.google.com/rss/search?q=${rssQuery}&hl=en-US&gl=US&ceid=US:en`, {
      headers: {
        "User-Agent": "InvestorCenter/1.0"
      }
    });
    if (rssResponse.ok) {
      news = parseNewsRss(await rssResponse.text());
    }
  } catch {
    news = getNews();
  }

  const updatedAt = new Date().toISOString();
  saveMarketData({
    snapshots: mergeSnapshots(pricedSnapshots),
    news,
    mode: "live",
    updatedAt
  });

  const suffix =
    errors.length > 0 ? ` ${errors.length} symbols failed and kept their previous snapshots.` : "";

  return {
    ok: true,
    mode: "live",
    snapshotsUpdated: pricedSnapshots.length,
    newsUpdated: news.length,
    lastUpdatedAt: updatedAt,
    message: `Market data refreshed for ${pricedSnapshots.length} symbols.${suffix}`
  };
}
