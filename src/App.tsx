import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { CandlestickSeries, ColorType, createChart } from "lightweight-charts";
import type { DashboardResponse, InstrumentMapping, MarketScanItem, MonthlyPerformanceResponse, TradeSetupResponse } from "./types";

type ViewName = "today" | "portfolio" | "market-radar" | "trade-setup" | "watchlist";
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

function fmtSignedAmount(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${fmtAmount(value)}`;
}

function fmtSignedPct(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${fmtPct(value)}`;
}

type MonthlyRange = "6M" | "12M" | "YTD" | "ALL";

function filterMonthlyPoints(
  points: MonthlyPerformanceResponse["total"]["points"],
  range: MonthlyRange
) {
  if (range === "ALL") {
    return points;
  }
  if (range === "YTD") {
    const currentYear = new Date().getFullYear();
    return points.filter((point) => Number(point.month.slice(0, 4)) === currentYear);
  }
  const count = range === "6M" ? 6 : 12;
  return points.slice(-count);
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

function fmtDateTime(value: string | null) {
  if (!value) {
    return "brak";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

type FileDropzoneProps = {
  label: string;
  accept?: string;
  file: File | null;
  onFileSelect: (file: File | null) => void;
};

function FileDropzone({ label, accept, file, onFileSelect }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    onFileSelect(event.target.files?.[0] ?? null);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const droppedFile = event.dataTransfer.files?.[0] ?? null;
    onFileSelect(droppedFile);
  }

  return (
    <div className="stack file-dropzone-wrap">
      <p className="field-label">{label}</p>
      <input
        ref={inputRef}
        className="file-input-hidden"
        type="file"
        accept={accept}
        onChange={handleFileInput}
      />
      <div
        className={`file-dropzone ${isDragging ? "dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <strong>{file ? file.name : "Upusc plik tutaj"}</strong>
        <p>{file ? "Kliknij, aby podmienic plik" : "albo kliknij, aby wybrac z komputera"}</p>
      </div>
      {file ? (
        <div className="selected-file-row">
          <span className="muted">Wybrany plik: {file.name}</span>
          <button className="ghost-button" type="button" onClick={() => onFileSelect(null)}>
            Wyczyść
          </button>
        </div>
      ) : null}
    </div>
  );
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

function preferredActionLabel(value: TradeSetupResponse["preferredAction"]) {
  if (value === "LONG") {
    return "Przewaga po stronie long";
  }
  if (value === "SHORT") {
    return "Przewaga po stronie short";
  }
  return "Na razie czekaj";
}

function preferredActionClass(value: TradeSetupResponse["preferredAction"]) {
  if (value === "LONG") {
    return "signal-pill long";
  }
  if (value === "SHORT") {
    return "signal-pill short";
  }
  return "signal-pill wait";
}

function marketSignalClass(value: MarketScanItem["signal"]) {
  if (value === "WATCH LONG") {
    return "signal-pill long";
  }
  if (value === "WATCH SHORT") {
    return "signal-pill short";
  }
  return "signal-pill wait";
}

function strengthClass(value: MarketScanItem["strength"]) {
  if (value === "HIGH") {
    return "quality-pill high";
  }
  if (value === "MEDIUM") {
    return "quality-pill medium";
  }
  return "quality-pill low";
}

function setupQualityClass(value: TradeSetupResponse["setupQuality"]) {
  if (value === "Wysoka") {
    return "quality-pill high";
  }
  if (value === "Srednia") {
    return "quality-pill medium";
  }
  return "quality-pill low";
}

function roundPrice(value: number) {
  if (value >= 100) {
    return Number(value.toFixed(1));
  }
  if (value >= 10) {
    return Number(value.toFixed(2));
  }
  return Number(value.toFixed(3));
}

function buildTradeSetup(idea: DashboardResponse["dailyBrief"]["opportunityRadar"][number]) {
  const isCommodity = idea.assetClass === "COMMODITY";
  const entryBufferPct = isCommodity ? 0.8 : 0.6;
  const pullbackPct =
    idea.actionBias === "buy-on-pullback"
      ? isCommodity ? 1.6 : 1.2
      : idea.actionBias === "trim-risk"
        ? isCommodity ? 2.4 : 1.8
        : isCommodity ? 1.1 : 0.9;
  const invalidationPct = isCommodity ? 2.8 : 2.1;
  const tp1Pct = isCommodity ? 3.4 : 4.2;
  const tp2Pct = isCommodity ? 6.1 : 7.6;

  const watchLow = roundPrice(idea.priceNow * (1 - pullbackPct / 100));
  const watchHigh = roundPrice(idea.priceNow * (1 + entryBufferPct / 100));
  const breakoutTrigger = roundPrice(idea.priceNow * (1 + entryBufferPct / 100));
  const invalidation = roundPrice(idea.priceNow * (1 - invalidationPct / 100));
  const tp1 = roundPrice(idea.priceNow * (1 + tp1Pct / 100));
  const tp2 = roundPrice(idea.priceNow * (1 + tp2Pct / 100));
  const downsideTrigger = roundPrice(idea.priceNow * (1 - entryBufferPct / 100));
  const defensiveTarget = roundPrice(idea.priceNow * (1 - (isCommodity ? 3.1 : 4.1) / 100));

  let planMode = "Najpierw obserwuj";
  let scenarioA = "Jesli rynek obroni biezaca strefe i zamknie sesje mocniej, temat wraca do gry jako kandydat do wejscia.";
  let scenarioB = "Jesli rynek straci strefe obserwacji, lepiej odpuscic i poczekac na nowa baze albo reset ruchu.";
  let riskTemplate = "Ryzyko trzymaj raczej male: wejscie dopiero po potwierdzeniu, bez gonienia pierwszej swiecy.";

  if (idea.actionBias === "momentum") {
    planMode = "Scenariusz wybicia";
    scenarioA = "Jesli rynek przebije lokalny szczyt i utrzyma impet, to jest zagranie na kontynuacje ruchu.";
    scenarioB = "Jesli po wybiciu rynek szybko cofnie sie pod trigger, momentum slabnie i warto odpuscic.";
    riskTemplate = "Na momentum nie zwiekszaj pozycji od razu. Najpierw maly rozmiar i szybkie przejscie na break even po pierwszym ruchu.";
  } else if (idea.actionBias === "buy-on-pullback") {
    planMode = "Scenariusz cofniecia";
    scenarioA = "Jesli cofniecie zatrzyma sie w strefie obserwacji i pojawi sie obrona, to jest lepszy moment niz kupowanie po goracej swiecy.";
    scenarioB = "Jesli cofniecie zamienia sie w dalszy zjazd, znaczy ze przewaga kupujacych jeszcze nie wrocila.";
    riskTemplate = "Przy cofnieciu pilnuj invalidation. To ma byc zagranie na obrone trendu, nie lapanie spadajacego noza.";
  } else if (idea.actionBias === "trim-risk") {
    planMode = "Scenariusz wysokiej zmiennosci";
    scenarioA = "Jesli rynek tylko odpocznie i wraca powyzej triggera, temat dalej jest mocny, ale wejscie musi byc mniejsze niz zwykle.";
    scenarioB = "Jesli rynek nie utrzyma biezacej strefy, po takim pionowym ruchu cofniecie moze byc bardzo szybkie.";
    riskTemplate = "To jest rynek newsowy. Nie gon ruchu i nie trzymaj bez planu invalidation.";
  }

  return {
    ...idea,
    watchLow,
    watchHigh,
    breakoutTrigger,
    invalidation,
    tp1,
    tp2,
    downsideTrigger,
    defensiveTarget,
    planMode,
    scenarioA,
    scenarioB,
    riskTemplate
  };
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

function MonthlyValueChart({
  points,
  accent = "#216b72"
}: {
  points: MonthlyPerformanceResponse["total"]["points"];
  accent?: string;
  }) {
    if (!points.length) {
      return <p className="muted">Brak danych miesiecznych.</p>;
    }

    const visiblePoints = points;
    const maxValue = Math.max(...visiblePoints.map((item) => item.value), 1);

  return (
    <div className="monthly-chart">
        <div className="monthly-bars" style={{ gridTemplateColumns: `repeat(${Math.max(visiblePoints.length, 1)}, minmax(0, 1fr))` }}>
          {visiblePoints.map((point) => (
            <div key={point.month} className="monthly-bar-col">
            <div
              className="monthly-bar-fill"
              style={{
                height: `${Math.max((point.value / maxValue) * 100, 6)}%`,
                background: `linear-gradient(180deg, ${accent}, rgba(192, 122, 51, 0.82))`
              }}
              title={`${point.label}: ${fmtAmount(point.value)}`}
            />
            <span>{point.label.slice(0, 5)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MonthlyMarker({
  title,
  points
}: {
  title: string;
  points: MonthlyPerformanceResponse["total"]["points"];
}) {
  const latest = points[points.length - 1] ?? null;

  return (
    <div className="mini-stat monthly-marker-card">
      <span>{title}</span>
      <strong>{latest ? fmtAmount(latest.value) : "brak"}</strong>
      <small className={latest && (latest.changeValue ?? 0) >= 0 ? "positive" : "negative"}>
        {latest?.changeValue == null || latest.changePct == null
          ? "Brak porownania miesiac do miesiaca"
          : `${fmtSignedAmount(latest.changeValue)} · ${fmtSignedPct(latest.changePct)}`}
      </small>
    </div>
  );
}

function EnhancedMonthlyMarker({
  title,
  points,
  mode = "raw"
}: {
  title: string;
  points: MonthlyPerformanceResponse["total"]["points"];
  mode?: "raw" | "adjusted";
}) {
  const latest = points[points.length - 1] ?? null;
  const changeValue = mode === "adjusted" ? latest?.flowAdjustedChangeValue ?? null : latest?.changeValue ?? null;
  const changePct = mode === "adjusted" ? latest?.flowAdjustedChangePct ?? null : latest?.changePct ?? null;
  const subtitle = mode === "adjusted" ? "Po oczyszczeniu z doplat i wyplat" : "Surowa zmiana miesiac do miesiaca";

  return (
    <div className="mini-stat monthly-marker-card">
      <span>{title}</span>
      <strong>{latest ? fmtAmount(latest.value) : "brak"}</strong>
      <small className={changeValue != null && changeValue >= 0 ? "positive" : "negative"}>
        {changeValue == null || changePct == null
          ? "Brak porownania miesiac do miesiaca"
          : `${fmtSignedAmount(changeValue)} · ${fmtSignedPct(changePct)}`}
      </small>
      <small className="muted">{subtitle}</small>
    </div>
  );
}

function OilCandlesChart({
  setup,
  interval,
  onIntervalChange,
  plan
}: {
  setup: TradeSetupResponse;
  interval: "15m" | "30m" | "1h";
  onIntervalChange: (interval: "15m" | "30m" | "1h") => void;
  plan: TradeSetupResponse["atrPlan"];
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);

  useEffect(() => {
    if (!hostRef.current || !setup.candles.length) {
      return;
    }
    setChartError(null);

    let chart: ReturnType<typeof createChart> | null = null;
    let resizeObserver: ResizeObserver | null = null;

    try {
      chart = createChart(hostRef.current, {
        width: Math.max(hostRef.current.clientWidth, 320),
        height: 380,
        layout: {
          background: { type: ColorType.Solid, color: "#f8fbfd" },
          textColor: "#405263"
        },
        grid: {
          vertLines: { color: "rgba(23, 34, 45, 0.06)" },
          horzLines: { color: "rgba(23, 34, 45, 0.06)" }
        },
        rightPriceScale: {
          borderColor: "rgba(23, 34, 45, 0.08)"
        },
        timeScale: {
          borderColor: "rgba(23, 34, 45, 0.08)",
          timeVisible: true
        },
        localization: {
          locale: "pl-PL",
          timeFormatter: (time) => {
            const timestamp = typeof time === "number" ? time * 1000 : Date.now();
            return new Date(timestamp).toLocaleString("pl-PL", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit"
            });
          }
        },
        crosshair: {
          vertLine: { labelBackgroundColor: "#163449" },
          horzLine: { labelBackgroundColor: "#163449" }
        }
      });

      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: "#0d7a48",
        downColor: "#b54c31",
        borderVisible: false,
        wickUpColor: "#0d7a48",
        wickDownColor: "#b54c31"
      });

      candleSeries.setData(
        setup.candles.map((candle) => ({
          time: Math.floor(new Date(candle.timestamp).getTime() / 1000) as never,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close
        }))
      );

      [
        { title: "Watch low", value: setup.watchZoneLow, color: "rgba(22, 52, 73, 0.45)" },
        { title: "Watch high", value: setup.watchZoneHigh, color: "rgba(22, 52, 73, 0.45)" },
        { title: "Entry", value: plan.entry, color: "rgba(13, 122, 72, 0.72)" },
        { title: "Breakout", value: setup.breakoutTrigger, color: "rgba(13, 122, 72, 0.52)" },
        { title: "Breakdown", value: setup.breakdownTrigger, color: "rgba(181, 76, 49, 0.52)" },
        { title: "SL", value: plan.sl, color: "rgba(181, 76, 49, 0.72)" },
        { title: "TP1", value: plan.tp1, color: "rgba(192, 122, 51, 0.82)" },
        { title: "TP2", value: plan.tp2, color: "rgba(192, 122, 51, 0.62)" }
      ].forEach((line) => {
        candleSeries.createPriceLine({
          price: line.value,
          color: line.color,
          lineWidth: 2,
          lineStyle: 2,
          axisLabelVisible: true,
          title: line.title
        });
      });

      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver((entries) => {
          const entry = entries[0];
          if (entry && chart) {
            chart.applyOptions({ width: Math.max(entry.contentRect.width, 320) });
          }
        });
        resizeObserver.observe(hostRef.current);
      }

      chart.subscribeCrosshairMove((param) => {
        if (!tooltipRef.current) {
          return;
        }
        if (!param.point || !param.time || !param.seriesData.size) {
          tooltipRef.current.style.display = "none";
          return;
        }
        const candle = param.seriesData.get(candleSeries) as { open: number; high: number; low: number; close: number } | undefined;
        if (!candle) {
          tooltipRef.current.style.display = "none";
          return;
        }

        const rawTime = typeof param.time === "number" ? param.time * 1000 : Date.now();
        tooltipRef.current.style.display = "block";
        tooltipRef.current.style.left = `${param.point.x + 14}px`;
        tooltipRef.current.style.top = `${param.point.y + 14}px`;
        tooltipRef.current.innerHTML = [
          `<strong>${new Date(rawTime).toLocaleString("pl-PL", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</strong>`,
          `O: ${fmtQuote(candle.open)}`,
          `H: ${fmtQuote(candle.high)}`,
          `L: ${fmtQuote(candle.low)}`,
          `C: ${fmtQuote(candle.close)}`
        ].join("<br/>");
      });

      chart.timeScale().fitContent();
    } catch (error) {
      setChartError(error instanceof Error ? error.message : "Nie udalo sie narysowac wykresu.");
    }

    return () => {
      resizeObserver?.disconnect();
      chart?.remove();
    };
  }, [plan, setup]);

  return (
    <div className="chart-panel trade-chart-panel">
      <div className="panel-head">
        <div>
          <p className="kicker">Chart</p>
          <h3>{setup.instrumentLabel} candles + poziomy setupu</h3>
        </div>
        <div className="chart-toolbar">
          <div className="interval-toggle" role="tablist" aria-label="Interwal wykresu">
            {(["15m", "30m", "1h"] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={interval === option ? "interval-chip active" : "interval-chip"}
                onClick={() => onIntervalChange(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <span className="badge subtle">range 1d</span>
        </div>
      </div>
      {!setup.candles.length ? <p className="muted">Brak swiec z feedu na ten moment.</p> : null}
      <div className="interactive-chart-shell">
        <div ref={hostRef} className="trade-chart-host" />
        <div ref={tooltipRef} className="trade-chart-tooltip" />
      </div>
      {chartError ? <p className="negative">{chartError}</p> : null}
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
  monthlyPoints,
  portfolioDayChangePct,
  showRefresh,
  onRefresh
}: {
  title: string;
  kicker: string;
  account: DashboardResponse["portfolio"]["accounts"][number];
  monthlyPoints?: MonthlyPerformanceResponse["total"]["points"];
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

        {monthlyPoints && monthlyPoints.length ? (
          <div className="account-monthly-panel">
            <div className="panel-head compact">
              <div>
                <p className="kicker">Monthly view</p>
                <h3>Zmiana miesiac do miesiaca</h3>
              </div>
            </div>
            <div className="account-monthly-grid">
              <div className="stack monthly-markers-stack">
                <EnhancedMonthlyMarker title="Koniec miesiaca" points={monthlyPoints} />
                <EnhancedMonthlyMarker title="Koniec miesiaca" points={monthlyPoints} mode="adjusted" />
              </div>
              <MonthlyValueChart points={monthlyPoints} accent="#163449" />
            </div>
          </div>
        ) : null}
      </section>
    );
  }

export function App() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [monthlyPerformance, setMonthlyPerformance] = useState<MonthlyPerformanceResponse | null>(null);
  const [monthlyRange, setMonthlyRange] = useState<MonthlyRange>("12M");
  const [view, setView] = useState<ViewName>("today");
  const [marketScan, setMarketScan] = useState<MarketScanItem[]>([]);
  const [marketScanLoading, setMarketScanLoading] = useState(false);
  const [marketScanError, setMarketScanError] = useState<string | null>(null);
  const [tradeSetup, setTradeSetup] = useState<TradeSetupResponse | null>(null);
  const [tradeInstrument, setTradeInstrument] = useState<
    "WTI" | "BRENT" | "GOLD" | "NASDAQ" | "ETF_ENERGY" | "ETF_MSCI_ACWI" | "MSCI_WORLD" | "NVIDIA"
  >("WTI");
  const [tradeInterval, setTradeInterval] = useState<"15m" | "30m" | "1h">("15m");
  const [tradePlanMode, setTradePlanMode] = useState<"atr" | "structure">("structure");
  const [investmentAmount, setInvestmentAmount] = useState("3000");
  const [positionInput, setPositionInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tradeSetupError, setTradeSetupError] = useState<string | null>(null);
  const [tradeSetupLoading, setTradeSetupLoading] = useState(false);
  const [csvText, setCsvText] = useState(
    "accountName,symbol,tradeDate,type,quantity,price,fees,currency\nIKE długoterminowe,VWCE,2026-03-15,BUY,1,445.2,2.3,EUR"
  );
  const [xtbFile, setXtbFile] = useState<File | null>(null);
  const [emaklerIkeFile, setEmaklerIkeFile] = useState<File | null>(null);
  const [emaklerIkzeFile, setEmaklerIkzeFile] = useState<File | null>(null);
  const [treasuryBondsFile, setTreasuryBondsFile] = useState<File | null>(null);
  const [importMessage, setImportMessage] = useState("");
  const [activeImportKey, setActiveImportKey] = useState<string | null>(null);
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
      void loadMonthlyPerformance();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nieznany blad.");
    }
  }

  async function loadMonthlyPerformance() {
    try {
      const response = await fetch("/api/performance/monthly");
      if (!response.ok) {
        throw new Error("Nie udalo sie pobrac miesiecznej historii portfela.");
      }
      setMonthlyPerformance((await response.json()) as MonthlyPerformanceResponse);
    } catch {
      setMonthlyPerformance(null);
    }
  }

  async function loadTradeSetup(instrument = tradeInstrument, interval = tradeInterval) {
    try {
      setTradeSetupLoading(true);
      setTradeSetupError(null);
      const response = await fetch(`/api/trade-setup?instrument=${encodeURIComponent(instrument)}&interval=${encodeURIComponent(interval)}`);
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.message ?? "Nie udalo sie pobrac trade setupu.");
      }
      setTradeSetup(json as TradeSetupResponse);
    } catch (err) {
      setTradeSetup(null);
      setTradeSetupError(err instanceof Error ? err.message : "Nieznany blad.");
    } finally {
      setTradeSetupLoading(false);
    }
  }

  async function loadMarketScan() {
    try {
      setMarketScanLoading(true);
      setMarketScanError(null);
      const response = await fetch("/api/market/scan");
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.message ?? "Nie udalo sie pobrac market radaru.");
      }
      setMarketScan(Array.isArray(json) ? (json as MarketScanItem[]) : []);
    } catch (err) {
      setMarketScan([]);
      setMarketScanError(err instanceof Error ? err.message : "Nieznany blad.");
    } finally {
      setMarketScanLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
    void loadMarketScan();
  }, []);

  useEffect(() => {
    if (view !== "trade-setup") {
      return;
    }
    const interval = window.setInterval(() => {
      void loadTradeSetup();
    }, 60000);
    return () => window.clearInterval(interval);
  }, [view, tradeInstrument, tradeInterval]);

  useEffect(() => {
    if (view === "trade-setup") {
      void loadTradeSetup(tradeInstrument, tradeInterval);
    }
  }, [tradeInstrument, tradeInterval, view]);

  useEffect(() => {
    if (view !== "market-radar") {
      return;
    }
    void loadMarketScan();
    const interval = window.setInterval(() => {
      void loadMarketScan();
    }, 120000);
    return () => window.clearInterval(interval);
  }, [view]);

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

  const tradeDerived = useMemo(() => {
    if (!tradeSetup) {
      return null;
    }

    const activePlan = tradePlanMode === "atr" ? tradeSetup.atrPlan : tradeSetup.structurePlan;
    const capital = Number(investmentAmount.replace(",", "."));
    const rawPositionSize = Number(positionInput.replace(",", "."));
    const validCapital = Number.isFinite(capital) && capital > 0 ? capital : 0;
    const notionalPerUnitPln = tradeSetup.price * tradeSetup.fxRateToPln * tradeSetup.contractSize;
    const marginPerUnitPln = tradeSetup.isLeveraged ? notionalPerUnitPln / tradeSetup.leverage : notionalPerUnitPln;
    const positionSize =
      Number.isFinite(rawPositionSize) && rawPositionSize > 0
        ? rawPositionSize
        : validCapital > 0 && marginPerUnitPln > 0
          ? validCapital / marginPerUnitPln
          : 0;
    const clampedPositionSize = Math.min(
      tradeSetup.maxPositionSize,
      Math.max(positionSize, positionSize > 0 ? tradeSetup.minPositionSize : 0)
    );
    const inferredCapital = clampedPositionSize * marginPerUnitPln;
    const riskPerUnitPln = Math.abs(activePlan.entry - activePlan.sl) * tradeSetup.contractSize * tradeSetup.fxRateToPln;
    const tp1PerUnitPln = Math.abs(activePlan.tp1 - activePlan.entry) * tradeSetup.contractSize * tradeSetup.fxRateToPln;
    const tp2PerUnitPln = Math.abs(activePlan.tp2 - activePlan.entry) * tradeSetup.contractSize * tradeSetup.fxRateToPln;
    const swapPerUnitQuote =
      activePlan.direction === "LONG"
        ? tradeSetup.swapLongPerLotPerDay ?? 0
        : tradeSetup.swapShortPerLotPerDay ?? 0;
    const swapPerUnitPln = swapPerUnitQuote * tradeSetup.fxRateToPln;
    const warnings: string[] = [];

    if (Number.isFinite(rawPositionSize) && rawPositionSize > 0 && rawPositionSize < tradeSetup.minPositionSize) {
      warnings.push(`Minimalna wielkosc pozycji dla ${tradeSetup.instrumentLabel} to ${tradeSetup.minPositionSize} ${tradeSetup.sizingLabel}.`);
    }
    if (Number.isFinite(rawPositionSize) && rawPositionSize > tradeSetup.maxPositionSize) {
      warnings.push(`Maksymalna wielkosc pozycji dla ${tradeSetup.instrumentLabel} to ${tradeSetup.maxPositionSize} ${tradeSetup.sizingLabel}.`);
    }
    if (validCapital > 0 && validCapital < marginPerUnitPln * tradeSetup.minPositionSize) {
      warnings.push(`Wpisany depozyt nie pokrywa minimalnej pozycji ${tradeSetup.minPositionSize} ${tradeSetup.sizingLabel}.`);
    }

    return {
      activePlan,
      capital: inferredCapital,
      positionSize: clampedPositionSize,
      riskPln: riskPerUnitPln * clampedPositionSize,
      tp1ProfitPln: tp1PerUnitPln * clampedPositionSize,
      tp2ProfitPln: tp2PerUnitPln * clampedPositionSize,
      unitNotionalPln: notionalPerUnitPln,
      unitMarginPln: marginPerUnitPln,
      nominalExposurePln: notionalPerUnitPln * clampedPositionSize,
      swapPerDayPln: swapPerUnitPln * clampedPositionSize,
      warnings
    };
  }, [investmentAmount, positionInput, tradePlanMode, tradeSetup]);

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
    if (!xtbFile) {
      setImportMessage("Najpierw wybierz plik XTB.");
      return;
    }
    setActiveImportKey("xtb");
    const formData = new FormData();
    formData.append("file", xtbFile);
    const response = await fetch("/api/import/xtb-upload", {
      method: "POST",
      body: formData
    });
    const json = await response.json();
    setActiveImportKey(null);
    if (!response.ok) {
      setImportMessage(json.errors?.join(" ") ?? json.message ?? "XTB import failed.");
      return;
    }
    const fileLabel = xtbFile.name;
    const closedCount = json.breakdown?.closedPositions ?? 0;
    const cashCount = json.breakdown?.cashOperations ?? 0;
    setImportMessage(
      `XTB (${fileLabel}): dodano ${json.imported}, pominieto ${json.skipped}. Closed Positions: ${closedCount}, Cash Operations: ${cashCount}. ${json.notes?.join(" ") ?? ""}`
    );
    setXtbFile(null);
    await loadDashboard();
  }

  async function handleEmaklerImport(accountName: "IKE" | "IKZE") {
    const file = accountName === "IKE" ? emaklerIkeFile : emaklerIkzeFile;
    if (!file) {
      setImportMessage(`Najpierw wybierz plik eMakler dla ${accountName}.`);
      return;
    }
    setActiveImportKey(`emakler-${accountName.toLowerCase()}`);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountName", accountName);
    const response = await fetch("/api/import/emakler-upload", {
      method: "POST",
      body: formData
    });
    const json = await response.json();
    setActiveImportKey(null);
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
    if (accountName === "IKE") {
      setEmaklerIkeFile(null);
    } else {
      setEmaklerIkzeFile(null);
    }
    await loadDashboard();
  }

  async function handleSyncHoldings() {
    const response = await fetch("/api/holdings/sync", { method: "POST" });
    const json = await response.json();
    setImportMessage(`Przeliczono aktualne pozycje XTB: ${json.rebuiltXtb}.`);
    await loadDashboard();
  }

  async function handleResetXtb() {
    setActiveImportKey("xtb-reset");
    const response = await fetch("/api/holdings/reset-xtb", { method: "POST" });
    const json = await response.json();
    setActiveImportKey(null);
    if (!response.ok) {
      setImportMessage(json.message ?? "Nie udalo sie wyczyscic XTB.");
      return;
    }
    setImportMessage(
      `Wyczyszczono XTB: transakcje ${json.removedTransactions}, pozycje ${json.removedHoldings}, mapowania ${json.removedMappings}. Zaimportuj teraz swiezy plik XTB.`
    );
    await loadDashboard();
  }

  async function handleTreasuryBondsImport() {
    if (!treasuryBondsFile) {
      setImportMessage("Najpierw wybierz plik z obligacjami.");
      return;
    }
    setActiveImportKey("treasury");
    const formData = new FormData();
    formData.append("file", treasuryBondsFile);
    const response = await fetch("/api/import/treasury-bonds-upload", {
      method: "POST",
      body: formData
    });
    const json = await response.json();
    setActiveImportKey(null);
    if (!response.ok) {
      setImportMessage(json.errors?.join(" ") ?? json.message ?? "Treasury Bonds import failed.");
      return;
    }
    setImportMessage(`Obligacje Skarbowe: ${json.imported} pozycji, pominieto ${json.skipped}. ${json.notes?.join(" ") ?? ""}`);
    setTreasuryBondsFile(null);
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

  async function handleRefreshTradeSetup() {
    await loadTradeSetup(tradeInstrument, tradeInterval);
    await loadDashboard();
  }

  function handleInvestmentAmountChange(value: string) {
    setInvestmentAmount(value);
    setPositionInput("");
  }

  function handlePositionInputChange(value: string) {
    setPositionInput(value);
    if (!tradeSetup) {
      return;
    }
    const parsed = Number(value.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return;
    }
    const unitNotional = tradeSetup.price * tradeSetup.fxRateToPln * tradeSetup.contractSize;
    const unitMargin = tradeSetup.isLeveraged ? unitNotional / tradeSetup.leverage : unitNotional;
    const capital = parsed * unitMargin;
    setInvestmentAmount(capital.toFixed(0));
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
        <button className={view === "market-radar" ? "tab active" : "tab"} onClick={() => setView("market-radar")}>Market Radar</button>
        <button className={view === "trade-setup" ? "tab active" : "tab"} onClick={() => setView("trade-setup")}>Trade Setup</button>
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

      {view === "market-radar" ? (
        <section className="stack">
          <section className="panel">
            <div className="panel-head">
              <div>
                <p className="kicker">Scanner</p>
                <h2>Market Radar</h2>
              </div>
              <button className="secondary-button" onClick={() => void loadMarketScan()}>Refresh scan</button>
            </div>
            <p className="muted">
              Skan rynku szuka przewag na bazie momentum `1h / 1d`, ATR i breakoutow. To jest shortlista tematow do obserwacji, nie gotowe zlecenia.
            </p>
            {marketScanLoading ? <p className="muted">Ladowanie market radaru...</p> : null}
            {marketScanError ? <p className="negative">{marketScanError}</p> : null}
            {!marketScanLoading && !marketScanError ? (
              <div className="trade-setup-summary">
                <article className="trade-summary-card">
                  <span className="summary-label">WATCH LONG</span>
                  <strong>{marketScan.filter((item) => item.signal === "WATCH LONG").length}</strong>
                  <small>tematy z przewaga po stronie wzrostowej</small>
                </article>
                <article className="trade-summary-card">
                  <span className="summary-label">WATCH SHORT</span>
                  <strong>{marketScan.filter((item) => item.signal === "WATCH SHORT").length}</strong>
                  <small>tematy z przewaga po stronie slabosci</small>
                </article>
                <article className="trade-summary-card">
                  <span className="summary-label">HIGH strength</span>
                  <strong>{marketScan.filter((item) => item.strength === "HIGH").length}</strong>
                  <small>najmocniejsze wskazania ze skanera</small>
                </article>
              </div>
            ) : null}
          </section>

          <section className="opportunity-grid">
            {marketScan.map((item) => (
              <article key={item.asset} className="opportunity-card market-radar-card">
                <div className="alert-header">
                  <strong>{item.label}</strong>
                  <span className="badge subtle">{item.assetClass}</span>
                </div>
                <div className="opportunity-header-row">
                  <span className={marketSignalClass(item.signal)}>{item.signal}</span>
                  <span className={strengthClass(item.strength)}>{item.strength}</span>
                </div>
                <div className="opportunity-metrics">
                  <div className="opportunity-metric">
                    <span>Cena</span>
                    <strong>{fmtQuote(item.priceNow)} {item.quoteCurrency}</strong>
                  </div>
                  <div className="opportunity-metric">
                    <span>1H</span>
                    <strong className={item.change1hPct >= 0 ? "positive" : "negative"}>{fmtSignedPct(item.change1hPct)}</strong>
                  </div>
                  <div className="opportunity-metric">
                    <span>1D</span>
                    <strong className={item.change1dPct >= 0 ? "positive" : "negative"}>{fmtSignedPct(item.change1dPct)}</strong>
                  </div>
                </div>
                <p><strong>ATR:</strong> {fmtQuote(item.atr)} {item.quoteCurrency}</p>
                <p><strong>Breakout:</strong> {item.breakout === "up" ? "wybicie w gore" : item.breakout === "down" ? "wybicie w dol" : "brak"}</p>
                <p><strong>Powod:</strong> {item.reason}</p>
                <p><strong>Ryzyko:</strong> {item.riskNote}</p>
                <p className="meta-line">Score {item.score} · source {item.source} · {fmtDateTime(item.updatedAt)}</p>
              </article>
            ))}
          </section>
        </section>
      ) : null}

      {view === "trade-setup" ? (
        <section className="stack">
          <section className="panel trade-setup-hero">
            <div className="panel-head">
              <div>
                <p className="kicker">Trade setup</p>
                <h2>{tradeSetup?.title ?? "Trade setup"}</h2>
              </div>
              <button className="secondary-button" onClick={handleRefreshTradeSetup}>Refresh setup</button>
            </div>
            <div className="trade-controls">
              <label>
                Instrument
                <select value={tradeInstrument} onChange={(event) => setTradeInstrument(event.target.value as typeof tradeInstrument)}>
                  <option value="WTI">WTI</option>
                  <option value="BRENT">Brent</option>
                  <option value="GOLD">Zloto</option>
                  <option value="NASDAQ">Nasdaq / QQQ</option>
                  <option value="ETF_ENERGY">ETF Energy</option>
                  <option value="ETF_MSCI_ACWI">ETF MSCI ACWI</option>
                  <option value="MSCI_WORLD">MSCI World</option>
                  <option value="NVIDIA">Nvidia</option>
                </select>
              </label>
              <label>
                Interwal
                <select value={tradeInterval} onChange={(event) => setTradeInterval(event.target.value as typeof tradeInterval)}>
                  <option value="15m">15m</option>
                  <option value="30m">30m</option>
                  <option value="1h">1h</option>
                </select>
              </label>
            </div>
            <p className="muted">
              To nie jest automat od klikniecia `buy/sell`, tylko scenariusz do szybkiej oceny rynku.
            </p>
            {tradeSetup ? (
              <div className="trade-data-meta">
                <span className={`badge ${tradeSetup.marketDataMode === "live" ? "" : "subtle"}`}>Tryb danych: {tradeSetup.marketDataMode}</span>
                <span className="badge subtle">Zrodlo: {tradeSetup.source}</span>
                <span className="badge subtle">Ostatnia aktualizacja: {fmtDateTime(tradeSetup.updatedAt)}</span>
              </div>
            ) : null}

            {tradeSetupLoading ? <p className="muted">Ladowanie setupu...</p> : null}
            {tradeSetupError ? <p className="negative">{tradeSetupError}</p> : null}
            {!tradeSetupLoading && !tradeSetupError && !tradeSetup ? (
              <p className="muted">Brak danych setupu dla wybranego instrumentu.</p>
            ) : null}

            {tradeSetup ? <div className="trade-setup-summary">
              <article className="trade-summary-card trade-price-card">
                <span className="summary-label">Aktualny kurs</span>
                <strong>{fmtQuote(tradeSetup.price)} {tradeSetup.quoteCurrency}</strong>
                <small className={tradeSetup.dayChangePct >= 0 ? "positive" : "negative"}>
                  {fmtSignedPct(tradeSetup.dayChangePct)} dzisiaj
                </small>
              </article>
              <article className="trade-summary-card">
                <span className="summary-label">SIGNAL</span>
                <strong className={preferredActionClass(tradeSetup.signal)}>{tradeSetup.signal}</strong>
                <small>{tradeSetup.tradeInvalid ? "Trade invalid" : preferredActionLabel(tradeSetup.signal)}</small>
              </article>
              <article className="trade-summary-card">
                <span className="summary-label">Przewaga</span>
                <strong className={preferredActionClass(tradeSetup.preferredAction)}>{preferredActionLabel(tradeSetup.preferredAction)}</strong>
                <small>{tradeSetup.setupType}</small>
              </article>
              <article className="trade-summary-card">
                <span className="summary-label">Setup quality</span>
                <strong className={setupQualityClass(tradeSetup.setupQuality)}>{tradeSetup.setupQuality}</strong>
                <small>na bazie momentum, ruchu dnia i struktury</small>
              </article>
              <article className="trade-summary-card">
                <span className="summary-label">ATR</span>
                <strong>{fmtQuote(tradeSetup.atr)} {tradeSetup.quoteCurrency}</strong>
                <small>miara biezacej zmiennosci dla wybranego interwalu</small>
              </article>
            </div> : null}
            {tradeSetup?.tradeInvalid ? (
              <div className="trade-invalid-banner">
                <strong>Trade invalid</strong>
                <p>{tradeSetup.invalidReason}</p>
              </div>
            ) : null}
          </section>

          {tradeSetup ? <section className="grid dashboard-grid">
            <div className="panel">
              <div className="panel-head">
                <div>
                  <p className="kicker">Plan</p>
                  <h2>Scenariusz A / B</h2>
                </div>
              </div>
              <div className="trade-plan-toggle">
                <button className={tradePlanMode === "atr" ? "interval-chip active" : "interval-chip"} onClick={() => setTradePlanMode("atr")}>ATR-based plan</button>
                <button className={tradePlanMode === "structure" ? "interval-chip active" : "interval-chip"} onClick={() => setTradePlanMode("structure")}>Structure-based plan</button>
              </div>
              <div className="trade-setup-grid">
                <article className="trade-card">
                  <div className="trade-card-head">
                    <span className="badge">A</span>
                    <strong>Jesli rynek potwierdza setup</strong>
                  </div>
                  <p>{tradeSetup.scenarioA}</p>
                </article>
                <article className="trade-card">
                  <div className="trade-card-head">
                    <span className="badge subtle">B</span>
                    <strong>Jesli rynek zaneguje uklad</strong>
                  </div>
                  <p>{tradeSetup.scenarioB}</p>
                </article>
              </div>

              <div className="trade-levels-grid">
                <article className="trade-level-card">
                  <span>Entry</span>
                  <strong>{fmtQuote(tradeDerived?.activePlan.entry ?? tradeSetup.atrPlan.entry)} {tradeSetup.quoteCurrency}</strong>
                </article>
                <article className="trade-level-card">
                  <span>Strefa obserwacji</span>
                  <strong>{fmtQuote(tradeSetup.watchZoneLow)} - {fmtQuote(tradeSetup.watchZoneHigh)} {tradeSetup.quoteCurrency}</strong>
                </article>
                <article className="trade-level-card">
                  <span>Poziom potwierdzenia long</span>
                  <strong>{fmtQuote(tradeSetup.breakoutTrigger)} {tradeSetup.quoteCurrency}</strong>
                </article>
                <article className="trade-level-card">
                  <span>Poziom potwierdzenia short</span>
                  <strong>{fmtQuote(tradeSetup.breakdownTrigger)} {tradeSetup.quoteCurrency}</strong>
                </article>
                <article className="trade-level-card">
                  <span>SL</span>
                  <strong>{fmtQuote(tradeDerived?.activePlan.sl ?? tradeSetup.invalidation)} {tradeSetup.quoteCurrency}</strong>
                </article>
                <article className="trade-level-card">
                  <span>TP1</span>
                  <strong>{fmtQuote(tradeDerived?.activePlan.tp1 ?? tradeSetup.tp1)} {tradeSetup.quoteCurrency}</strong>
                </article>
                <article className="trade-level-card">
                  <span>TP2</span>
                  <strong>{fmtQuote(tradeDerived?.activePlan.tp2 ?? tradeSetup.tp2)} {tradeSetup.quoteCurrency}</strong>
                </article>
                <article className="trade-level-card">
                  <span>Relacja zysk/ryzyko</span>
                  <strong className={(tradeDerived?.activePlan.riskReward ?? tradeSetup.riskReward) >= tradeSetup.minAcceptedRR ? "positive" : "negative"}>
                    {(tradeDerived?.activePlan.riskReward ?? tradeSetup.riskReward).toFixed(2)}R
                  </strong>
                  <small>minimum {tradeSetup.minAcceptedRR.toFixed(1)}R</small>
                </article>
              </div>
              <div className="trade-plan-note">
                <p><strong>{tradePlanMode === "atr" ? "ATR-based plan:" : "Structure-based plan:"}</strong> {tradePlanMode === "atr" ? tradeSetup.atrPlan.comment : tradeSetup.structurePlan.comment}</p>
                {tradePlanMode === "structure" ? <p><strong>Podstawa:</strong> {tradeSetup.structurePlan.basis}</p> : null}
              </div>
            </div>

            <div className="stack">
              <div className="panel">
                <div className="panel-head">
                  <div>
                    <p className="kicker">Sizing</p>
                    <h2>Kalkulator pozycji</h2>
                  </div>
                </div>
                <div className="trade-sizer">
                  <div className="trade-sizer-inputs">
                    <label>
                      {tradeSetup.isLeveraged ? "Depozyt / margin" : "Kwota inwestycji"}
                      <input
                        type="number"
                        min="0"
                        step="100"
                        value={investmentAmount}
                        onChange={(event) => handleInvestmentAmountChange(event.target.value)}
                      />
                    </label>
                    <label>
                      {tradeSetup.sizingMode === "lots" ? "Loty" : "Liczba sztuk"}
                      <input
                        type="number"
                        min="0"
                        step={tradeSetup.sizingMode === "lots" ? "0.001" : "0.01"}
                        value={positionInput}
                        placeholder={tradeDerived ? tradeDerived.positionSize.toFixed(tradeSetup.sizingMode === "lots" ? 3 : 2) : "0"}
                        onChange={(event) => handlePositionInputChange(event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="trade-setup-grid">
                    <article className="trade-card">
                      <span className="summary-label">Szacowana wielkosc pozycji</span>
                      <strong>{(tradeDerived?.positionSize ?? 0).toFixed(tradeSetup.sizingMode === "lots" ? 3 : 2)} {tradeSetup.sizingLabel}</strong>
                      <small>
                        {tradeSetup.isLeveraged
                          ? `min ${tradeSetup.minPositionSize} / max ${tradeSetup.maxPositionSize} ${tradeSetup.sizingLabel}`
                          : `na bazie kursu, FX i kontraktu ${tradeSetup.contractSize}`}
                      </small>
                    </article>
                    <article className="trade-card">
                      <span className="summary-label">{tradeSetup.isLeveraged ? "Ekspozycja nominalna" : "Wartosc pozycji"}</span>
                      <strong>{fmtAmount(tradeDerived?.nominalExposurePln ?? 0)}</strong>
                      <small>
                        {tradeSetup.isLeveraged
                          ? `1:${tradeSetup.leverage} dzwigni · 1 ${tradeSetup.sizingLabel} = ${fmtAmount(tradeDerived?.unitNotionalPln ?? 0)} nominalu`
                          : `1 ${tradeSetup.sizingLabel} = ${fmtAmount(tradeDerived?.unitNotionalPln ?? 0)}`}
                      </small>
                    </article>
                    <article className="trade-card">
                      <span className="summary-label">{tradeSetup.isLeveraged ? "Wymagany margin %" : "Pokrycie kapitalem"}</span>
                      <strong>{tradeSetup.requiredMarginPct}%</strong>
                      <small>
                        {tradeSetup.isLeveraged
                          ? `depozyt liczony przy dzwigni 1:${tradeSetup.leverage}`
                          : "brak dzwigni dla tego instrumentu"}
                      </small>
                    </article>
                    <article className="trade-card">
                      <span className="summary-label">Ryzyko do SL</span>
                      <strong className="negative">{fmtSignedAmount(-(tradeDerived?.riskPln ?? 0))}</strong>
                      <small>dla aktywnego planu {tradePlanMode === "atr" ? "ATR" : "Structure"}</small>
                    </article>
                    <article className="trade-card">
                      <span className="summary-label">Potencjal TP1</span>
                      <strong className="positive">{fmtSignedAmount(tradeDerived?.tp1ProfitPln ?? 0)}</strong>
                      <small>przy realizacji pierwszego targetu</small>
                    </article>
                    <article className="trade-card">
                      <span className="summary-label">Potencjal TP2</span>
                      <strong className="positive">{fmtSignedAmount(tradeDerived?.tp2ProfitPln ?? 0)}</strong>
                      <small>przy realizacji drugiego targetu</small>
                    </article>
                    <article className="trade-card">
                      <span className="summary-label">Swap / dzien</span>
                      <strong className={(tradeDerived?.swapPerDayPln ?? 0) <= 0 ? "negative" : "positive"}>
                        {fmtSignedAmount(tradeDerived?.swapPerDayPln ?? 0)}
                      </strong>
                      <small>
                        {tradeSetup.swapLongPerLotPerDay != null || tradeSetup.swapShortPerLotPerDay != null
                          ? `${tradeDerived?.activePlan.direction === "LONG" ? "long" : "short"} · koszt utrzymania pozycji`
                          : "brak swapu dla tego instrumentu"}
                      </small>
                    </article>
                  </div>
                  {tradeSetup.isLeveraged ? (
                    <p className="muted">
                      Dla CFD na {tradeSetup.instrumentLabel} kwota wejscia jest traktowana jako wymagany depozyt, nie pelny nominal pozycji.
                      Kalkulator liczy ekspozycje przy dzwigni 1:{tradeSetup.leverage} i wartosci 1 lota = cena × {tradeSetup.contractSize}.
                    </p>
                  ) : null}
                  {tradeDerived?.warnings.length ? (
                    <div className="trade-warnings">
                      {tradeDerived.warnings.map((warning) => (
                        <p key={warning} className="negative">{warning}</p>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="panel">
                <div className="panel-head">
                  <div>
                    <p className="kicker">Execution</p>
                    <h2>Jak to czytac teraz</h2>
                  </div>
                </div>
                <div className="stack">
                  <article className="context-item">
                    <strong>Tryb rynku</strong>
                    <p>{tradeSetup.setupType}</p>
                  </article>
                  <article className="context-item">
                    <strong>Signal + quality</strong>
                    <p>{tradeSetup.signal} · {tradeSetup.setupQuality}</p>
                  </article>
                  <article className="context-item">
                    <strong>Risk note</strong>
                    <p>{tradeSetup.riskNote}</p>
                  </article>
                  <article className="context-item">
                    <strong>Execution note</strong>
                    <p>{tradeSetup.executionNote}</p>
                  </article>
                </div>
              </div>

              <div className="panel">
                <div className="panel-head">
                  <div>
                    <p className="kicker">Reading</p>
                    <h2>Praktyczny odczyt</h2>
                  </div>
                </div>
                <div className="stack">
                  <article className="context-item">
                    <strong>Jesli chcesz grac long</strong>
                    <p>Patrz, czy cena utrzymuje sie nad {fmtQuote(tradeSetup.breakoutTrigger)} {tradeSetup.quoteCurrency} i nie oddaje ruchu od razu po wybiciu.</p>
                  </article>
                  <article className="context-item">
                    <strong>Jesli chcesz grac short</strong>
                    <p>Patrz, czy cena schodzi pod {fmtQuote(tradeSetup.breakdownTrigger)} {tradeSetup.quoteCurrency} i czy slabosc nie jest tylko chwilowym wybiciem stopow.</p>
                  </article>
                  <article className="context-item">
                    <strong>Kiedy lepiej odpuscic</strong>
                    <p>Gdy rynek siedzi w srodku strefy obserwacji i nie daje potwierdzenia. Wtedy przewaga zwykle jest za mala na dobry trade.</p>
                  </article>
                </div>
              </div>
            </div>
          </section> : null}

          {tradeSetup ? (
            <OilCandlesChart
              setup={tradeSetup}
              interval={tradeInterval}
              onIntervalChange={setTradeInterval}
              plan={tradeDerived?.activePlan ?? tradeSetup.structurePlan}
            />
          ) : null}
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

            {monthlyPerformance ? (
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <p className="kicker">Monthly</p>
                    <h2>Zmiana miesiac do miesiaca</h2>
                  </div>
                  <div className="interval-toggle">
                    {(["6M", "12M", "YTD", "ALL"] as MonthlyRange[]).map((range) => (
                      <button
                        key={range}
                        className={monthlyRange === range ? "interval-chip active" : "interval-chip"}
                        onClick={() => setMonthlyRange(range)}
                      >
                        {range}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="portfolio-charts-grid monthly-overview-grid">
                  <div className="stack monthly-markers-stack">
                    <EnhancedMonthlyMarker
                      title="Suma wszystkich kont"
                      points={filterMonthlyPoints(monthlyPerformance.total.points, monthlyRange)}
                    />
                    <EnhancedMonthlyMarker
                      title="Suma wszystkich kont"
                      points={filterMonthlyPoints(monthlyPerformance.total.points, monthlyRange)}
                      mode="adjusted"
                    />
                  </div>
                  <div className="chart-panel">
                    <div>
                      <p className="kicker">Trend</p>
                      <h3>Wartosc portfela wg miesiecy</h3>
                    </div>
                    <MonthlyValueChart points={filterMonthlyPoints(monthlyPerformance.total.points, monthlyRange)} />
                  </div>
                </div>
              </section>
            ) : null}

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
                    monthlyPoints={filterMonthlyPoints(monthlyPerformance?.accounts.find((item) => item.accountName === "XTB")?.points ?? [], monthlyRange)}
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
                        monthlyPoints={filterMonthlyPoints(monthlyPerformance?.accounts.find((item) => item.accountName === account.name)?.points ?? [], monthlyRange)}
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
                {monthlyPerformance?.accounts.find((item) => item.accountName === "Obligacje Skarbowe")?.points ? (
                  <div className="account-monthly-panel">
                    <div className="panel-head compact">
                      <div>
                        <p className="kicker">Monthly view</p>
                        <h3>Zmiana miesiac do miesiaca</h3>
                      </div>
                    </div>
                    <div className="account-monthly-grid">
                      <div className="stack monthly-markers-stack">
                        <EnhancedMonthlyMarker
                          title="Koniec miesiaca"
                          points={filterMonthlyPoints(monthlyPerformance.accounts.find((item) => item.accountName === "Obligacje Skarbowe")?.points ?? [], monthlyRange)}
                        />
                        <EnhancedMonthlyMarker
                          title="Koniec miesiaca"
                          points={filterMonthlyPoints(monthlyPerformance.accounts.find((item) => item.accountName === "Obligacje Skarbowe")?.points ?? [], monthlyRange)}
                          mode="adjusted"
                        />
                      </div>
                      <MonthlyValueChart
                        points={filterMonthlyPoints(monthlyPerformance.accounts.find((item) => item.accountName === "Obligacje Skarbowe")?.points ?? [], monthlyRange)}
                        accent="#c07a33"
                      />
                    </div>
                  </div>
                ) : null}
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
                      <FileDropzone
                        label="Plik XLSX z historii XTB"
                        accept=".xlsx,.xls"
                        file={xtbFile}
                        onFileSelect={setXtbFile}
                      />
                      <div className="row-actions">
                        <button className="primary-button" onClick={handleXtbImport} disabled={activeImportKey === "xtb"}>
                          {activeImportKey === "xtb" ? "Import trwa..." : "Importuj z XTB"}
                        </button>
                        <button className="secondary-button" onClick={handleSyncHoldings}>Przelicz pozycje</button>
                        <button className="ghost-button" onClick={handleResetXtb} disabled={activeImportKey === "xtb-reset"}>
                          {activeImportKey === "xtb-reset" ? "Czyszczenie..." : "Wyczysc XTB"}
                        </button>
                      </div>
                    </div>

                    <div className="emakler-import-card import-source-card">
                    <div>
                        <p className="kicker">Source 2</p>
                        <strong>eMakler mBank</strong>
                        <p className="muted">Import historii transakcji dla IKE i IKZE z plikow CSV.</p>
                      </div>
                      <FileDropzone
                        label="Plik CSV dla IKE"
                        accept=".csv,.txt"
                        file={emaklerIkeFile}
                        onFileSelect={setEmaklerIkeFile}
                      />
                      <button
                        className="secondary-button"
                        onClick={() => void handleEmaklerImport("IKE")}
                        disabled={activeImportKey === "emakler-ike"}
                      >
                        {activeImportKey === "emakler-ike" ? "Import IKE trwa..." : "Importuj IKE"}
                      </button>
                      <FileDropzone
                        label="Plik CSV dla IKZE"
                        accept=".csv,.txt"
                        file={emaklerIkzeFile}
                        onFileSelect={setEmaklerIkzeFile}
                      />
                      <button
                        className="secondary-button"
                        onClick={() => void handleEmaklerImport("IKZE")}
                        disabled={activeImportKey === "emakler-ikze"}
                      >
                        {activeImportKey === "emakler-ikze" ? "Import IKZE trwa..." : "Importuj IKZE"}
                      </button>
                    </div>

                    <div className="emakler-import-card import-source-card">
                      <div>
                        <p className="kicker">Source 3</p>
                        <strong>Obligacje Skarbowe</strong>
                        <p className="muted">Import stanu rachunku rejestrowego z liczba obligacji, wartoscia i data wykupu.</p>
                      </div>
                      <FileDropzone
                        label="Plik XLS lub XLSX obligacji"
                        accept=".xlsx,.xls"
                        file={treasuryBondsFile}
                        onFileSelect={setTreasuryBondsFile}
                      />
                      <button
                        className="secondary-button"
                        onClick={handleTreasuryBondsImport}
                        disabled={activeImportKey === "treasury"}
                      >
                        {activeImportKey === "treasury" ? "Import trwa..." : "Importuj obligacje"}
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
