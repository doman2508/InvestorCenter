import {
  getAccounts,
  getAlertRules,
  getHoldings,
  getMarketDataStatus,
  getMarketSnapshots,
  getNews,
  getTransactions,
  getWatchlist
} from "../repository.js";
import type { AlertEvent, DailyBrief, DashboardResponse, PortfolioSnapshot, WatchlistItem } from "../types.js";

const FX_REFERENCE: Record<string, number> = {
  PLN: 1,
  USD: 3.7,
  EUR: 4.3,
  GBP: 5
};

function derivePortfolioSnapshot(): PortfolioSnapshot {
  const accounts = getAccounts();
  const holdings = getHoldings();
  const snapshots = new Map(getMarketSnapshots().map((item) => [item.symbol, item]));

  const pricedHoldings = holdings.map((holding) => {
    const snapshot = snapshots.get(holding.symbol);
    const currentPrice = snapshot?.lastPrice ?? holding.currentPrice;
    const quoteCurrency = snapshot?.quoteCurrency ?? holding.currency;
    const fxRateToPln = snapshot?.fxRateToPln ?? holding.impliedFxRateToPln ?? FX_REFERENCE[quoteCurrency] ?? 1;
    const marketValue = holding.quantity * currentPrice * fxRateToPln;
    const costBasisPln = holding.costBasisPln ?? holding.quantity * holding.averageCost * fxRateToPln;
    const unrealizedPnL = marketValue - costBasisPln;
    const dayChangePct = snapshot?.priceChange1dPct ?? 0;

    return {
      ...holding,
      currentPrice,
      currency: quoteCurrency,
      costBasisPln,
      impliedFxRateToPln: holding.impliedFxRateToPln ?? fxRateToPln,
      marketValue,
      dayChangePct,
      unrealizedPnL
    };
  });

  const totalValue = pricedHoldings.reduce((sum, holding) => sum + holding.marketValue, 0);

  const allocationMap = new Map<string, { value: number; targetPct: number }>();
  pricedHoldings.forEach((holding) => {
    const existing = allocationMap.get(holding.assetClass) ?? { value: 0, targetPct: 0 };
    existing.value += holding.marketValue;
    existing.targetPct += holding.targetAllocationPct;
    allocationMap.set(holding.assetClass, existing);
  });

  const accountsWithHoldings = accounts.map((account) => {
    const accountHoldings = pricedHoldings.filter((holding) => holding.accountId === account.id);
    return {
      ...account,
      currentValue: accountHoldings.reduce((sum, holding) => sum + holding.marketValue, 0),
      holdings: accountHoldings
    };
  });

  const dailyReturnValue = accountsWithHoldings.reduce(
    (sum, account) =>
      sum + account.holdings.reduce((acc, holding) => acc + holding.marketValue * (holding.dayChangePct / 100), 0),
    0
  );

  return {
    totalValue,
    dayChangePct: totalValue === 0 ? 0 : (dailyReturnValue / totalValue) * 100,
    allocationByClass: Array.from(allocationMap.entries()).map(([assetClass, item]) => {
      const pct = totalValue === 0 ? 0 : (item.value / totalValue) * 100;
      return {
        assetClass: assetClass as PortfolioSnapshot["allocationByClass"][number]["assetClass"],
        value: item.value,
        pct,
        targetPct: item.targetPct,
        driftPct: pct - item.targetPct
      };
    }),
    accounts: accountsWithHoldings
  };
}

function buildAlertEvents(portfolio: PortfolioSnapshot, watchlist: WatchlistItem[]): AlertEvent[] {
  const rules = getAlertRules();
  const events: AlertEvent[] = [];

  const allocationRule = rules.find((rule) => rule.category === "allocation");
  if (allocationRule) {
    portfolio.allocationByClass.forEach((item) => {
      if (Math.abs(item.driftPct) >= allocationRule.threshold) {
        events.push({
          id: `allocation-${item.assetClass}`,
          priority: Math.abs(item.driftPct) > allocationRule.threshold + 3 ? "high" : "medium",
          category: "allocation",
          title: `${item.assetClass} odbiega od planu`,
          changed: `${item.assetClass} ma udzial ${item.pct.toFixed(1)}% przy celu ${item.targetPct.toFixed(1)}%.`,
          whyItMatters: "Odchylenie alokacji zwieksza ryzyko dryfu strategii.",
          considerAction: "Sprawdz, czy kolejna wplata lub rebalancing powinny to skorygowac."
        });
      }
    });
  }

  const bondRule = rules.find((rule) => rule.category === "bond_maturity");
  if (bondRule) {
    portfolio.accounts
      .flatMap((account) => account.holdings.map((holding) => ({ account, holding })))
      .forEach(({ account, holding }) => {
        if (!holding.maturityDate) {
          return;
        }
        const daysToMaturity = Math.ceil(
          (new Date(holding.maturityDate).getTime() - new Date("2026-03-29T00:00:00Z").getTime()) / 86400000
        );
        if (daysToMaturity > 0 && daysToMaturity <= bondRule.threshold) {
          events.push({
            id: `bond-${holding.id}`,
            priority: daysToMaturity < 120 ? "high" : "medium",
            category: "bond_maturity",
            title: `${holding.name} zbliza sie do terminu`,
            changed: `Do wykupu ${holding.symbol} zostalo ${daysToMaturity} dni.`,
            whyItMatters: "Warto wczesniej ustalic plan dla srodkow po wykupie.",
            considerAction: "Zdecyduj, czy rolowac, przenosic czy wykorzystac do rebalancingu.",
            symbol: holding.symbol,
            accountName: account.name
          });
        }
      });
  }

  const lastContribution = getTransactions().find((tx) => tx.type === "CONTRIBUTION");
  const contributionRule = rules.find((rule) => rule.category === "contribution");
  if (lastContribution && contributionRule) {
    const daysSinceContribution = Math.ceil(
      (new Date("2026-03-29T00:00:00Z").getTime() - new Date(lastContribution.tradeDate).getTime()) / 86400000
    );
    if (daysSinceContribution >= contributionRule.threshold) {
      events.push({
        id: "contribution-reminder",
        priority: "medium",
        category: "contribution",
        title: "Czas sprawdzic kolejna wplate",
        changed: `Od ostatniej zarejestrowanej wplaty minelo ${daysSinceContribution} dni.`,
        whyItMatters: "Regularnosc wplat zwykle robi wieksza roznice niz idealny timing.",
        considerAction: "Sprawdz limity IKE i IKZE oraz najblizszy plan doplaty."
      });
    }
  }

  const priceRule = rules.find((rule) => rule.category === "price_move");
  if (priceRule) {
    watchlist.forEach((item) => {
      if (Math.abs(item.priceChange1dPct) >= priceRule.threshold) {
        events.push({
          id: `watchlist-price-${item.id}`,
          priority: Math.abs(item.priceChange1dPct) > priceRule.threshold + 2 ? "high" : "medium",
          category: "price_move",
          title: `${item.symbol} wykonalo istotny ruch`,
          changed: `${item.symbol} zmienilo sie dzis o ${item.priceChange1dPct.toFixed(1)}%.`,
          whyItMatters: "Wiekszy ruch ceny moze oznaczac zmiane sentymentu albo reakcje na news.",
          considerAction: "Sprawdz, czy ruch potwierdza teze i czy wymaga aktualizacji watchlisty.",
          symbol: item.symbol,
          stale: item.dataFreshness === "stale"
        });
      }
    });
  }

  const trendRule = rules.find((rule) => rule.category === "trend");
  if (trendRule) {
    watchlist.forEach((item) => {
      if (item.momentum3mPct >= trendRule.threshold) {
        events.push({
          id: `trend-${item.id}`,
          priority: item.dataFreshness === "stale" ? "low" : "medium",
          category: "trend",
          title: `${item.symbol} utrzymuje momentum`,
          changed: `Momentum 3M wynosi ${item.momentum3mPct.toFixed(1)}%.`,
          whyItMatters: "To pomaga odroznic chwilowy szum od ruchu, ktory zaczyna sie utrwalac.",
          considerAction: "Zweryfikuj, czy aktywo powinno wejsc wyzej na liste obserwacyjna.",
          symbol: item.symbol,
          stale: item.dataFreshness === "stale"
        });
      }
    });
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  return events.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}

function buildOpportunityRadar(): DailyBrief["opportunityRadar"] {
  type OpportunityRadarItem = DailyBrief["opportunityRadar"][number];
  const snapshots = new Map(getMarketSnapshots().map((item) => [item.symbol, item]));
  const definitions = [
    { id: "oil-brent", symbol: "Brent", snapshotKey: "OPP-OIL-BRENT", title: "Ropa Brent", assetClass: "COMMODITY" as const },
    { id: "oil-wti", symbol: "WTI", snapshotKey: "OPP-OIL-WTI", title: "Ropa WTI", assetClass: "COMMODITY" as const },
    { id: "energy-etf", symbol: "XLE", snapshotKey: "OPP-ENERGY", title: "ETF energy", assetClass: "ETF" as const },
    { id: "world-etf", symbol: "ACWI", snapshotKey: "OPP-WORLD", title: "Szeroki rynek globalny", assetClass: "ETF" as const },
    { id: "gold", symbol: "GLD", snapshotKey: "OPP-GOLD", title: "Zloto", assetClass: "COMMODITY" as const },
    { id: "tech", symbol: "QQQ", snapshotKey: "OPP-TECH", title: "Technologia / Nasdaq", assetClass: "ETF" as const },
    { id: "defense", symbol: "ITA", snapshotKey: "OPP-DEFENSE", title: "Defense / aerospace", assetClass: "ETF" as const },
    { id: "semis", symbol: "SOXX", snapshotKey: "OPP-SEMIS", title: "Polprzewodniki", assetClass: "ETF" as const },
    { id: "quality", symbol: "QUAL", snapshotKey: "OPP-QUALITY", title: "Akcje quality", assetClass: "ETF" as const },
    { id: "emerging", symbol: "EEM", snapshotKey: "OPP-EM", title: "Emerging markets", assetClass: "ETF" as const }
  ];

  return definitions
    .map<OpportunityRadarItem | null>((definition) => {
      const snapshot = snapshots.get(definition.snapshotKey);
      if (!snapshot) {
        return null;
      }

      let setup = "Obserwuj";
      let risk = "Brak przewagi bez dodatkowego potwierdzenia.";
      let actionBias: "watch" | "buy-on-pullback" | "momentum" | "trim-risk" = "watch";
      let decisionNote = "Najpierw obserwuj i czekaj na lepszy układ.";

      if (snapshot.priceChange1dPct > 2 && snapshot.momentum3mPct > 8) {
        setup = "Silny trend";
        risk = "Ruch jest juz rozpedzony, wiec latwo wejsc za wysoko.";
        actionBias = definition.assetClass === "COMMODITY" ? "trim-risk" : "momentum";
        decisionNote =
          definition.assetClass === "COMMODITY"
            ? "Nie gon pionowego ruchu. Szukaj cofniecia albo potwierdzenia po uspokojeniu zmiennosci."
            : "Momentum jest po stronie kupujacych, ale wejscie tylko z planem ryzyka i poziomem invalidation.";
      } else if (snapshot.priceChange1dPct < -1.5 && snapshot.momentum3mPct > 0) {
        setup = "Cofniecie w trendzie";
        risk = "Najpierw sprawdz, czy to tylko cofniecie, a nie zmiana sentymentu.";
        actionBias = "buy-on-pullback";
        decisionNote = "To kandydat do kupna po cofnieciu, jesli kolejna sesja potwierdzi obrone trendu.";
      } else if (snapshot.momentum3mPct < -5) {
        setup = "Slabosc / reset";
        risk = "Mozliwy dalszy zjazd, jesli rynek nie zbuduje bazy.";
        actionBias = "watch";
        decisionNote = "Nie spiesz sie z zakupem. Najpierw poczekaj na stabilizacje lub sygnal odwrocenia.";
      }

      return {
        id: definition.id,
        symbol: definition.symbol,
        title: definition.title,
        assetClass: definition.assetClass,
        priceNow: snapshot.lastPrice,
        quoteCurrency: snapshot.quoteCurrency,
        change1dPct: snapshot.priceChange1dPct,
        momentum3mPct: snapshot.momentum3mPct,
        setup,
        whyNow:
          definition.id === "oil-brent" || definition.id === "oil-wti"
            ? "Ropa szybko reaguje na geopolityke, podaz i inflacje."
            : definition.id === "energy-etf"
              ? "Energy jest prostszym sposobem zagrania tematu surowcowego bez wyboru pojedynczej spolki."
              : definition.id === "world-etf"
                ? "Szeroki rynek pomaga ocenic, czy jest moment na spokojne dokupienie trzonu portfela."
                : definition.id === "tech"
                  ? "Technologia zwykle dobrze pokazuje, czy rynek znow chce brac wzrost i ryzyko."
                  : definition.id === "defense"
                    ? "Defense bywa beneficjentem napięc geopolitycznych i wzrostu wydatkow panstw."
                    : definition.id === "semis"
                      ? "Polprzewodniki czesto prowadza trend wzrostowy, ale potrafia tez mocno karac po slabosci."
                      : definition.id === "quality"
                        ? "Quality bywa dobrym kompromisem miedzy wzrostem a odpornoscia przy niepewnym rynku."
                        : definition.id === "emerging"
                          ? "Emerging markets moga korzystac z odbicia apetytu na ryzyko i slabszego dolara."
                    : "Zloto pomaga sprawdzic, czy kapital szuka bezpiecznej przystani.",
        risk,
        decisionNote,
        actionBias
        ,
        source: snapshot.source,
        updatedAt: snapshot.updatedAt
      };
    })
    .filter((item): item is OpportunityRadarItem => item !== null);
}

function buildDailyBrief(portfolio: PortfolioSnapshot, watchlist: WatchlistItem[]): DailyBrief {
  const newsDigest = getNews();
  const activeAlerts = buildAlertEvents(portfolio, watchlist);
  const opportunityRadar = buildOpportunityRadar();
  const staleCount = watchlist.filter((item) => item.dataFreshness === "stale").length;
  const marketStatus = getMarketDataStatus();

  return {
    generatedAt: "2026-03-29T08:30:00Z",
    summary:
      activeAlerts.length > 0
        ? `Masz ${activeAlerts.length} sygnalow do przejrzenia: najpierw pozycje z najsilniejszym ruchem i ryzyka terminowe.`
        : "Brak pilnych sygnalow. Mozesz przejsc do researchu i radaru okazji.",
    activeAlerts,
    opportunityRadar,
    marketContext: [
      {
        headline: "Ropa pozostaje jednym z glownych sygnalow makro",
        detail: "Ruch na ropie szybko przenosi sie na inflacje, sentyment do energy i ogolne oczekiwania rynkowe."
      },
      {
        headline: "Decyzje oceniaj wzgledem calego portfela",
        detail: `Laczna wartosc portfela to ${portfolio.totalValue.toFixed(0)} PLN, wiec kazdy nowy pomysl porownuj z obecna alokacja, ryzykiem i waluta.`
      },
      {
        headline: staleCount > 0 ? "Czesc danych watchlisty jest niepelna" : "Dane watchlisty sa swieze",
        detail:
          staleCount > 0
            ? `${staleCount} pozycje maja oznaczenie stale i nie powinny generowac twardych wnioskow bez weryfikacji.`
            : "Dzisiejsze ruchy nadaja sie do dalszej analizy i filtrowania okazji."
      }
    ],
    newsDigest,
    marketDataStatus: {
      lastUpdatedAt: marketStatus.lastUpdatedAt,
      mode: marketStatus.mode
    }
  };
}

export function getDashboard(): DashboardResponse {
  const portfolio = derivePortfolioSnapshot();
  const snapshots = new Map(getMarketSnapshots().map((item) => [item.symbol, item]));
  const watchlist = getWatchlist().map((item) => {
    const snapshot = snapshots.get(item.symbol);
    return snapshot
      ? {
          ...item,
          lastPrice: snapshot.lastPrice,
          priceChange1dPct: snapshot.priceChange1dPct,
          momentum3mPct: snapshot.momentum3mPct,
          dataFreshness: getMarketDataStatus().mode === "live" ? "fresh" : item.dataFreshness
        }
      : item;
  });

  const dailyBrief = buildDailyBrief(portfolio, watchlist);
  return { dailyBrief, portfolio, watchlist };
}
