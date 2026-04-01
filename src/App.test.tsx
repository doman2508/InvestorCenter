import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const dashboardFixture = {
  dailyBrief: {
    generatedAt: "2026-03-28T08:30:00Z",
    summary: "Masz 3 sygnaly do przejrzenia.",
    activeAlerts: [
      {
        id: "1",
        priority: "high",
        category: "allocation",
        title: "ETF odbiega od planu",
        changed: "ETF ma udzial 50%.",
        whyItMatters: "Dryf strategii.",
        considerAction: "Rozwaz rebalancing."
      }
    ],
    marketContext: [
      {
        headline: "Ropa pozostaje kluczowym sygnalem makro",
        detail: "Wyzsza ropa moze podbijac inflacje."
      }
    ],
    newsDigest: [
      {
        id: 1,
        symbol: "CL=F",
        headline: "Oil extends weekly gains",
        source: "Reuters",
        summary: "Higher transport risk is keeping crude bid.",
        impact: "negative",
        publishedAt: "2026-03-28T06:45:00Z"
      }
    ],
    marketDataStatus: {
      lastUpdatedAt: "2026-03-28T08:30:00Z",
      mode: "live"
    }
  },
  portfolio: {
    totalValue: 100000,
    dayChangePct: 1.2,
    allocationByClass: [
      {
        assetClass: "ETF",
        value: 50000,
        pct: 50,
        targetPct: 45,
        driftPct: 5
      }
    ],
    accounts: [
      {
        id: 1,
        name: "IKE dlugoterminowe",
        type: "IKE",
        baseCurrency: "PLN",
        targetAllocationPct: 45,
        currentValue: 50000,
        holdings: [
          {
            id: 1,
            symbol: "VWCE",
            name: "Vanguard FTSE All-World",
            assetClass: "ETF",
            quantity: 10,
            averageCost: 400,
            currentPrice: 450,
            currency: "EUR",
            targetAllocationPct: 30,
            maturityDate: null,
            marketValue: 4500,
            dayChangePct: 1.1,
            unrealizedPnL: 500
          }
        ]
      }
    ]
  },
  watchlist: [
    {
      id: 1,
      symbol: "CL=F",
      name: "WTI Crude Oil",
      assetClass: "COMMODITY",
      thesis: "Oil is the macro swing factor.",
      thesisTag: "Macro",
      lastPrice: 78.6,
      priceChange1dPct: 3.9,
      momentum3mPct: 11.4,
      dataFreshness: "fresh"
    }
  ]
};

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => dashboardFixture
      }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders hero and today summary after loading", async () => {
    render(<App />);
    await waitFor(() => {
      expect(
        screen.getByText("Daily cockpit for portfolio moves, market radar and fewer random decisions.")
      ).toBeTruthy();
    });
    expect(screen.getByText("Masz 3 sygnaly do przejrzenia.")).toBeTruthy();
    expect(screen.getByText("ETF odbiega od planu")).toBeTruthy();
    expect(screen.getByText("Quick scan")).toBeTruthy();
  });
});
