import { getAccounts, getHoldings, getInstrumentMappings, getMarketSnapshots, getTransactions } from "../repository.js";

type MonthlyPoint = {
  month: string;
  label: string;
  value: number;
  netFlow: number;
  changeValue: number | null;
  changePct: number | null;
  flowAdjustedChangeValue: number | null;
  flowAdjustedChangePct: number | null;
};

type MonthlySeries = {
  accountId: number;
  accountName: string;
  accountType: string;
  points: MonthlyPoint[];
};

export interface MonthlyPerformanceResponse {
  generatedAt: string;
  total: {
    points: MonthlyPoint[];
  };
  accounts: MonthlySeries[];
}

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

const FX_REFERENCE: Record<string, number> = {
  PLN: 1,
  USD: 3.7,
  EUR: 4.3,
  GBP: 5
};

function monthLabel(month: string) {
  const [year, monthPart] = month.split("-");
  return `${monthPart}.${year}`;
}

function extractMonth(value: string) {
  return value.slice(0, 7);
}

function addMonth(month: string) {
  const [yearRaw, monthRaw] = month.split("-").map(Number);
  const date = new Date(Date.UTC(yearRaw, monthRaw - 1, 1));
  date.setUTCMonth(date.getUTCMonth() + 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthRange(startMonth: string, endMonth: string) {
  const months: string[] = [];
  let current = startMonth;
  while (current <= endMonth) {
    months.push(current);
    current = addMonth(current);
  }
  return months;
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

function canonicalizeSymbol(symbol: string, sourceToMarket: Map<string, string>) {
  return sourceToMarket.get(symbol) ?? symbol;
}

function estimatePlnValue(value: number, currency: string) {
  return value * (FX_REFERENCE[currency.toUpperCase()] ?? 1);
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
            { headers: { "User-Agent": "InvestorCenter/1.0" } }
          );
          if (!response.ok) {
            rates.set(currency, FX_REFERENCE[currency] ?? 1);
            return;
          }
          const body = (await response.json()) as { rates?: Array<{ mid?: number }> };
          rates.set(currency, body.rates?.[0]?.mid ?? FX_REFERENCE[currency] ?? 1);
        } catch {
          rates.set(currency, FX_REFERENCE[currency] ?? 1);
        }
      })
  );

  return rates;
}

async function fetchMonthlyPriceHistory(
  fetchImpl: typeof fetch,
  symbol: string,
  startMonth: string,
  endMonth: string
) {
  const start = new Date(`${startMonth}-01T00:00:00Z`);
  const end = new Date(`${addMonth(endMonth)}-01T00:00:00Z`);
  const period1 = Math.floor(start.getTime() / 1000);
  const period2 = Math.floor(end.getTime() / 1000);
  const errors: string[] = [];

  for (const candidate of candidateTickers(symbol)) {
    try {
      const response = await fetchImpl(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(candidate)}?period1=${period1}&period2=${period2}&interval=1mo`,
        { headers: { "User-Agent": "InvestorCenter/1.0" } }
      );
      if (!response.ok) {
        errors.push(`${candidate}: ${response.status}`);
        continue;
      }
      const body = (await response.json()) as ChartResponse;
      const result = body.chart?.result?.[0];
      const timestamps = result?.timestamp ?? [];
      const closes = result?.indicators?.quote?.[0]?.close ?? [];
      if (!timestamps.length || !closes.length) {
        errors.push(`${candidate}: no candles`);
        continue;
      }

      const monthToClose = new Map<string, number>();
      timestamps.forEach((timestamp, index) => {
        const close = closes[index];
        if (typeof close !== "number") {
          return;
        }
        const iso = new Date(timestamp * 1000).toISOString().slice(0, 7);
        monthToClose.set(iso, close);
      });

      return {
        marketSymbol: candidate,
        quoteCurrency: (result?.meta?.currency ?? "PLN").toUpperCase(),
        monthToClose
      };
    } catch (error) {
      errors.push(`${candidate}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  return {
    marketSymbol: symbol,
    quoteCurrency: "PLN",
    monthToClose: new Map<string, number>(),
    error: errors.join("; ")
  };
}

function buildMonthlyPoints(values: Array<{ month: string; value: number; netFlow: number }>): MonthlyPoint[] {
  let previous: number | null = null;
  return values.map(({ month, value, netFlow }) => {
    const changeValue = previous == null ? null : value - previous;
    const changePct =
      previous == null || previous === 0 || changeValue == null ? null : (changeValue / previous) * 100;
    const flowAdjustedChangeValue = changeValue == null ? null : changeValue - netFlow;
    const flowAdjustedChangePct =
      previous == null || previous === 0 || flowAdjustedChangeValue == null ? null : (flowAdjustedChangeValue / previous) * 100;
    previous = value;
    return {
      month,
      label: monthLabel(month),
      value,
      netFlow,
      changeValue,
      changePct: changeValue == null ? null : changePct,
      flowAdjustedChangeValue,
      flowAdjustedChangePct
    };
  });
}

export async function getMonthlyPerformance(fetchImpl: typeof fetch = fetch): Promise<MonthlyPerformanceResponse> {
  const accounts = getAccounts();
  const holdings = getHoldings();
  const transactions = getTransactions().sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const mappings = getInstrumentMappings();
  const marketSnapshots = new Map(getMarketSnapshots().map((item) => [item.symbol, item]));
  const sourceToMarket = new Map(mappings.map((item) => [item.sourceSymbol, item.marketTicker]));

  const transactionMonths = transactions.map((item) => extractMonth(item.tradeDate));
  const latestMonth = new Date().toISOString().slice(0, 7);
  const firstMonth = transactionMonths.length > 0 ? [...transactionMonths].sort()[0] : latestMonth;
  const months = monthRange(firstMonth, latestMonth);

  const tradedSymbols = Array.from(
    new Set(
      transactions
        .filter((item) => item.type === "BUY" || item.type === "SELL")
        .map((item) => canonicalizeSymbol(item.symbol, sourceToMarket))
    )
  );

  const monthlyHistories = await Promise.all(
    tradedSymbols.map(async (symbol) => [symbol, await fetchMonthlyPriceHistory(fetchImpl, symbol, firstMonth, latestMonth)] as const)
  );
  const priceHistoryMap = new Map(monthlyHistories);
  const fxRates = await fetchFxRates(
    fetchImpl,
    Array.from(new Set(monthlyHistories.map(([, history]) => history.quoteCurrency)))
  );

  const seriesByAccount = accounts.map<MonthlySeries>((account) => {
    const accountTransactions = transactions.filter((item) => item.accountId === account.id);
    const accountHoldings = holdings.filter((item) => item.accountId === account.id);

    if (accountTransactions.length === 0) {
      const currentValue = accountHoldings.reduce((sum, holding) => {
        const snapshot = marketSnapshots.get(holding.symbol);
        const price = snapshot?.lastPrice ?? holding.currentPrice;
        const fx = snapshot?.fxRateToPln ?? holding.impliedFxRateToPln ?? FX_REFERENCE[holding.currency] ?? 1;
        return sum + holding.quantity * price * fx;
      }, 0);

      return {
        accountId: account.id,
        accountName: account.name,
        accountType: account.type,
        points: buildMonthlyPoints([{ month: latestMonth, value: currentValue, netFlow: 0 }])
      };
    }

    const points: Array<{ month: string; value: number; netFlow: number }> = [];

    for (const month of months) {
      const quantities = new Map<string, number>();
      let netFlow = 0;

      accountTransactions.forEach((transaction) => {
        if (extractMonth(transaction.tradeDate) > month) {
          return;
        }
        const canonicalSymbol = canonicalizeSymbol(transaction.symbol, sourceToMarket);

        if (transaction.type === "BUY") {
          quantities.set(canonicalSymbol, (quantities.get(canonicalSymbol) ?? 0) + transaction.quantity);
          return;
        }

        if (transaction.type === "SELL") {
          quantities.set(canonicalSymbol, (quantities.get(canonicalSymbol) ?? 0) - transaction.quantity);
          return;
        }

        if (extractMonth(transaction.tradeDate) !== month) {
          return;
        }

        if (transaction.type === "CONTRIBUTION") {
          netFlow +=
            typeof transaction.price === "number"
              ? estimatePlnValue(transaction.price, transaction.currency)
              : estimatePlnValue(transaction.settlementValue ?? 0, transaction.settlementCurrency ?? transaction.currency);
          return;
        }

        if (transaction.type === "WITHDRAWAL") {
          netFlow -=
            typeof transaction.price === "number"
              ? estimatePlnValue(transaction.price, transaction.currency)
              : estimatePlnValue(transaction.settlementValue ?? 0, transaction.settlementCurrency ?? transaction.currency);
        }
      });

      let holdingsValuePln = 0;
      quantities.forEach((quantity, symbol) => {
        if (quantity <= 0.000001) {
          return;
        }

        const priceHistory = priceHistoryMap.get(symbol);
        const monthClose = priceHistory?.monthToClose.get(month);
        const quoteCurrency = priceHistory?.quoteCurrency ?? marketSnapshots.get(symbol)?.quoteCurrency ?? "PLN";
        const fxRate = fxRates.get(quoteCurrency) ?? marketSnapshots.get(symbol)?.fxRateToPln ?? FX_REFERENCE[quoteCurrency] ?? 1;
        const fallbackPrice =
          marketSnapshots.get(symbol)?.lastPrice ??
          holdings.find((holding) => holding.accountId === account.id && canonicalizeSymbol(holding.symbol, sourceToMarket) === symbol)?.currentPrice ??
          0;
        const price = monthClose ?? fallbackPrice;
        holdingsValuePln += quantity * price * fxRate;
      });

      points.push({
        month,
        value: holdingsValuePln,
        netFlow
      });
    }

    return {
      accountId: account.id,
      accountName: account.name,
      accountType: account.type,
      points: buildMonthlyPoints(points)
    };
  });

  const totalPoints = months.map((month) => ({
    month,
    value: seriesByAccount.reduce((sum, account) => {
      const point = account.points.find((item) => item.month === month);
      return sum + (point?.value ?? 0);
    }, 0),
    netFlow: seriesByAccount.reduce((sum, account) => {
      const point = account.points.find((item) => item.month === month);
      return sum + (point?.netFlow ?? 0);
    }, 0)
  }));

  return {
    generatedAt: new Date().toISOString(),
    total: {
      points: buildMonthlyPoints(totalPoints.filter((item) => item.value !== 0 || item.month === latestMonth))
    },
    accounts: seriesByAccount
  };
}
