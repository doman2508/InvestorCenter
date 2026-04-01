import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { DashboardResponse, InstrumentMapping } from "./types";

type ViewName = "today" | "portfolio" | "watchlist";
type AssetClass = "ETF" | "STOCK" | "BOND" | "COMMODITY" | "CASH";
type Freshness = "fresh" | "stale";

const currency = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "PLN",
  maximumFractionDigits: 0
});

const percent = new Intl.NumberFormat("pl-PL", {
  style: "percent",
  maximumFractionDigits: 1
});

const quote = new Intl.NumberFormat("pl-PL", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const initialHoldingForm = {
  accountId: "1",
  symbol: "",
  name: "",
  assetClass: "ETF" as AssetClass,
  quantity: "1",
  averageCost: "",
  currentPrice: "",
  currency: "PLN",
  targetAllocationPct: "5",
  maturityDate: ""
};

const initialWatchlistForm = {
  symbol: "",
  name: "",
  assetClass: "STOCK" as AssetClass,
  thesis: "",
  thesisTag: "Macro",
  lastPrice: "",
  priceChange1dPct: "0",
  momentum3mPct: "0",
  dataFreshness: "fresh" as Freshness
};

function fmtPct(value: number) {
  return percent.format(value / 100);
}

function fmtAmount(value: number) {
  return currency.format(value);
}

function fmtQuote(value: number) {
  return quote.format(value);
}

function fmtDate(value: string | null) {
  if (!value) {
    return "brak";
  }
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function daysUntil(value: string | null) {
  if (!value) {
    return null;
  }
  const target = new Date(`${value}T00:00:00`);
  const today = new Date();
  target.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function actionBiasLabel(value: DashboardResponse["dailyBrief"]["opportunityRadar"][number]["actionBias"]) {
  if (value === "buy-on-pullback") {
    return "Szukaj wejscia po cofnieciu";
  }
  if (value === "momentum") {
    return "Momentum, ale z planem";
  }
  if (value === "trim-risk") {
    return "Nie gon ruchu";
  }
  return "Najpierw obserwuj";
}

function actionBiasClass(value: DashboardResponse["dailyBrief"]["opportunityRadar"][number]["actionBias"]) {
  if (value === "buy-on-pullback") {
    return "bias-chip buy-on-pullback";
  }
  if (value === "momentum") {
    return "bias-chip momentum";
  }
  if (value === "trim-risk") {
    return "bias-chip trim-risk";
  }
  return "bias-chip watch";
}

function polarToCartesian(cx: number, cy: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians)
  };
}

function describeArc(cx: number, cy: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return [`M`, start.x, start.y, `A`, radius, radius, 0, largeArcFlag, 0, end.x, end.y].join(" ");
}

const chartPalette = ["#163449", "#216b72", "#c07a33", "#8f5d2a", "#5f8390", "#b54c31"];

function formatAccountMeta(name: string, type: string) {
  if (name === "XTB") {
    return "Broker XTB";
  }
  if (name === "Obligacje Skarbowe") {
    return "Rejestr obligacji";
  }
  if (type === "IKE") {
    return "Konto IKE";
  }
  if (type === "IKZE") {
    return "Konto IKZE";
  }
  return type;
}

function getPriorityLabel(count: number) {
  if (count >= 5) return "Busy";
  if (count >= 3) return "Watch closely";
  return "Calm";
}

function AllocationDonut({
  items,
  totalValue
}: {
  items: DashboardResponse["portfolio"]["allocationByClass"];
  totalValue: number;
}) {
  let currentAngle = 0;

  return (
    <div className="chart-panel">
      <div>
        <p className="kicker">Allocation</p>
        <h3>Struktura portfela</h3>
      </div>
      <div className="allocation-chart-wrap">
        <svg viewBox="0 0 220 220" className="donut-chart" aria-label="Portfolio allocation donut chart">
          <circle cx="110" cy="110" r="70" fill="none" stroke="rgba(23, 34, 45, 0.08)" strokeWidth="22" />
          {items.map((item, index) => {
            const sweep = (item.pct / 100) * 360;
            const startAngle = currentAngle;
            const endAngle = currentAngle + sweep;
            currentAngle = endAngle;
            return (
              <path
                key={item.assetClass}
                d={describeArc(110, 110, 70, startAngle, endAngle)}
                fill="none"
                stroke={chartPalette[index % chartPalette.length]}
                strokeWidth="22"
                strokeLinecap="round"
              />
            );
          })}
          <text x="110" y="102" textAnchor="middle" className="donut-center-label">Portfel</text>
          <text x="110" y="126" textAnchor="middle" className="donut-center-value">{fmtAmount(totalValue)}</text>
        </svg>

        <div className="chart-legend">
          {items.map((item, index) => (
            <div key={item.assetClass} className="legend-row">
              <span className="legend-dot" style={{ backgroundColor: chartPalette[index % chartPalette.length] }} />
              <span>{item.assetClass}</span>
              <strong>{fmtPct(item.pct)}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AccountsBarChart({
  accounts,
  totalValue
}: {
  accounts: DashboardResponse["portfolio"]["accounts"];
  totalValue: number;
}) {
  return (
    <div className="chart-panel">
      <div>
        <p className="kicker">Accounts</p>
        <h3>Udzial rachunkow</h3>
      </div>
      <div className="account-bars">
        {accounts.map((account, index) => {
          const share = totalValue === 0 ? 0 : (account.currentValue / totalValue) * 100;
          return (
            <div key={account.id} className="account-bar-row">
              <div className="account-bar-meta">
                <strong>{account.name}</strong>
                <span>{fmtAmount(account.currentValue)}</span>
              </div>
              <div className="account-bar-track">
                <div
                  className="account-bar-fill"
                  style={{
                    width: `${Math.max(share, 3)}%`,
                    background: `linear-gradient(90deg, ${chartPalette[index % chartPalette.length]}, rgba(192, 122, 51, 0.9))`
                  }}
                />
              </div>
              <div className="account-bar-foot">
                <span>{fmtPct(share)}</span>
                <span>{account.holdings.length} poz.</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BondMaturityTimeline({
  holdings
}: {
  holdings: DashboardResponse["portfolio"]["accounts"][number]["holdings"];
}) {
  const sorted = [...holdings]
    .filter((holding) => holding.maturityDate)
    .sort((a, b) => String(a.maturityDate).localeCompare(String(b.maturityDate)));

  if (!sorted.length) {
    return null;
  }

  return (
    <div className="chart-panel">
      <div>
        <p className="kicker">Maturity</p>
        <h3>Timeline wykupu</h3>
      </div>
      <div className="bond-timeline">
        {sorted.map((holding) => {
          const maturityDays = daysUntil(holding.maturityDate);
          return (
            <div key={holding.id} className="bond-timeline-row">
              <div className="bond-timeline-dot" />
              <div className="bond-timeline-content">
                <div className="account-bar-meta">
                  <strong>{holding.symbol}</strong>
                  <span>{fmtDate(holding.maturityDate)}</span>
                </div>
                <div className="account-bar-foot">
                  <span>{fmtAmount(holding.marketValue)}</span>
                  <span>{maturityDays == null ? "brak daty" : `${maturityDays} dni`}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BondAccountOverview({
  title,
  kicker,
  account
}: {
  title: string;
  kicker: string;
  account: DashboardResponse["portfolio"]["accounts"][number];
}) {
  const costBasis = account.holdings.reduce((sum, holding) => sum + (holding.marketValue - holding.unrealizedPnL), 0);
  const profit = account.holdings.reduce((sum, holding) => sum + holding.unrealizedPnL, 0);
  const returnPct = costBasis === 0 ? 0 : (profit / costBasis) * 100;
  const maturities = account.holdings
    .map((holding) => ({ holding, days: daysUntil(holding.maturityDate) }))
    .filter(
      (item): item is { holding: DashboardResponse["portfolio"]["accounts"][number]["holdings"][number]; days: number } =>
        item.days != null
    )
    .sort((a, b) => a.days - b.days);
  const nearestMaturity = maturities[0] ?? null;

  return (
    <section className="panel xtb-panel">
      <div className="panel-head">
        <div>
          <p className="kicker">{kicker}</p>
          <h2>{title}</h2>
        </div>
      </div>

      <div className="xtb-summary-grid">
        <div className="mini-stat xtb-summary-card">
          <span className="summary-label">Wartosc rachunku</span>
          <strong>{fmtAmount(account.currentValue)}</strong>
          <small>{account.holdings.length} emisje</small>
        </div>
        <div className="mini-stat xtb-summary-card">
          <span className="summary-label">Narosly wynik</span>
          <strong className={profit >= 0 ? "positive" : "negative"}>{fmtAmount(profit)}</strong>
          <small>{fmtPct(returnPct)} ponad wartosc nominalna</small>
        </div>
        <div className="mini-stat xtb-summary-card">
          <span className="summary-label">Najblizszy wykup</span>
          <strong>{nearestMaturity ? `${nearestMaturity.days} dni` : "brak"}</strong>
          <small>{nearestMaturity ? `${nearestMaturity.holding.symbol} · ${fmtDate(nearestMaturity.holding.maturityDate)}` : "Brak dat wykupu w imporcie"}</small>
        </div>
        <div className="mini-stat xtb-summary-card">
          <span className="summary-label">Nominal portfela</span>
          <strong>{fmtAmount(costBasis)}</strong>
          <small>{formatAccountMeta(account.name, account.type)} · {account.baseCurrency}</small>
        </div>
      </div>

      <div className="holdings-table xtb-table">
        <div className="holding-row holding-row-head bond-holding-row-head">
          <div>Emisja</div>
          <div>Qty</div>
          <div className="numeric-cell">Nominal / szt.</div>
          <div className="numeric-cell">Wartosc aktualna</div>
          <div className="numeric-cell">Narosly wynik</div>
          <div className="numeric-cell">Data wykupu</div>
          <div className="numeric-cell">Do wykupu</div>
        </div>
        {account.holdings.map((holding) => {
          const maturityDays = daysUntil(holding.maturityDate);
          const signedPnL = `${holding.unrealizedPnL >= 0 ? "+" : "-"}${fmtAmount(Math.abs(holding.unrealizedPnL))}`;
          return (
            <div key={holding.id} className="holding-row bond-holding-row">
              <div>
                <strong>{holding.symbol}</strong>
                <p>{holding.name}</p>
              </div>
              <div className="numeric-cell">
                <p>{holding.quantity}</p>
              </div>
              <div className="numeric-cell">
                <p>{fmtQuote(holding.averageCost)} {holding.currency}</p>
              </div>
              <div className="numeric-cell">
                <p>{fmtAmount(holding.marketValue)}</p>
              </div>
              <div className="numeric-cell">
                <p className={holding.unrealizedPnL >= 0 ? "pnl-chip positive" : "pnl-chip negative"}>{signedPnL}</p>
              </div>
              <div className="numeric-cell">
                <p>{fmtDate(holding.maturityDate)}</p>
              </div>
              <div className="numeric-cell">
                <p>{maturityDays == null ? "brak" : `${maturityDays} dni`}</p>
              </div>
            </div>
          );
        })}
      </div>

      <BondMaturityTimeline holdings={account.holdings} />
    </section>
  );
}

function AccountOverview({
  title,
  kicker,
  account,
  portfolioDayChangePct,
  showRefresh,
  onRefresh
}: {
  title: string;
  kicker: string;
  account: DashboardResponse["portfolio"]["accounts"][number];
  portfolioDayChangePct: number;
  showRefresh?: boolean;
  onRefresh?: () => void;
}) {
  const costBasis = account.holdings.reduce((sum, holding) => sum + (holding.marketValue - holding.unrealizedPnL), 0);
  const profit = account.holdings.reduce((sum, holding) => sum + holding.unrealizedPnL, 0);
  const dailyChangeValue = account.holdings.reduce(
    (sum, holding) => sum + holding.marketValue * (holding.dayChangePct / 100),
    0
  );
  const returnPct = costBasis === 0 ? 0 : (profit / costBasis) * 100;
  const hasLiveSignal = account.holdings.some((holding) => Math.abs(holding.dayChangePct) > 0.001);

  return (
    <section className="panel xtb-panel">
      <div className="panel-head">
        <div>
          <p className="kicker">{kicker}</p>
          <h2>{title}</h2>
        </div>
        {showRefresh && onRefresh ? <button className="secondary-button" onClick={onRefresh}>Refresh live data</button> : null}
      </div>
      <div className="xtb-summary-grid">
        <div className="mini-stat xtb-summary-card">
          <span className="summary-label">Wartosc konta</span>
          <strong>{fmtAmount(account.currentValue)}</strong>
          <small>{account.holdings.length} otwarte pozycje</small>
        </div>
        <div className="mini-stat xtb-summary-card">
          <span className="summary-label">Zysk / strata</span>
          <strong className={profit >= 0 ? "positive" : "negative"}>{fmtAmount(profit)}</strong>
          <small>{fmtPct(returnPct)} stopy zwrotu</small>
        </div>
        <div className="mini-stat xtb-summary-card">
          <span className="summary-label">Dzienna zmiana</span>
          <strong className={dailyChangeValue >= 0 ? "positive" : "negative"}>{fmtAmount(dailyChangeValue)}</strong>
          <small>{hasLiveSignal ? "Na bazie ostatnich notowan pozycji" : `${fmtPct(portfolioDayChangePct)} dla calego portfolio`}</small>
        </div>
        <div className="mini-stat xtb-summary-card">
          <span className="summary-label">Kapital wlozony</span>
          <strong>{fmtAmount(costBasis)}</strong>
          <small>{formatAccountMeta(account.name, account.type)} · {account.baseCurrency}</small>
        </div>
      </div>

      <div className="holdings-table xtb-table">
        <div className="holding-row holding-row-head">
          <div>Pozycja</div>
          <div>Qty</div>
          <div className="numeric-cell">Aktualny kurs</div>
          <div className="numeric-cell">Zmiana kursu</div>
          <div className="numeric-cell">Stopa zwrotu</div>
          <div className="numeric-cell">Zysk</div>
          <div className="numeric-cell">Wartosc</div>
        </div>
        {account.holdings.map((holding) => {
          const holdingCostBasis = holding.marketValue - holding.unrealizedPnL;
          const holdingReturnPct = holdingCostBasis === 0 ? 0 : (holding.unrealizedPnL / holdingCostBasis) * 100;
          const signedPnL = `${holding.unrealizedPnL >= 0 ? "+" : "-"}${fmtAmount(Math.abs(holding.unrealizedPnL))}`;
          return (
            <div key={holding.id} className="holding-row">
              <div>
                <strong>{holding.symbol}</strong>
                <p>{holding.name}</p>
              </div>
              <div className="numeric-cell">
                <p>{holding.quantity}</p>
              </div>
              <div className="numeric-cell">
                <p>{fmtQuote(holding.currentPrice)} {holding.currency}</p>
              </div>
              <div className="numeric-cell">
                <p className={holding.dayChangePct >= 0 ? "positive" : "negative"}>{fmtPct(holding.dayChangePct)}</p>
              </div>
              <div className="numeric-cell">
                <p className={holdingReturnPct >= 0 ? "positive" : "negative"}>{fmtPct(holdingReturnPct)}</p>
              </div>
              <div className="numeric-cell">
                <p className={holding.unrealizedPnL >= 0 ? "pnl-chip positive" : "pnl-chip negative"}>{signedPnL}</p>
              </div>
              <div className="numeric-cell">
                <p>{fmtAmount(holding.marketValue)}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function App() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [view, setView] = useState<ViewName>("today");
  const [error, setError] = useState<string | null>(null);
  const [csvText, setCsvText] = useState(
    "accountName,symbol,tradeDate,type,quantity,price,fees,currency\nIKE długoterminowe,VWCE,2026-03-15,BUY,1,445.2,2.3,EUR"
  );
  const [xtbPath, setXtbPath] = useState(
    "C:\\Users\\tomas\\Downloads\\51101461_2006-01-01_2026-03-28\\51101461\\PLN_51101461_2006-01-01_2026-03-28.xlsx"
  );
  const [emaklerIkePath, setEmaklerIkePath] = useState("C:\\Users\\tomas\\Downloads\\eMAKLER_historia_transakcji (2).Csv");
  const [emaklerIkzePath, setEmaklerIkzePath] = useState("C:\\Users\\tomas\\Downloads\\eMAKLER_historia_transakcji (3).Csv");
  const [treasuryBondsPath, setTreasuryBondsPath] = useState("C:\\Users\\tomas\\Downloads\\StanRachunkuRejestrowego_2026-03-29.xls");
  const [importMessage, setImportMessage] = useState("");
  const [holdingForm, setHoldingForm] = useState(initialHoldingForm);
  const [watchlistForm, setWatchlistForm] = useState(initialWatchlistForm);
  const [actionMessage, setActionMessage] = useState("");
  const [editingHoldingId, setEditingHoldingId] = useState<number | null>(null);
  const [editingWatchlistId, setEditingWatchlistId] = useState<number | null>(null);
  const [refreshMessage, setRefreshMessage] = useState("");
  const [mappings, setMappings] = useState<InstrumentMapping[]>([]);
  const [mappingInputs, setMappingInputs] = useState<Record<string, string>>({});

  async function loadDashboard() {
    try {
      setError(null);
      const response = await fetch("/api/dashboard");
      if (!response.ok) {
        throw new Error("Nie udalo sie pobrac dashboardu.");
      }
      setData((await response.json()) as DashboardResponse);
      const mappingsResponse = await fetch("/api/instrument-mappings");
      if (mappingsResponse.ok) {
        const rawMappings = await mappingsResponse.json();
        const mappingsJson = Array.isArray(rawMappings) ? (rawMappings as InstrumentMapping[]) : [];
        setMappings(mappingsJson);
        setMappingInputs(
          Object.fromEntries(mappingsJson.map((item) => [item.sourceSymbol, item.marketTicker]))
        );
      } else {
        setMappings([]);
        setMappingInputs({});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nieznany blad.");
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  const derived = useMemo(() => {
    if (!data) {
      return null;
    }

    const highPriority = data.dailyBrief.activeAlerts.filter((item) => item.priority === "high").length;
    const freshWatchlist = data.watchlist.filter((item) => item.dataFreshness === "fresh").length;
    const topMover = [...data.watchlist].sort(
      (a, b) => Math.abs(b.priceChange1dPct) - Math.abs(a.priceChange1dPct)
    )[0];
    const xtbAccount = data.portfolio.accounts.find((account) => account.name === "XTB") ?? null;
    const emaklerAccounts = data.portfolio.accounts.filter((account) => account.name === "IKE" || account.name === "IKZE");
    const treasuryBondsAccount = data.portfolio.accounts.find((account) => account.name === "Obligacje Skarbowe") ?? null;
    const allHoldings = data.portfolio.accounts.flatMap((account) => account.holdings);
    const portfolioCostBasis = allHoldings.reduce(
      (sum, holding) => sum + (holding.marketValue - holding.unrealizedPnL),
      0
    );
    const portfolioProfit = allHoldings.reduce((sum, holding) => sum + holding.unrealizedPnL, 0);
    const portfolioReturnPct = portfolioCostBasis === 0 ? 0 : (portfolioProfit / portfolioCostBasis) * 100;
    const portfolioDailyChangeValue = allHoldings.reduce(
      (sum, holding) => sum + holding.marketValue * (holding.dayChangePct / 100),
      0
    );
    const topHoldingsMoves = [...allHoldings]
      .sort((a, b) => Math.abs(b.dayChangePct) - Math.abs(a.dayChangePct))
      .slice(0, 5);
    const currencyExposure = Object.entries(
      allHoldings.reduce<Record<string, number>>((acc, holding) => {
        acc[holding.currency] = (acc[holding.currency] ?? 0) + holding.marketValue;
        return acc;
      }, {})
    )
      .map(([currencyCode, value]) => ({
        currencyCode,
        value,
        pct: data.portfolio.totalValue === 0 ? 0 : (value / data.portfolio.totalValue) * 100
      }))
      .sort((a, b) => b.value - a.value);
    const largestDrift = [...data.portfolio.allocationByClass].sort(
      (a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct)
    )[0];
    const nearestBondMaturity = allHoldings
      .filter((holding) => holding.maturityDate)
      .map((holding) => ({ holding, days: daysUntil(holding.maturityDate) }))
      .filter(
        (item): item is { holding: typeof allHoldings[number]; days: number } =>
          item.days != null
      )
      .sort((a, b) => a.days - b.days)[0] ?? null;
    const accountPerformance = data.portfolio.accounts.map((account) => {
      const accountCostBasis = account.holdings.reduce((sum, holding) => sum + (holding.marketValue - holding.unrealizedPnL), 0);
      const accountProfit = account.holdings.reduce((sum, holding) => sum + holding.unrealizedPnL, 0);
      return {
        id: account.id,
        name: account.name,
        currentValue: account.currentValue,
        profit: accountProfit,
        returnPct: accountCostBasis === 0 ? 0 : (accountProfit / accountCostBasis) * 100
      };
    });
    return {
      highPriority,
      freshWatchlist,
      topMover,
      xtbAccount,
      emaklerAccounts,
      treasuryBondsAccount,
      portfolioCostBasis,
      portfolioProfit,
      portfolioReturnPct,
      portfolioDailyChangeValue,
      totalOpenPositions: allHoldings.length,
      topHoldingsMoves,
      currencyExposure,
      largestDrift,
      nearestBondMaturity,
      accountPerformance
    };
  }, [data]);

  async function handleImport() {
    const response = await fetch("/api/import/csv", {
      method: "POST",
      headers: {
        "Content-Type": "text/csv"
      },
      body: csvText
    });
    const json = await response.json();
    if (!response.ok) {
      setImportMessage(json.errors?.join(" ") ?? "Import nie powiodl sie.");
      return;
    }
    setImportMessage(`Zaimportowano ${json.imported}, pominieto ${json.skipped}.`);
    await loadDashboard();
  }

  async function handleXtbImport() {
    const response = await fetch("/api/import/xtb-path", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        filePath: xtbPath,
        accountName: "XTB"
      })
    });
    const json = await response.json();
    if (!response.ok) {
      setImportMessage(json.errors?.join(" ") ?? json.message ?? "XTB import failed.");
      return;
    }
    setImportMessage(`XTB import: imported ${json.imported}, skipped ${json.skipped}. ${json.notes?.join(" ") ?? ""}`);
    await loadDashboard();
  }

  async function handleEmaklerImport(accountName: "IKE" | "IKZE") {
    const filePath = accountName === "IKE" ? emaklerIkePath : emaklerIkzePath;
    const response = await fetch("/api/import/emakler-path", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        filePath,
        accountName
      })
    });
    const json = await response.json();
    if (!response.ok) {
      setImportMessage(json.errors?.join(" ") ?? json.message ?? `eMakler import failed for ${accountName}.`);
      return;
    }
    const refreshResponse = await fetch("/api/market/refresh", { method: "POST" });
    const refreshJson = await refreshResponse.json();
    setImportMessage(
      `eMakler ${accountName}: ${json.imported} nowych, ${json.skipped} juz bylo w bazie. ${json.notes?.join(" ") ?? ""} ${
        refreshJson.message ?? ""
      }`
    );
    await loadDashboard();
  }

  async function handleSyncHoldings() {
    const response = await fetch("/api/holdings/sync", { method: "POST" });
    const json = await response.json();
    setImportMessage(`Przeliczono aktualne pozycje XTB: ${json.rebuiltXtb}.`);
    await loadDashboard();
  }

  async function handleTreasuryBondsImport() {
    const response = await fetch("/api/import/treasury-bonds-path", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        filePath: treasuryBondsPath
      })
    });
    const json = await response.json();
    if (!response.ok) {
      setImportMessage(json.errors?.join(" ") ?? json.message ?? "Treasury Bonds import failed.");
      return;
    }
    setImportMessage(`Obligacje Skarbowe: ${json.imported} pozycji, pominieto ${json.skipped}. ${json.notes?.join(" ") ?? ""}`);
    await loadDashboard();
  }

  async function saveMapping(sourceSymbol: string, label: string) {
    const marketTicker = mappingInputs[sourceSymbol]?.trim();
    if (!marketTicker) {
      setImportMessage(`Enter a market ticker for ${sourceSymbol}.`);
      return;
    }
    const response = await fetch("/api/instrument-mappings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        accountId: 3,
        sourceSymbol,
        marketTicker,
        label
      })
    });
    const json = await response.json();
    if (!response.ok) {
      setImportMessage(json.message ?? "Mapping save failed.");
      return;
    }
    setImportMessage(`Saved mapping ${sourceSymbol} -> ${json.marketTicker}.`);
    await loadDashboard();
  }

  async function handleRefreshMarketData() {
    const response = await fetch("/api/market/refresh", { method: "POST" });
    const json = await response.json();
    setRefreshMessage(json.message ?? "Refresh finished.");
    await loadDashboard();
  }

  async function handleAddHolding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionMessage("");
    const response = await fetch(editingHoldingId ? `/api/holdings/${editingHoldingId}` : "/api/holdings", {
      method: editingHoldingId ? "PUT" : "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        accountId: Number(holdingForm.accountId),
        symbol: holdingForm.symbol.trim().toUpperCase(),
        name: holdingForm.name.trim(),
        assetClass: holdingForm.assetClass,
        quantity: Number(holdingForm.quantity),
        averageCost: Number(holdingForm.averageCost),
        currentPrice: Number(holdingForm.currentPrice),
        currency: holdingForm.currency.trim().toUpperCase(),
        targetAllocationPct: Number(holdingForm.targetAllocationPct),
        maturityDate: holdingForm.maturityDate || null
      })
    });
    const json = await response.json();
    if (!response.ok) {
      setActionMessage(json.message ?? "Nie udalo sie dodac pozycji.");
      return;
    }
    setActionMessage(editingHoldingId ? `Updated holding ${json.symbol}.` : `Added holding ${json.symbol}.`);
    setHoldingForm((current) => ({
      ...initialHoldingForm,
      accountId: current.accountId,
      assetClass: current.assetClass
    }));
    setEditingHoldingId(null);
    await loadDashboard();
  }

  async function handleAddWatchlist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionMessage("");
    const response = await fetch(editingWatchlistId ? `/api/watchlist/${editingWatchlistId}` : "/api/watchlist", {
      method: editingWatchlistId ? "PUT" : "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        symbol: watchlistForm.symbol.trim().toUpperCase(),
        name: watchlistForm.name.trim(),
        assetClass: watchlistForm.assetClass,
        thesis: watchlistForm.thesis.trim(),
        thesisTag: watchlistForm.thesisTag.trim(),
        lastPrice: Number(watchlistForm.lastPrice),
        priceChange1dPct: Number(watchlistForm.priceChange1dPct),
        momentum3mPct: Number(watchlistForm.momentum3mPct),
        dataFreshness: watchlistForm.dataFreshness
      })
    });
    const json = await response.json();
    if (!response.ok) {
      setActionMessage(json.message ?? "Nie udalo sie dodac watchlist item.");
      return;
    }
    setActionMessage(editingWatchlistId ? `Updated watchlist item ${json.symbol}.` : `Added watchlist item ${json.symbol}.`);
    setWatchlistForm(initialWatchlistForm);
    setEditingWatchlistId(null);
    await loadDashboard();
  }

  async function handleDeleteHolding(id: number) {
    await fetch(`/api/holdings/${id}`, { method: "DELETE" });
    setActionMessage("Holding deleted.");
    await loadDashboard();
  }

  async function handleDeleteWatchlist(id: number) {
    await fetch(`/api/watchlist/${id}`, { method: "DELETE" });
    setActionMessage("Watchlist item deleted.");
    await loadDashboard();
  }

  if (error) {
    return (
      <main className="shell">
        <section className="panel">Blad: {error}</section>
      </main>
    );
  }

  if (!data || !derived) {
    return (
      <main className="shell">
        <section className="panel">Ladowanie...</section>
      </main>
    );
  }

  return (
    <main className="shell">
      {view === "today" ? (
        <section className="hero">
          <div className="hero-main">
            <p className="eyebrow">Investor Decision Center</p>
            <h1>Daily cockpit for portfolio moves, market radar and fewer random decisions.</h1>
            <p className="hero-copy">{data.dailyBrief.summary}</p>
            <div className="hero-ribbon">
              <span className="chip strong">{getPriorityLabel(data.dailyBrief.activeAlerts.length)}</span>
              <span className="chip">{derived.highPriority} high-priority alerts</span>
              <span className="chip">{derived.freshWatchlist} fresh radar items</span>
              <span className="chip">{data.dailyBrief.marketDataStatus.mode === "live" ? "Live data" : "Fallback data"}</span>
            </div>
          </div>

          <div className="hero-side">
            <div className="stat-card accent">
              <span>Total portfolio</span>
              <strong>{fmtAmount(data.portfolio.totalValue)}</strong>
              <small>Snapshot built from your current holdings and account mix.</small>
            </div>
            <div className="stat-row">
              <div className="stat-card">
                <span>Daily change</span>
                <strong className={data.portfolio.dayChangePct >= 0 ? "positive" : "negative"}>
                  {fmtPct(data.portfolio.dayChangePct)}
                </strong>
              </div>
              <div className="stat-card">
                <span>Top mover</span>
                <strong>{derived.topMover?.symbol ?? "-"}</strong>
                <small>{derived.topMover ? fmtPct(derived.topMover.priceChange1dPct) : "No data"}</small>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <nav className="tabs" aria-label="Main views">
        <button className={view === "today" ? "tab active" : "tab"} onClick={() => setView("today")}>Today</button>
        <button className={view === "portfolio" ? "tab active" : "tab"} onClick={() => setView("portfolio")}>Portfolio</button>
        <button className={view === "watchlist" ? "tab active" : "tab"} onClick={() => setView("watchlist")}>Watchlist</button>
      </nav>

      {view === "today" ? (
        <section className="stack">
          <section className="grid dashboard-grid">
            <div className="panel">
              <div className="panel-head">
                <div>
                  <p className="kicker">Today</p>
                  <h2>Twoj portfel dzis</h2>
                </div>
                <span className="badge">{data.dailyBrief.activeAlerts.length} alertow</span>
              </div>
              <p className="muted">{data.dailyBrief.summary}</p>
              <div className="today-account-grid">
                {derived.accountPerformance.map((account) => (
                  <article key={account.id} className="mini-stat">
                    <span>{account.name}</span>
                    <strong>{fmtAmount(account.currentValue)}</strong>
                    <small className={account.profit >= 0 ? "positive" : "negative"}>
                      {fmtAmount(account.profit)} · {fmtPct(account.returnPct)}
                    </small>
                  </article>
                ))}
              </div>
            </div>

            <div className="panel">
              <div className="panel-head">
                <div>
                  <p className="kicker">Radar</p>
                  <h2>Najwieksze ruchy</h2>
                </div>
              </div>
              <div className="stack">
                {derived.topHoldingsMoves.map((holding) => (
                  <article key={holding.id} className="context-item">
                    <div className="alert-header">
                      <strong>{holding.symbol}</strong>
                      <span className={holding.dayChangePct >= 0 ? "badge" : "badge subtle"}>{fmtPct(holding.dayChangePct)}</span>
                    </div>
                    <p>{holding.name}</p>
                    <p className="meta-line">
                      Wartosc {fmtAmount(holding.marketValue)} · wynik {fmtAmount(holding.unrealizedPnL)}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="grid dashboard-grid">
            <div className="panel">
              <div className="panel-head">
                <div>
                  <p className="kicker">Helper</p>
                  <h2>Radar okazji</h2>
                </div>
                <button className="secondary-button" onClick={handleRefreshMarketData}>Refresh live data</button>
              </div>
              {refreshMessage ? <p className="muted">{refreshMessage}</p> : null}
              <p className="muted">
                To nie sa gotowe sygnaly kupna, tylko shortlista tematow do sprawdzenia. Dane: {data.dailyBrief.marketDataStatus.mode}, update {data.dailyBrief.marketDataStatus.lastUpdatedAt ?? "n/a"}.
              </p>
              {data.dailyBrief.opportunityRadar[0] ? (
                <div className="opportunity-spotlight">
                  <div>
                    <p className="kicker">Spotlight</p>
                    <h3>{data.dailyBrief.opportunityRadar[0].title}</h3>
                    <p className="muted">{data.dailyBrief.opportunityRadar[0].whyNow}</p>
                  </div>
                  <div className="spotlight-metrics">
                    <div className="mini-stat">
                      <span>Kurs teraz</span>
                      <strong>{fmtQuote(data.dailyBrief.opportunityRadar[0].priceNow)} {data.dailyBrief.opportunityRadar[0].quoteCurrency}</strong>
                    </div>
                    <div className="mini-stat">
                      <span>Nastawienie</span>
                      <strong>{actionBiasLabel(data.dailyBrief.opportunityRadar[0].actionBias)}</strong>
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="opportunity-grid">
                {data.dailyBrief.opportunityRadar.map((idea) => (
                  <article key={idea.id} className="opportunity-card">
                    <div className="alert-header">
                      <strong>{idea.title}</strong>
                      <span className="badge subtle">{idea.assetClass}</span>
                    </div>
                    <div className="opportunity-metrics">
                      <div className="opportunity-metric">
                        <span>Cena</span>
                        <strong>{fmtQuote(idea.priceNow)} {idea.quoteCurrency}</strong>
                      </div>
                      <div className="opportunity-metric">
                        <span>1D</span>
                        <strong className={idea.change1dPct >= 0 ? "positive" : "negative"}>{fmtPct(idea.change1dPct)}</strong>
                      </div>
                      <div className="opportunity-metric">
                        <span>3M</span>
                        <strong className={idea.momentum3mPct >= 0 ? "positive" : "negative"}>{fmtPct(idea.momentum3mPct)}</strong>
                      </div>
                    </div>
                    <div className="opportunity-header-row">
                      <span className="setup-chip">{idea.setup}</span>
                      <span className={actionBiasClass(idea.actionBias)}>{actionBiasLabel(idea.actionBias)}</span>
                    </div>
                    <p><strong>Dlaczego teraz:</strong> {idea.whyNow}</p>
                    <p><strong>Ryzyko:</strong> {idea.risk}</p>
                    <p><strong>Co robic teraz:</strong> {idea.decisionNote}</p>
                    <p><strong>Nastawienie:</strong> {actionBiasLabel(idea.actionBias)}</p>
                    <p className="meta-line">Source: {idea.source} · update {new Date(idea.updatedAt).toLocaleString("pl-PL")}</p>
                  </article>
                ))}
              </div>
            </div>

            <div className="stack">
              <div className="panel">
                <div className="panel-head">
                  <div>
                    <p className="kicker">Risk</p>
                    <h2>Ryzyka i terminy</h2>
                  </div>
                </div>
                <div className="stack">
                  {derived.largestDrift ? (
                    <article className="context-item">
                      <strong>Najwiekszy drift alokacji</strong>
                      <p>{derived.largestDrift.assetClass}: {fmtPct(derived.largestDrift.pct)} przy odchyleniu {fmtPct(derived.largestDrift.driftPct)}</p>
                    </article>
                  ) : null}
                  {derived.nearestBondMaturity ? (
                    <article className="context-item">
                      <strong>Najblizszy wykup obligacji</strong>
                      <p>{derived.nearestBondMaturity.holding.symbol} za {derived.nearestBondMaturity.days} dni, wartosc {fmtAmount(derived.nearestBondMaturity.holding.marketValue)}</p>
                    </article>
                  ) : null}
                  {derived.currencyExposure.slice(0, 3).map((item) => (
                    <article key={item.currencyCode} className="context-item">
                      <strong>Ekspozycja walutowa: {item.currencyCode}</strong>
                      <p>{fmtAmount(item.value)} · {fmtPct(item.pct)} calego portfela</p>
                    </article>
                  ))}
                </div>
              </div>

              <div className="panel">
                <div className="panel-head">
                  <div>
                    <p className="kicker">Alerts</p>
                    <h2>Co wymaga uwagi</h2>
                  </div>
                </div>
                <div className="stack">
                  {data.dailyBrief.activeAlerts.map((alert) => (
                    <article key={alert.id} className={`alert-card ${alert.priority}`}>
                      <div className="alert-header">
                        <strong>{alert.title}</strong>
                        <span className="badge subtle">{alert.priority}</span>
                      </div>
                      <p><strong>Zmiana:</strong> {alert.changed}</p>
                      <p><strong>Dlaczego to wazne:</strong> {alert.whyItMatters}</p>
                      <p><strong>Rozwaz:</strong> {alert.considerAction}</p>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <p className="kicker">News</p>
                <h2>Short digest</h2>
              </div>
            </div>
            <div className="watchlist-grid">
              {data.dailyBrief.newsDigest.map((news) => (
                <article key={news.id} className="news-item">
                  <div className="news-meta">
                    <span>{news.source}</span>
                    <span>{news.symbol ?? "Macro"}</span>
                  </div>
                  <strong>{news.headline}</strong>
                  <p>{news.summary}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <p className="kicker">ETF radar</p>
                <h2>ETF shortlist do sprawdzenia</h2>
              </div>
            </div>
            <div className="opportunity-grid">
              {data.dailyBrief.opportunityRadar
                .filter((idea) => idea.assetClass === "ETF")
                .map((idea) => (
                  <article key={idea.id} className="opportunity-card etf-shortlist-card">
                    <div className="alert-header">
                      <strong>{idea.title}</strong>
                      <span className="badge subtle">{idea.symbol}</span>
                    </div>
                    <div className="opportunity-metrics">
                      <div className="opportunity-metric">
                        <span>Kurs</span>
                        <strong>{fmtQuote(idea.priceNow)} {idea.quoteCurrency}</strong>
                      </div>
                      <div className="opportunity-metric">
                        <span>1D</span>
                        <strong className={idea.change1dPct >= 0 ? "positive" : "negative"}>{fmtPct(idea.change1dPct)}</strong>
                      </div>
                      <div className="opportunity-metric">
                        <span>3M</span>
                        <strong className={idea.momentum3mPct >= 0 ? "positive" : "negative"}>{fmtPct(idea.momentum3mPct)}</strong>
                      </div>
                    </div>
                    <p><strong>Setup:</strong> {idea.setup}</p>
                    <p><strong>Nastawienie:</strong> {actionBiasLabel(idea.actionBias)}</p>
                    <p><strong>Dlaczego warto sprawdzic:</strong> {idea.whyNow}</p>
                    <p><strong>Co robic teraz:</strong> {idea.decisionNote}</p>
                  </article>
                ))}
            </div>
          </section>
        </section>
      ) : null}

      {view === "portfolio" ? (
        <section className="stack">
          <section className="panel">
            <div className="panel-head">
              <div>
                <p className="kicker">Portfolio</p>
                <h2>Przeglad calego portfela</h2>
              </div>
            </div>
            <div className="xtb-summary-grid portfolio-header-grid">
              <div className="mini-stat xtb-summary-card portfolio-hero-card">
                <span className="summary-label">Laczna wartosc</span>
                <strong>{fmtAmount(data.portfolio.totalValue)}</strong>
                <small>{derived.totalOpenPositions} otwartych pozycji we wszystkich rachunkach</small>
              </div>
              <div className="mini-stat xtb-summary-card">
                <span className="summary-label">Laczny wynik</span>
                <strong className={derived.portfolioProfit >= 0 ? "positive" : "negative"}>
                  {fmtAmount(derived.portfolioProfit)}
                </strong>
                <small>{fmtPct(derived.portfolioReturnPct)} stopy zwrotu</small>
              </div>
              <div className="mini-stat xtb-summary-card">
                <span className="summary-label">Dzienna zmiana</span>
                <strong className={derived.portfolioDailyChangeValue >= 0 ? "positive" : "negative"}>
                  {fmtAmount(derived.portfolioDailyChangeValue)}
                </strong>
                <small>{fmtPct(data.portfolio.dayChangePct)} dla calego portfela</small>
              </div>
              <div className="mini-stat xtb-summary-card">
                <span className="summary-label">Kapital wlozony</span>
                <strong>{fmtAmount(derived.portfolioCostBasis)}</strong>
                <small>{data.portfolio.accounts.length} rachunki inwestycyjne</small>
              </div>
            </div>
            <div className="portfolio-charts-grid">
              <AllocationDonut items={data.portfolio.allocationByClass} totalValue={data.portfolio.totalValue} />
              <AccountsBarChart accounts={data.portfolio.accounts} totalValue={data.portfolio.totalValue} />
            </div>
          </section>

          {derived.xtbAccount ? (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <p className="kicker">Broker</p>
                  <h2>XTB</h2>
                </div>
              </div>
              <AccountOverview
                title="Rachunek XTB"
                kicker="XTB account"
                account={derived.xtbAccount}
                portfolioDayChangePct={data.dailyBrief.marketDataStatus.mode === "live" ? data.portfolio.dayChangePct : 0}
                showRefresh
                onRefresh={() => void handleRefreshMarketData()}
              />
            </section>
          ) : null}

          {derived.emaklerAccounts.length ? (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <p className="kicker">Broker</p>
                  <h2>eMakler</h2>
                </div>
              </div>
              <div className="stack">
                {derived.emaklerAccounts.map((account) => (
                  <AccountOverview
                    key={account.id}
                    title={`Rachunek ${account.name}`}
                    kicker="eMakler account"
                    account={account}
                    portfolioDayChangePct={data.dailyBrief.marketDataStatus.mode === "live" ? data.portfolio.dayChangePct : 0}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {derived.treasuryBondsAccount ? (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <p className="kicker">Rachunek</p>
                  <h2>Obligacje Skarbowe</h2>
                </div>
              </div>
              <BondAccountOverview
                title="Rachunek obligacji"
                kicker="Treasury Bonds"
                account={derived.treasuryBondsAccount}
              />
            </section>
          ) : null}

          <section className="stack auxiliary-tools">
            <details className="panel settings-panel">
              <summary>
                <span>
                  <p className="kicker">Settings</p>
                  <h2>Centrum importu portfela</h2>
                </span>
              </summary>
              <section className="stack settings-grid">
                <div className="import-sources-grid">
                  <div className="emakler-import-card import-source-card">
                    <div>
                      <p className="kicker">Source 1</p>
                      <strong>XTB</strong>
                      <p className="muted">Workbook z historia transakcji i odbudowa aktualnych pozycji brokera.</p>
                    </div>
                    <label>
                      Sciezka do pliku XLSX
                      <input value={xtbPath} onChange={(event) => setXtbPath(event.target.value)} />
                    </label>
                    <div className="row-actions">
                      <button className="primary-button" onClick={handleXtbImport}>Importuj z XTB</button>
                      <button className="secondary-button" onClick={handleSyncHoldings}>Przelicz pozycje</button>
                    </div>
                  </div>

                  <div className="emakler-import-card import-source-card">
                    <div>
                      <p className="kicker">Source 2</p>
                      <strong>eMakler mBank</strong>
                      <p className="muted">Import historii transakcji dla IKE i IKZE z plikow CSV.</p>
                    </div>
                    <label>
                      Sciezka do CSV IKE
                      <input value={emaklerIkePath} onChange={(event) => setEmaklerIkePath(event.target.value)} />
                    </label>
                    <button className="secondary-button" onClick={() => void handleEmaklerImport("IKE")}>
                      Importuj IKE
                    </button>
                    <label>
                      Sciezka do CSV IKZE
                      <input value={emaklerIkzePath} onChange={(event) => setEmaklerIkzePath(event.target.value)} />
                    </label>
                    <button className="secondary-button" onClick={() => void handleEmaklerImport("IKZE")}>
                      Importuj IKZE
                    </button>
                  </div>

                  <div className="emakler-import-card import-source-card">
                    <div>
                      <p className="kicker">Source 3</p>
                      <strong>Obligacje Skarbowe</strong>
                      <p className="muted">Import stanu rachunku rejestrowego z liczba obligacji, wartoscia i data wykupu.</p>
                    </div>
                    <label>
                      Sciezka do pliku XLS lub XLSX
                      <input value={treasuryBondsPath} onChange={(event) => setTreasuryBondsPath(event.target.value)} />
                    </label>
                    <button className="secondary-button" onClick={handleTreasuryBondsImport}>
                      Importuj obligacje
                    </button>
                  </div>
                </div>

                <details className="subsettings">
                  <summary>Mapowanie tickerow XTB</summary>
                  <div className="stack top-space">
                    {derived.xtbAccount?.holdings.map((holding) => {
                      const existing = mappings.find((item) => item.sourceSymbol === holding.symbol);
                      const inputValue = Object.prototype.hasOwnProperty.call(mappingInputs, holding.symbol)
                        ? mappingInputs[holding.symbol]
                        : "";
                      return (
                        <div key={holding.id} className="summary-row">
                          <div>
                            <strong>{holding.name}</strong>
                            <p>{holding.symbol}</p>
                            <p className="muted">Zapisane mapowanie: {existing?.marketTicker ?? "brak"}</p>
                          </div>
                          <div className="mapping-row">
                            <input
                              value={inputValue}
                              onChange={(event) =>
                                setMappingInputs({ ...mappingInputs, [holding.symbol]: event.target.value })
                              }
                              autoComplete="off"
                              spellCheck={false}
                              placeholder={existing?.marketTicker ?? "np. AAPL.US"}
                            />
                            <button className="secondary-button" onClick={() => void saveMapping(holding.symbol, holding.name)}>
                              Save
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </details>
              </section>
              {importMessage ? <p className="muted top-space">{importMessage}</p> : null}
            </details>

            <details className="panel settings-panel">
              <summary>
                <span>
                  <p className="kicker">Advanced</p>
                  <h2>Allocation i reczne korekty</h2>
                </span>
              </summary>
              <section className="grid two-up settings-grid">
                <div className="stack">
                  {data.portfolio.allocationByClass.map((item) => (
                    <div key={item.assetClass} className="allocation-row">
                      <div>
                        <strong>{item.assetClass}</strong>
                        <p>{fmtAmount(item.value)}</p>
                      </div>
                      <div>
                        <p>Current: {fmtPct(item.pct)}</p>
                        <p>Target: {fmtPct(item.targetPct)}</p>
                      </div>
                      <div className={item.driftPct >= 0 ? "positive" : "negative"}>{fmtPct(item.driftPct)}</div>
                    </div>
                  ))}
                </div>

                <div>
                  <p className="muted">To sa narzedzia pomocnicze do recznych korekt, nie glowny workflow dla XTB.</p>
                  <form className="form-grid" onSubmit={handleAddHolding}>
                    <label>
                      Account
                      <select
                        value={holdingForm.accountId}
                        onChange={(event) => setHoldingForm({ ...holdingForm, accountId: event.target.value })}
                      >
                        {data.portfolio.accounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Symbol
                      <input
                        value={holdingForm.symbol}
                        onChange={(event) => setHoldingForm({ ...holdingForm, symbol: event.target.value })}
                        placeholder="VWCE"
                      />
                    </label>
                    <label>
                      Name
                      <input
                        value={holdingForm.name}
                        onChange={(event) => setHoldingForm({ ...holdingForm, name: event.target.value })}
                        placeholder="Vanguard FTSE All-World"
                      />
                    </label>
                    <label>
                      Asset class
                      <select
                        value={holdingForm.assetClass}
                        onChange={(event) =>
                          setHoldingForm({ ...holdingForm, assetClass: event.target.value as AssetClass })
                        }
                      >
                        <option value="ETF">ETF</option>
                        <option value="STOCK">Stock</option>
                        <option value="BOND">Bond</option>
                        <option value="COMMODITY">Commodity</option>
                        <option value="CASH">Cash</option>
                      </select>
                    </label>
                    <label>
                      Quantity
                      <input
                        type="number"
                        step="0.01"
                        value={holdingForm.quantity}
                        onChange={(event) => setHoldingForm({ ...holdingForm, quantity: event.target.value })}
                      />
                    </label>
                    <label>
                      Avg cost
                      <input
                        type="number"
                        step="0.01"
                        value={holdingForm.averageCost}
                        onChange={(event) => setHoldingForm({ ...holdingForm, averageCost: event.target.value })}
                      />
                    </label>
                    <label>
                      Current price
                      <input
                        type="number"
                        step="0.01"
                        value={holdingForm.currentPrice}
                        onChange={(event) => setHoldingForm({ ...holdingForm, currentPrice: event.target.value })}
                      />
                    </label>
                    <label>
                      Currency
                      <input
                        value={holdingForm.currency}
                        onChange={(event) => setHoldingForm({ ...holdingForm, currency: event.target.value })}
                      />
                    </label>
                    <label>
                      Target %
                      <input
                        type="number"
                        step="0.1"
                        value={holdingForm.targetAllocationPct}
                        onChange={(event) =>
                          setHoldingForm({ ...holdingForm, targetAllocationPct: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Maturity date
                      <input
                        type="date"
                        value={holdingForm.maturityDate}
                        onChange={(event) => setHoldingForm({ ...holdingForm, maturityDate: event.target.value })}
                      />
                    </label>
                    <button className="primary-button" type="submit">{editingHoldingId ? "Save holding" : "Add holding"}</button>
                    {editingHoldingId ? (
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => {
                          setEditingHoldingId(null);
                          setHoldingForm(initialHoldingForm);
                        }}
                      >
                        Cancel edit
                      </button>
                    ) : null}
                  </form>
                  {actionMessage ? <p className="muted top-space">{actionMessage}</p> : null}
                </div>
              </section>
            </details>
          </section>
        </section>
      ) : null}

      {view === "watchlist" ? (
        <section className="stack">
          <section className="grid two-up">
            <div className="panel">
              <div className="panel-head">
                <div>
                  <p className="kicker">Radar</p>
                  <h2>Watchlist and research</h2>
                </div>
              </div>
              <div className="watchlist-grid">
                {data.watchlist.map((item) => (
                  <article
                    key={item.id}
                    className={item.dataFreshness === "stale" ? "watch-card stale" : "watch-card"}
                  >
                    <div className="watch-header">
                      <div>
                        <strong>{item.symbol}</strong>
                        <p>{item.name}</p>
                      </div>
                      <span className="badge subtle">{item.thesisTag}</span>
                    </div>
                    <p>{item.thesis}</p>
                    <div className="watch-metrics">
                      <span>Price: {item.lastPrice}</span>
                      <span className={item.priceChange1dPct >= 0 ? "positive" : "negative"}>
                        1D: {fmtPct(item.priceChange1dPct)}
                      </span>
                      <span className={item.momentum3mPct >= 0 ? "positive" : "negative"}>
                        3M: {fmtPct(item.momentum3mPct)}
                      </span>
                    </div>
                    <div className="row-actions top-space">
                      <button
                        className="secondary-button"
                        onClick={() => {
                          setEditingWatchlistId(item.id);
                          setWatchlistForm({
                            symbol: item.symbol,
                            name: item.name,
                            assetClass: item.assetClass as AssetClass,
                            thesis: item.thesis,
                            thesisTag: item.thesisTag,
                            lastPrice: String(item.lastPrice),
                            priceChange1dPct: String(item.priceChange1dPct),
                            momentum3mPct: String(item.momentum3mPct),
                            dataFreshness: item.dataFreshness
                          });
                        }}
                      >
                        Edit
                      </button>
                      <button className="ghost-button" onClick={() => void handleDeleteWatchlist(item.id)}>
                        Delete
                      </button>
                    </div>
                    {item.dataFreshness === "stale" ? (
                      <p className="muted">Marked stale. Verify before acting.</p>
                    ) : null}
                  </article>
                ))}
              </div>
            </div>

            <div className="panel">
              <div className="panel-head">
                <div>
                  <p className="kicker">Action</p>
                  <h2>{editingWatchlistId ? "Edit radar item" : "Add radar item"}</h2>
                </div>
              </div>
              <form className="form-grid" onSubmit={handleAddWatchlist}>
                <label>
                  Symbol
                  <input
                    value={watchlistForm.symbol}
                    onChange={(event) => setWatchlistForm({ ...watchlistForm, symbol: event.target.value })}
                    placeholder="SHEL"
                  />
                </label>
                <label>
                  Name
                  <input
                    value={watchlistForm.name}
                    onChange={(event) => setWatchlistForm({ ...watchlistForm, name: event.target.value })}
                    placeholder="Shell"
                  />
                </label>
                <label>
                  Asset class
                  <select
                    value={watchlistForm.assetClass}
                    onChange={(event) =>
                      setWatchlistForm({ ...watchlistForm, assetClass: event.target.value as AssetClass })
                    }
                  >
                    <option value="ETF">ETF</option>
                    <option value="STOCK">Stock</option>
                    <option value="BOND">Bond</option>
                    <option value="COMMODITY">Commodity</option>
                    <option value="CASH">Cash</option>
                  </select>
                </label>
                <label>
                  Tag
                  <input
                    value={watchlistForm.thesisTag}
                    onChange={(event) => setWatchlistForm({ ...watchlistForm, thesisTag: event.target.value })}
                  />
                </label>
                <label className="full-span">
                  Thesis
                  <textarea
                    rows={5}
                    value={watchlistForm.thesis}
                    onChange={(event) => setWatchlistForm({ ...watchlistForm, thesis: event.target.value })}
                    placeholder="Why does this belong on your radar?"
                  />
                </label>
                <label>
                  Last price
                  <input
                    type="number"
                    step="0.01"
                    value={watchlistForm.lastPrice}
                    onChange={(event) => setWatchlistForm({ ...watchlistForm, lastPrice: event.target.value })}
                  />
                </label>
                <label>
                  1D change %
                  <input
                    type="number"
                    step="0.1"
                    value={watchlistForm.priceChange1dPct}
                    onChange={(event) =>
                      setWatchlistForm({ ...watchlistForm, priceChange1dPct: event.target.value })
                    }
                  />
                </label>
                <label>
                  3M momentum %
                  <input
                    type="number"
                    step="0.1"
                    value={watchlistForm.momentum3mPct}
                    onChange={(event) =>
                      setWatchlistForm({ ...watchlistForm, momentum3mPct: event.target.value })
                    }
                  />
                </label>
                <label>
                  Freshness
                  <select
                    value={watchlistForm.dataFreshness}
                    onChange={(event) =>
                      setWatchlistForm({ ...watchlistForm, dataFreshness: event.target.value as Freshness })
                    }
                  >
                    <option value="fresh">Fresh</option>
                    <option value="stale">Stale</option>
                  </select>
                </label>
                <button className="primary-button" type="submit">{editingWatchlistId ? "Save watchlist item" : "Add watchlist item"}</button>
                {editingWatchlistId ? (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      setEditingWatchlistId(null);
                      setWatchlistForm(initialWatchlistForm);
                    }}
                  >
                    Cancel edit
                  </button>
                ) : null}
              </form>
              {actionMessage ? <p className="muted">{actionMessage}</p> : null}
            </div>
          </section>
        </section>
      ) : null}
    </main>
  );
}
