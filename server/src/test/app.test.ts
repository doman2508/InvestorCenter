import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { initDb, resetStore } from "../db.js";
import { seedDb } from "../seed.js";

describe("Investor Center API", () => {
  beforeEach(() => {
    process.env.INVESTOR_CENTER_DB_PATH = path.resolve(process.cwd(), "data", "investor-center.test.json");
    resetStore();
    initDb();
    seedDb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    const csvPath = path.resolve(process.cwd(), "data", "emakler-test.csv");
    if (fs.existsSync(csvPath)) {
      fs.rmSync(csvPath, { force: true });
    }
    delete process.env.INVESTOR_CENTER_DB_PATH;
  });

  it("returns dashboard with alerts and portfolio", async () => {
    const app = createApp();
    const response = await request(app).get("/api/dashboard");

    expect(response.status).toBe(200);
    expect(response.body.portfolio.accounts.length).toBeGreaterThan(0);
    expect(response.body.portfolio.totalValue).toBe(0);
  });

  it("imports csv transactions without duplicates", async () => {
    const app = createApp();
    const csv = [
      "accountName,symbol,tradeDate,type,quantity,price,fees,currency",
      "IKE,VWCE,2026-03-15,BUY,1,445.2,2.3,EUR"
    ].join("\n");

    const first = await request(app).post("/api/import/csv").set("Content-Type", "text/csv").send(csv);
    const second = await request(app).post("/api/import/csv").set("Content-Type", "text/csv").send(csv);

    expect(first.status).toBe(200);
    expect(first.body.imported).toBe(1);
    expect(second.body.skipped).toBe(1);
  });

  it("rejects invalid csv header", async () => {
    const app = createApp();
    const csv = "foo,bar\n1,2";
    const response = await request(app).post("/api/import/csv").set("Content-Type", "text/csv").send(csv);

    expect(response.status).toBe(400);
    expect(response.body.errors[0]).toContain("Niepoprawny");
  });

  it("adds a holding manually", async () => {
    const app = createApp();
    const response = await request(app).post("/api/holdings").send({
      accountId: 1,
      symbol: "EUNL",
      name: "iShares Core MSCI World",
      assetClass: "ETF",
      quantity: 5,
      averageCost: 412.5,
      currentPrice: 420.2,
      currency: "EUR",
      targetAllocationPct: 8,
      maturityDate: null
    });

    expect(response.status).toBe(201);
    expect(response.body.symbol).toBe("EUNL");
  });

  it("adds a watchlist item manually", async () => {
    const app = createApp();
    const response = await request(app).post("/api/watchlist").send({
      symbol: "SHEL",
      name: "Shell",
      assetClass: "STOCK",
      thesis: "Oil majors may benefit if crude stays elevated.",
      thesisTag: "Energy",
      lastPrice: 72.3,
      priceChange1dPct: 1.7,
      momentum3mPct: 9.2,
      dataFreshness: "fresh"
    });

    expect(response.status).toBe(201);
    expect(response.body.symbol).toBe("SHEL");
  });

  it("imports eMakler csv into selected account", async () => {
    const app = createApp();
    const csvPath = path.resolve(process.cwd(), "data", "emakler-test.csv");
    fs.writeFileSync(
      csvPath,
      [
        "mBank S.A. Bankowość Detaliczna",
        "",
        "Czas transakcji;Papier;Giełda;K/S;Liczba;Kurs;Waluta;Prowizja;Waluta;Wartość;Waluta",
        "10.03.2026 09:00:14;ISAC ETF LN;GBR-LSE;K;1;110,29;USD;0,00;PLN;403,47;PLN"
      ].join("\n"),
      "utf8"
    );

    const response = await request(app).post("/api/import/emakler-path").send({
      filePath: csvPath,
      accountName: "IKE"
    });

    expect(response.status).toBe(200);
    expect(response.body.imported).toBe(1);
    expect(response.body.notes.join(" ")).toContain("Rebuilt 1 current holdings for IKE.");
  });

  it("updates and deletes a holding", async () => {
    const app = createApp();
    const created = await request(app).post("/api/holdings").send({
      accountId: 1,
      symbol: "VWCE",
      name: "Vanguard FTSE All-World UCITS",
      assetClass: "ETF",
      quantity: 10,
      averageCost: 430,
      currentPrice: 450,
      currency: "EUR",
      targetAllocationPct: 32,
      maturityDate: null
    });
    const updated = await request(app).put(`/api/holdings/${created.body.id}`).send({
      accountId: 1,
      symbol: "VWCE",
      name: "Vanguard FTSE All-World UCITS",
      assetClass: "ETF",
      quantity: 40,
      averageCost: 430,
      currentPrice: 450,
      currency: "EUR",
      targetAllocationPct: 32,
      maturityDate: null
    });
    const removed = await request(app).delete(`/api/holdings/${created.body.id}`);

    expect(created.status).toBe(201);
    expect(updated.status).toBe(200);
    expect(updated.body.quantity).toBe(40);
    expect(removed.status).toBe(204);
  });

  it("refreshes market data with mocked live providers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("finance/chart")) {
          if (url.includes("FAIL")) {
            return {
              ok: false,
              status: 404
            } as Response;
          }

          return {
            ok: true,
            json: async () => ({
              chart: {
                result: [
                  {
                    timestamp: [1711600000, 1711686400],
                    meta: {
                      currency: "USD"
                    },
                    indicators: {
                      quote: [
                        {
                          close: [100, 105]
                        }
                      ]
                    }
                  }
                ]
              }
            })
          } as Response;
        }

        if (url.includes("api.nbp.pl")) {
          return {
            ok: true,
            json: async () => ({
              rates: [{ mid: 3.7 }]
            })
          } as Response;
        }

        return {
          ok: true,
          text: async () =>
            "<rss><channel><item><title>Markets steady</title><description>Macro digest.</description><pubDate>Sat, 29 Mar 2026 08:00:00 GMT</pubDate><source>Google News</source></item></channel></rss>"
        } as Response;
      })
    );

    const app = createApp();
    await request(app).post("/api/holdings").send({
      accountId: 3,
      symbol: "APPLE",
      name: "Apple",
      assetClass: "STOCK",
      quantity: 1,
      averageCost: 200,
      currentPrice: 200,
      currency: "USD",
      targetAllocationPct: 0,
      maturityDate: null
    });
    await request(app).post("/api/holdings").send({
      accountId: 3,
      symbol: "BROKEN",
      name: "Broken",
      assetClass: "ETF",
      quantity: 1,
      averageCost: 10,
      currentPrice: 10,
      currency: "USD",
      targetAllocationPct: 0,
      maturityDate: null
    });
    await request(app).post("/api/instrument-mappings").send({
      accountId: 3,
      sourceSymbol: "BROKEN",
      marketTicker: "FAIL.US",
      label: "Broken"
    });

    const response = await request(app).post("/api/market/refresh");

    expect(response.status).toBe(200);
    expect(response.body.mode).toBe("live");
    expect(response.body.snapshotsUpdated).toBeGreaterThan(0);
    expect(response.body.message).toContain("kept their previous snapshots");
  });
});
