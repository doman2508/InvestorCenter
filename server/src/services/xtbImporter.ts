import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import { getAccounts, replaceTransactionsForAccount, upsertInstrumentMapping } from "../repository.js";
import type { BrokerImportResult, Transaction } from "../types.js";

type RawSheetRow = Record<string, string | number | null | undefined>;

const FX_CURRENCY_HINTS: Array<{ currency: string; approxRate: number }> = [
  { currency: "PLN", approxRate: 1 },
  { currency: "USD", approxRate: 3.7 },
  { currency: "EUR", approxRate: 4.3 },
  { currency: "GBP", approxRate: 5 }
];

function normalizeDate(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) {
      return null;
    }
    const month = String(parsed.m).padStart(2, "0");
    const day = String(parsed.d).padStart(2, "0");
    return `${parsed.y}-${month}-${day}`;
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function normalizeNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/\s/g, "").replace(",", ".");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function readSheet(workbook: XLSX.WorkBook, name: string, headerRowIndex: number): RawSheetRow[] {
  const sheet = workbook.Sheets[name];
  if (!sheet) {
    return [];
  }
  return XLSX.utils.sheet_to_json<RawSheetRow>(sheet, {
    range: headerRowIndex,
    defval: null,
    raw: false
  });
}

function slugifyInstrument(input: string) {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "UNKNOWN";
}

function buildInstrumentTickerMap(rows: RawSheetRow[]) {
  const map = new Map<string, string>();
  for (const row of rows) {
    const instrument = String(row["Instrument"] ?? "").trim();
    const ticker = String(row["Ticker"] ?? "").trim();
    if (instrument && ticker && !map.has(instrument)) {
      map.set(instrument, ticker);
    }
  }
  return map;
}

function parseTradeComment(comment: string) {
  const normalized = comment.trim();
  const match = normalized.match(/^(OPEN|CLOSE)\s+(BUY|SELL)\s+([\d.]+)(?:\/[\d.]+)?\s+@\s+([\d.]+)/i);
  if (!match) {
    return null;
  }
  return {
    phase: match[1].toUpperCase(),
    side: match[2].toUpperCase(),
    quantity: Number(match[3]),
    unitPrice: Number(match[4])
  };
}

function extractCurrencyFromComment(comment: string) {
  const explicit = comment.match(/\b(PLN|USD|EUR|GBP)\b/i);
  return explicit ? explicit[1].toUpperCase() : null;
}

function inferCurrencyFromAmount(amount: number, quantity: number, unitPrice: number) {
  if (quantity <= 0 || unitPrice <= 0) {
    return "PLN";
  }
  const impliedRate = Math.abs(amount) / (quantity * unitPrice);
  const closest = FX_CURRENCY_HINTS.reduce((best, candidate) => {
    const bestDistance = Math.abs(impliedRate - best.approxRate);
    const candidateDistance = Math.abs(impliedRate - candidate.approxRate);
    return candidateDistance < bestDistance ? candidate : best;
  });
  return closest.currency;
}

function buildCashTransactions(rows: RawSheetRow[], accountId: number, instrumentTickerMap: Map<string, string>) {
  const transactions: Omit<Transaction, "id">[] = [];
  const notes: string[] = [];
  let skipped = 0;

  for (const row of rows) {
    const type = String(row["Type"] ?? "").trim();
    const instrument = String(row["Instrument"] ?? "").trim();
    const comment = String(row["Comment"] ?? "").trim();
    const tradeDate = normalizeDate(row["Time"]);
    const amount = normalizeNumber(row["Amount"]);

    if (!type || !tradeDate) {
      continue;
    }

    const resolvedSymbol = instrumentTickerMap.get(instrument) ?? slugifyInstrument(instrument || type);

    if (type === "Stock purchase" || type === "Stock sell") {
      const parsedTrade = parseTradeComment(comment);
      if (!parsedTrade) {
        skipped += 1;
        continue;
      }

      const inferredType =
        parsedTrade.phase === "OPEN"
          ? parsedTrade.side
          : parsedTrade.side === "BUY"
            ? "SELL"
            : "BUY";
      const inferredCurrency = extractCurrencyFromComment(comment) ?? inferCurrencyFromAmount(amount, parsedTrade.quantity, parsedTrade.unitPrice);

      transactions.push({
        accountId,
        symbol: resolvedSymbol,
        tradeDate,
        type: inferredType as Transaction["type"],
        quantity: parsedTrade.quantity,
        price: parsedTrade.unitPrice,
        fees: 0,
        currency: inferredCurrency
      });
      continue;
    }

    if (type === "Deposit") {
      transactions.push({
        accountId,
        symbol: "CASH-DEPOSIT",
        tradeDate,
        type: "CONTRIBUTION",
        quantity: 1,
        price: amount,
        fees: 0,
        currency: "PLN"
      });
      continue;
    }

    if (type === "Withdrawal") {
      transactions.push({
        accountId,
        symbol: "CASH-WITHDRAWAL",
        tradeDate,
        type: "WITHDRAWAL",
        quantity: 1,
        price: Math.abs(amount),
        fees: 0,
        currency: "PLN"
      });
      continue;
    }

    if (type === "Dividend") {
      transactions.push({
        accountId,
        symbol: resolvedSymbol || "DIVIDEND",
        tradeDate,
        type: "DIVIDEND",
        quantity: 1,
        price: amount,
        fees: 0,
        currency: extractCurrencyFromComment(comment) ?? "PLN"
      });
      continue;
    }

    if (type === "Withholding tax" || type === "Free funds interest tax") {
      transactions.push({
        accountId,
        symbol: resolvedSymbol || "TAX",
        tradeDate,
        type: "TAX",
        quantity: 1,
        price: Math.abs(amount),
        fees: 0,
        currency: extractCurrencyFromComment(comment) ?? "PLN"
      });
      continue;
    }

    if (type === "Free funds interest") {
      transactions.push({
        accountId,
        symbol: "FREE-FUNDS-INTEREST",
        tradeDate,
        type: "INTEREST",
        quantity: 1,
        price: amount,
        fees: 0,
        currency: "PLN"
      });
      continue;
    }

    if (type === "Close trade" || type === "Profit/loss" || type === "Swap" || type === "Rollover") {
      skipped += 1;
      continue;
    }

    skipped += 1;
  }

  notes.push(`Mapped ${transactions.length} cash-operation rows and skipped ${skipped} unsupported cash events.`);
  return { transactions, notes };
}

function deriveMappingsFromComments(rows: RawSheetRow[], accountId: number) {
  let discovered = 0;
  for (const row of rows) {
    const instrument = String(row["Instrument"] ?? "").trim();
    const comment = String(row["Comment"] ?? "").trim();
    if (!instrument || !comment) {
      continue;
    }
    const tickerMatch = comment.match(/([A-Z0-9.-]+\.(?:US|UK|PL))/);
    if (!tickerMatch) {
      continue;
    }
    upsertInstrumentMapping({
      accountId,
      sourceSymbol: slugifyInstrument(instrument),
      marketTicker: tickerMatch[1],
      label: instrument
    });
    discovered += 1;
  }
  return discovered;
}

export function importXtbWorkbook(filePath: string, accountName = "XTB"): BrokerImportResult {
  if (!fs.existsSync(filePath)) {
    return {
      imported: 0,
      skipped: 0,
      errors: [`File does not exist: ${filePath}`],
      notes: []
    };
  }

  if (path.extname(filePath).toLowerCase() !== ".xlsx") {
    return {
      imported: 0,
      skipped: 0,
      errors: ["Only .xlsx files are supported for this importer."],
      notes: []
    };
  }

  const account = getAccounts().find((item) => item.name === accountName);
  if (!account) {
    return {
      imported: 0,
      skipped: 0,
      errors: [`Account "${accountName}" does not exist.`],
      notes: []
    };
  }

  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const closedRows = readSheet(workbook, "Closed Positions", 4);
  const cashRows = readSheet(workbook, "Cash Operations", 4);
  const instrumentTickerMap = buildInstrumentTickerMap(closedRows);

  const cash = buildCashTransactions(cashRows, account.id, instrumentTickerMap);
  const allRows = [...cash.transactions];
  const replaced = replaceTransactionsForAccount(account.id, allRows);
  const discoveredMappings = deriveMappingsFromComments(cashRows, account.id);

  return {
    imported: replaced.length,
    skipped: 0,
    errors: [],
    notes: [
      `Built instrument-to-ticker map for ${instrumentTickerMap.size} instruments from Closed Positions.`,
      ...cash.notes,
      `Discovered ${discoveredMappings} mapping hints from cash-operation comments.`,
      "Replaced existing transactions for this account with the workbook import."
    ]
  };
}
