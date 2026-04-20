import fs from "node:fs";
import path from "node:path";
import { getAccounts, replaceTransactionsForAccount, upsertInstrumentMapping } from "../repository.js";
import type { BrokerImportResult, Transaction } from "../types.js";

function isHeaderRow(line: string) {
  const normalized = line.trim();
  return normalized.startsWith("Czas transakcji;Papier;") && normalized.includes(";K/S;Liczba;Kurs;Waluta;Prowizja;");
}

function normalizeNumber(value: string) {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeTradeDate(value: string) {
  const match = value.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) {
    return null;
  }
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function normalizeInstrumentSymbol(instrument: string) {
  const firstToken = instrument.trim().split(/\s+/)[0] ?? "";
  return firstToken.toUpperCase();
}

function mapExchangeToTicker(symbol: string, exchange: string) {
  const normalizedExchange = exchange.trim().toUpperCase();
  if (normalizedExchange === "DEU-XETRA") {
    return `${symbol}.DE`;
  }
  if (normalizedExchange === "GBR-LSE") {
    return `${symbol}.L`;
  }
  if (normalizedExchange === "POL-GPW") {
    return `${symbol}.WA`;
  }
  return symbol;
}

function aggregateTransactions(rows: Omit<Transaction, "id">[]) {
  const grouped = new Map<string, Omit<Transaction, "id">>();

  for (const row of rows) {
    const key = [
      row.accountId,
      row.symbol,
      row.tradeDate,
      row.type,
      row.price,
      row.currency,
      row.settlementCurrency ?? ""
    ].join("|");

    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...row });
      continue;
    }

    existing.quantity += row.quantity;
    existing.fees += row.fees;
    existing.settlementValue = (existing.settlementValue ?? 0) + (row.settlementValue ?? 0);
  }

  return Array.from(grouped.values());
}

export function importEmaklerHistory(filePath: string, accountName: string): BrokerImportResult {
  if (!fs.existsSync(filePath)) {
    return {
      imported: 0,
      skipped: 0,
      errors: [`File does not exist: ${filePath}`],
      notes: []
    };
  }

  if (path.extname(filePath).toLowerCase() !== ".csv") {
    return {
      imported: 0,
      skipped: 0,
      errors: ["Only .csv files are supported for eMakler import."],
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

  const content = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const lines = content.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => isHeaderRow(line));

  if (headerIndex < 0) {
    return {
      imported: 0,
      skipped: 0,
      errors: ["Could not find the expected eMakler transaction header."],
      notes: []
    };
  }

  const rows = lines
    .slice(headerIndex + 1)
    .map((line) => line.trim())
    .filter(Boolean);

  const parsedRows: Omit<Transaction, "id">[] = [];
  const errors: string[] = [];
  let mappedTickers = 0;

  rows.forEach((line, index) => {
    const columns = line.split(";").map((item) => item.trim());
    if (columns.length < 11) {
      errors.push(`Row ${index + 1}: expected 11 columns, got ${columns.length}.`);
      return;
    }

    const [timestamp, instrument, exchange, side, quantityRaw, priceRaw, instrumentCurrency, feeRaw, , settlementRaw, settlementCurrencyRaw] = columns;
    const tradeDate = normalizeTradeDate(timestamp);
    const symbol = normalizeInstrumentSymbol(instrument);

    if (!tradeDate || !symbol) {
      errors.push(`Row ${index + 1}: could not parse trade date or symbol.`);
      return;
    }

    const type = side === "K" ? "BUY" : side === "S" ? "SELL" : null;
    if (!type) {
      errors.push(`Row ${index + 1}: unsupported side "${side}".`);
      return;
    }

    const quantity = normalizeNumber(quantityRaw);
    const price = normalizeNumber(priceRaw);
    const fees = normalizeNumber(feeRaw);
    const settlementValue = normalizeNumber(settlementRaw);
    const settlementCurrency = settlementCurrencyRaw.toUpperCase();

    parsedRows.push({
      accountId: account.id,
      symbol,
      tradeDate,
      type,
      quantity,
      price,
      fees,
      currency: instrumentCurrency.toUpperCase(),
      settlementValue,
      settlementCurrency
    });

    upsertInstrumentMapping({
      accountId: account.id,
      sourceSymbol: symbol,
      marketTicker: mapExchangeToTicker(symbol, exchange),
      label: instrument
    });
    mappedTickers += 1;
  });

  if (errors.length > 0) {
    return {
      imported: 0,
      skipped: 0,
      errors,
      notes: []
    };
  }

  const aggregatedRows = aggregateTransactions(parsedRows);
  const replaced = replaceTransactionsForAccount(account.id, aggregatedRows);
  return {
    imported: replaced.length,
    skipped: 0,
    errors: [],
    notes: [
      `Parsed ${parsedRows.length} eMakler transactions for ${accountName}.`,
      `Collapsed to ${aggregatedRows.length} unique trade rows before dedupe.`,
      `Updated ${mappedTickers} instrument mappings from exchange hints.`,
      `Replaced existing ${accountName} transaction history with the latest CSV import.`
    ]
  };
}
