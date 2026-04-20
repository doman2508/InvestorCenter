import { getMarketDataStatus, getMarketSnapshots } from "../repository.js";
import { refreshMarketData } from "./marketData.js";

type SupportedInstrument =
  | "WTI"
  | "BRENT"
  | "GOLD"
  | "NASDAQ"
  | "ETF_ENERGY"
  | "ETF_MSCI_ACWI"
  | "MSCI_WORLD"
  | "NVIDIA";
type SupportedInterval = "15m" | "30m" | "1h";

type IntradayChartResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
        }>;
      };
    }>;
  };
};

const INSTRUMENT_CONFIG: Record<
  SupportedInstrument,
  {
    snapshotSymbol: string;
    marketSymbol: string;
    label: string;
    title: string;
    riskHint: string;
    style: "commodity" | "etf";
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
  }
> = {
  WTI: {
    snapshotSymbol: "OPP-OIL-WTI",
    marketSymbol: "CL=F",
    label: "Ropa WTI",
    title: "Trade setup: ropa WTI",
    riskHint: "Ropa jest rynkiem newsowym. Jedna informacja geopolityczna potrafi wyzerowac przewage z wykresu.",
    style: "commodity",
    contractSize: 1000,
    sizingMode: "lots",
    sizingLabel: "lot",
    isLeveraged: true,
    leverage: 10,
    requiredMarginPct: 10,
    minPositionSize: 0.005,
    maxPositionSize: 90,
    swapLongPerLotPerDay: -0.041778,
    swapShortPerLotPerDay: -0.021556
  },
  BRENT: {
    snapshotSymbol: "OPP-OIL-BRENT",
    marketSymbol: "BZ=F",
    label: "Ropa Brent",
    title: "Trade setup: ropa Brent",
    riskHint: "Brent tez zyje geopolityka, ale czesto jest bardziej przydatny jako sygnal makro niz czysty scalp.",
    style: "commodity",
    contractSize: 1000,
    sizingMode: "lots",
    sizingLabel: "lot",
    isLeveraged: true,
    leverage: 10,
    requiredMarginPct: 10,
    minPositionSize: 0.005,
    maxPositionSize: 90,
    swapLongPerLotPerDay: -0.041778,
    swapShortPerLotPerDay: -0.021556
  },
  GOLD: {
    snapshotSymbol: "OPP-GOLD",
    marketSymbol: "GLD",
    label: "Zloto",
    title: "Trade setup: zloto",
    riskHint: "Zloto lubi reagowac na dolar, rentownosci i strach na rynku, wiec false starty nie sa rzadkoscia.",
    style: "etf",
    contractSize: 1,
    sizingMode: "units",
    sizingLabel: "szt.",
    isLeveraged: false,
    leverage: 1,
    requiredMarginPct: 100,
    minPositionSize: 1,
    maxPositionSize: 100000,
    swapLongPerLotPerDay: null,
    swapShortPerLotPerDay: null
  },
  NASDAQ: {
    snapshotSymbol: "OPP-TECH",
    marketSymbol: "QQQ",
    label: "Nasdaq / QQQ",
    title: "Trade setup: Nasdaq / QQQ",
    riskHint: "Nasdaq dobrze pokazuje apetyt na ryzyko, ale po mocnych sesjach bywa bardzo wrazliwy na cofniecia.",
    style: "etf",
    contractSize: 1,
    sizingMode: "units",
    sizingLabel: "szt.",
    isLeveraged: false,
    leverage: 1,
    requiredMarginPct: 100,
    minPositionSize: 1,
    maxPositionSize: 100000,
    swapLongPerLotPerDay: null,
    swapShortPerLotPerDay: null
  },
  ETF_ENERGY: {
    snapshotSymbol: "OPP-ENERGY",
    marketSymbol: "XLE",
    label: "ETF Energy",
    title: "Trade setup: ETF Energy",
    riskHint: "Energy dobrze lapie trend surowcowy, ale po mocnych ruchach czesto oddaje czesc impetu.",
    style: "etf",
    contractSize: 1,
    sizingMode: "units",
    sizingLabel: "szt.",
    isLeveraged: false,
    leverage: 1,
    requiredMarginPct: 100,
    minPositionSize: 1,
    maxPositionSize: 100000,
    swapLongPerLotPerDay: null,
    swapShortPerLotPerDay: null
  },
  ETF_MSCI_ACWI: {
    snapshotSymbol: "OPP-WORLD",
    marketSymbol: "ACWI",
    label: "ETF MSCI ACWI",
    title: "Trade setup: ETF MSCI ACWI",
    riskHint: "ACWI daje szeroki globalny przekroj, ale zwykle porusza sie spokojniej niz tematyczne ETF-y.",
    style: "etf",
    contractSize: 1,
    sizingMode: "units",
    sizingLabel: "szt.",
    isLeveraged: false,
    leverage: 1,
    requiredMarginPct: 100,
    minPositionSize: 1,
    maxPositionSize: 100000,
    swapLongPerLotPerDay: null,
    swapShortPerLotPerDay: null
  },
  MSCI_WORLD: {
    snapshotSymbol: "OPP-MSCI-WORLD",
    marketSymbol: "IQQW.DE",
    label: "MSCI World",
    title: "Trade setup: MSCI World",
    riskHint: "MSCI World jest dobrym trzonem, ale przy slabym RR lepiej traktowac go jako obserwacje, nie trade na sile.",
    style: "etf",
    contractSize: 1,
    sizingMode: "units",
    sizingLabel: "szt.",
    isLeveraged: false,
    leverage: 1,
    requiredMarginPct: 100,
    minPositionSize: 1,
    maxPositionSize: 100000,
    swapLongPerLotPerDay: null,
    swapShortPerLotPerDay: null
  },
  NVIDIA: {
    snapshotSymbol: "OPP-NVIDIA",
    marketSymbol: "NVDA",
    label: "Nvidia",
    title: "Trade setup: Nvidia",
    riskHint: "Nvidia potrafi byc bardzo dynamiczna, wiec przy slabym RR lepiej poczekac na czytelniejszy setup.",
    style: "etf",
    contractSize: 1,
    sizingMode: "units",
    sizingLabel: "szt.",
    isLeveraged: false,
    leverage: 1,
    requiredMarginPct: 100,
    minPositionSize: 1,
    maxPositionSize: 100000,
    swapLongPerLotPerDay: null,
    swapShortPerLotPerDay: null
  }
};

function roundPrice(value: number) {
  if (value >= 100) {
    return Number(value.toFixed(1));
  }
  if (value >= 10) {
    return Number(value.toFixed(2));
  }
  return Number(value.toFixed(3));
}

async function fetchCandles(fetchImpl: typeof fetch, marketSymbol: string, interval: SupportedInterval) {
  const response = await fetchImpl(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(marketSymbol)}?interval=${interval}&range=1d`,
    {
      headers: {
        "User-Agent": "InvestorCenter/1.0"
      }
    }
  );

  if (!response.ok) {
    return [];
  }

  const body = (await response.json()) as IntradayChartResponse;
  const result = body.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0];
  const opens = quote?.open ?? [];
  const highs = quote?.high ?? [];
  const lows = quote?.low ?? [];
  const closes = quote?.close ?? [];

  return timestamps
    .map((timestamp, index) => {
      const open = opens[index];
      const high = highs[index];
      const low = lows[index];
      const close = closes[index];
      if (
        typeof open !== "number" ||
        typeof high !== "number" ||
        typeof low !== "number" ||
        typeof close !== "number"
      ) {
        return null;
      }
      return {
        timestamp: new Date(timestamp * 1000).toISOString(),
        open,
        high,
        low,
        close
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

function calculateAtr(
  candles: Array<{ high: number; low: number; close: number }>,
  period: number
) {
  if (candles.length < 2) {
    return 0;
  }
  const trueRanges = candles.slice(1).map((candle, index) => {
    const previousClose = candles[index].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose)
    );
  });
  const lookback = Math.max(1, Math.min(period, trueRanges.length));
  const recent = trueRanges.slice(-lookback);
  return recent.reduce((sum, value) => sum + value, 0) / recent.length;
}

function findSwings(
  candles: Array<{ high: number; low: number }>,
  price: number
) {
  const highs: number[] = [];
  const lows: number[] = [];

  for (let index = 1; index < candles.length - 1; index += 1) {
    const previous = candles[index - 1];
    const current = candles[index];
    const next = candles[index + 1];

    if (current.high > previous.high && current.high > next.high) {
      highs.push(current.high);
    }
    if (current.low < previous.low && current.low < next.low) {
      lows.push(current.low);
    }
  }

  return {
    aboveHighs: highs.filter((value) => value > price).sort((a, b) => a - b),
    belowLows: lows.filter((value) => value < price).sort((a, b) => b - a)
  };
}

function pickStructureTargets(
  direction: "LONG" | "SHORT",
  entry: number,
  atrTp1: number,
  atrTp2: number,
  swings: ReturnType<typeof findSwings>
) {
  if (direction === "SHORT") {
    const farSupports = swings.belowLows.filter((value) => value < entry);
    return {
      tp1: roundPrice(farSupports[0] ?? atrTp1),
      tp2: roundPrice(farSupports[1] ?? atrTp2)
    };
  }

  const farResistances = swings.aboveHighs.filter((value) => value > entry);
  return {
    tp1: roundPrice(farResistances[0] ?? atrTp1),
    tp2: roundPrice(farResistances[1] ?? atrTp2)
  };
}

function buildScenarioText(
  instrument: SupportedInstrument,
  preferredAction: "LONG" | "SHORT" | "WAIT",
  triggerLabel: string
) {
  if (preferredAction === "LONG") {
    return {
      setupType: "Kontynuacja trendu po obronie lub wybiciu",
      scenarioA: `Jesli ${triggerLabel} utrzyma sie nad triggerem i kupujacy nie oddaja ruchu, przewaga zostaje po stronie long.`,
      scenarioB: `Jesli po wybiciu rynek szybko wraca pod trigger, momentum slabnie i lepiej nie gonic ruchu.`,
      executionNote:
        instrument === "WTI" || instrument === "BRENT"
          ? "Na surowcach graj mniejszym rozmiarem i pilnuj szybkiej reakcji na newsy."
          : "Przy trendzie wejscie tylko po potwierdzeniu, a nie na samej ekscytacji po zielonej swiecy."
    };
  }

  if (preferredAction === "SHORT") {
    return {
      setupType: "Presja spadkowa po utracie wsparcia",
      scenarioA: `Jesli ${triggerLabel} nie odzyska triggera i kolejne swiece potwierdza slabosc, przewaga przechodzi na scenariusz spadkowy.`,
      scenarioB: `Jesli rynek szybko wraca nad trigger po wybiciu dolu, to moze byc tylko polowanie na stopy i short traci przewage.`,
      executionNote:
        instrument === "WTI" || instrument === "BRENT"
          ? "Short na ropie wymaga dyscypliny, bo jeden news potrafi ostro zawrocic ruch."
          : "Short ma sens dopiero po realnym potwierdzeniu slabosci, nie przy pierwszym czerwonym impulsie."
    };
  }

  return {
    setupType: "Cofniecie lub neutralna faza rynku",
    scenarioA: `Jesli ${triggerLabel} obroni strefe obserwacji i pojawi sie lepsza reakcja ceny, temat moze wrocic do gry po lepszej cenie.`,
    scenarioB: "Jesli rynek pozostaje w srodku zakresu bez potwierdzenia, przewaga jest za mala na sensowny trade.",
    executionNote: "Najrozsadniej czekac na wyrazny trigger albo obrone strefy, zamiast zgadywac srodek ruchu."
  };
}

export async function getTradeSetup(
  instrument: SupportedInstrument = "WTI",
  interval: SupportedInterval = "15m",
  fetchImpl: typeof fetch = fetch
) {
  await refreshMarketData(fetchImpl);

  const config = INSTRUMENT_CONFIG[instrument];
  const minAcceptedRR = 1.5;
  const snapshot = getMarketSnapshots().find((item) => item.symbol === config.snapshotSymbol);
  if (!snapshot) {
    throw new Error(`Brak danych dla ${instrument}. Najpierw odswiez market data.`);
  }

  const absoluteDayMove = Math.abs(snapshot.priceChange1dPct);
  const baseVolatility =
    config.style === "commodity"
      ? Math.max(1.2, Math.min(3.2, absoluteDayMove * 0.9 + 0.9))
      : Math.max(0.9, Math.min(2.4, absoluteDayMove * 0.75 + 0.65));

  const intervalFactor = interval === "15m" ? 1 : interval === "30m" ? 1.18 : 1.38;
  const volatilityPct = baseVolatility * intervalFactor;
  const triggerPct = volatilityPct * 0.45;
  const slPct = volatilityPct * (config.style === "commodity" ? 1.1 : 0.95);
  const tp1Pct = slPct * 1.35;
  const tp2Pct = slPct * 2.1;
  const candles = await fetchCandles(fetchImpl, config.marketSymbol, interval);
  const atr = calculateAtr(candles, interval === "1h" ? 6 : 10);

  let preferredAction: "LONG" | "SHORT" | "WAIT" = "WAIT";
  if (snapshot.priceChange1dPct > 1.1 && snapshot.momentum3mPct > 6) {
    preferredAction = "LONG";
  } else if (snapshot.priceChange1dPct < -1.1 && snapshot.momentum3mPct < -2) {
    preferredAction = "SHORT";
  } else if (snapshot.momentum3mPct > 4) {
    preferredAction = "WAIT";
  }

  const scenario = buildScenarioText(instrument, preferredAction, config.label);
  const price = snapshot.lastPrice;
  const planningDirection: "LONG" | "SHORT" =
    preferredAction === "WAIT"
      ? snapshot.momentum3mPct >= 0 ? "LONG" : "SHORT"
      : preferredAction;
  const direction = planningDirection === "SHORT" ? -1 : 1;
  const triggerMove = Math.max(price * (triggerPct / 100), atr * 0.4 || 0);
  const slMove = Math.max(price * (slPct / 100), atr || 0);
  const tp1Move = Math.max(price * (tp1Pct / 100), atr * 1.5 || 0);
  const tp2Move = Math.max(price * (tp2Pct / 100), atr * 3 || 0);

  const breakoutTrigger = roundPrice(price + triggerMove);
  const breakdownTrigger = roundPrice(price - triggerMove);
  const invalidation =
    planningDirection === "SHORT" ? roundPrice(price + slMove) : roundPrice(price - slMove);
  const tp1 = roundPrice(price + direction * tp1Move);
  const tp2 = roundPrice(price + direction * tp2Move);
  const watchZoneLow = roundPrice(price - price * (volatilityPct / 100));
  const watchZoneHigh = roundPrice(price + price * (volatilityPct / 100));
  const riskReward = Number((tp1Move / slMove).toFixed(2));
  const swings = findSwings(candles, price);

  const atrEntry = planningDirection === "SHORT" ? breakdownTrigger : breakoutTrigger;
  const atrSl = planningDirection === "SHORT" ? roundPrice(atrEntry + atr) : roundPrice(atrEntry - atr);
  const atrTp1 = planningDirection === "SHORT" ? roundPrice(atrEntry - atr * 1.5) : roundPrice(atrEntry + atr * 1.5);
  const atrTp2 = planningDirection === "SHORT" ? roundPrice(atrEntry - atr * 3) : roundPrice(atrEntry + atr * 3);
  const atrRisk = Math.abs(atrEntry - atrSl);
  const atrReward = Math.abs(atrTp1 - atrEntry);

  const structureSl =
    planningDirection === "SHORT"
      ? roundPrice(swings.aboveHighs[0] ?? atrSl)
      : roundPrice(swings.belowLows[0] ?? atrSl);
  const structureTargets = pickStructureTargets(planningDirection, atrEntry, atrTp1, atrTp2, swings);
  const structureTp1 = structureTargets.tp1;
  const structureTp2 = structureTargets.tp2;
  const structureRisk = Math.abs(atrEntry - structureSl) || atrRisk;
  const structureReward = Math.abs(structureTp1 - atrEntry) || atrReward;
  const structureBasis =
    planningDirection === "SHORT"
      ? `SL nad ostatnim swing high, TP na kolejnych lokalnych wsparciach (${swings.belowLows.length} poziomy).`
      : `SL pod ostatnim swing low, TP na kolejnych lokalnych oporach (${swings.aboveHighs.length} poziomy).`;
  const atrPlanRR = Number((atrReward / (atrRisk || 1)).toFixed(2));
  const structurePlanRR = Number((structureReward / (structureRisk || 1)).toFixed(2));

  let signal: "LONG" | "SHORT" | "WAIT" = preferredAction;
  let tradeInvalid = false;
  let invalidReason: string | null = null;
  const bestPlanRR = Math.max(atrPlanRR, structurePlanRR);

  if (preferredAction !== "WAIT" && bestPlanRR < minAcceptedRR) {
    signal = "WAIT";
    tradeInvalid = true;
    invalidReason = `Trade invalid: relacja zysk/ryzyko ${bestPlanRR.toFixed(2)}R jest ponizej progu ${minAcceptedRR.toFixed(1)}R.`;
  }

  let setupQuality: "Wysoka" | "Srednia" | "Niska" = "Niska";
  if (!tradeInvalid && preferredAction !== "WAIT" && Math.abs(snapshot.priceChange1dPct) > 1.5 && atr > 0) {
    setupQuality = (swings.aboveHighs.length > 0 || swings.belowLows.length > 0) ? "Wysoka" : "Srednia";
  } else if (!tradeInvalid && preferredAction !== "WAIT") {
    setupQuality = "Srednia";
  }

  return {
    instrument,
    instrumentLabel: config.label,
    interval,
    title: config.title,
    signal,
    setupQuality,
    tradeInvalid,
    invalidReason,
    minAcceptedRR,
    price,
    quoteCurrency: snapshot.quoteCurrency,
    fxRateToPln: snapshot.fxRateToPln,
    dayChangePct: snapshot.priceChange1dPct,
    momentum3mPct: snapshot.momentum3mPct,
    preferredAction,
    contractSize: config.contractSize,
    sizingMode: config.sizingMode,
    sizingLabel: config.sizingLabel,
    isLeveraged: config.isLeveraged,
    leverage: config.leverage,
    requiredMarginPct: config.requiredMarginPct,
    minPositionSize: config.minPositionSize,
    maxPositionSize: config.maxPositionSize,
    swapLongPerLotPerDay: config.swapLongPerLotPerDay,
    swapShortPerLotPerDay: config.swapShortPerLotPerDay,
    atr: roundPrice(atr),
    setupType: scenario.setupType,
    watchZoneLow,
    watchZoneHigh,
    breakoutTrigger,
    breakdownTrigger,
    invalidation,
    tp1,
    tp2,
    riskReward,
    scenarioA: scenario.scenarioA,
    scenarioB: scenario.scenarioB,
    riskNote: config.riskHint,
    executionNote: scenario.executionNote,
    source: snapshot.source,
    updatedAt: snapshot.updatedAt,
    marketDataMode: getMarketDataStatus().mode,
    atrPlan: {
      direction: planningDirection,
      entry: atrEntry,
      sl: atrSl,
      tp1: atrTp1,
      tp2: atrTp2,
      riskReward: atrPlanRR,
      comment: "Plan oparty o ATR: SL = 1x ATR, TP1 = 1.5x ATR, TP2 = 3x ATR."
    },
    structurePlan: {
      direction: planningDirection,
      entry: atrEntry,
      sl: structureSl,
      tp1: structureTp1,
      tp2: structureTp2,
      riskReward: structurePlanRR,
      basis: structureBasis,
      comment: "Plan oparty o ostatnie swingi i lokalne poziomy rynku."
    },
    candles
  };
}

export function isSupportedInstrument(value: string): value is SupportedInstrument {
  return value in INSTRUMENT_CONFIG;
}

export function isSupportedInterval(value: string): value is SupportedInterval {
  return value === "15m" || value === "30m" || value === "1h";
}
