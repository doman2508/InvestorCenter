import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import { ensureAccount, replaceHoldingsForAccount } from "../repository.js";
import type { BrokerImportResult, Holding } from "../types.js";

type RawBondRow = Record<string, string | number | null | undefined>;

function normalizeNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/\s/g, "").replace(/,/g, "");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeDate(value: unknown): string | null {
  if (!value) {
    return null;
  }
  const raw = String(value).trim();
  if (!raw) {
    return null;
  }
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }
  return null;
}

export function importTreasuryBondsWorkbook(filePath: string): BrokerImportResult {
  if (!fs.existsSync(filePath)) {
    return {
      imported: 0,
      skipped: 0,
      errors: [`File does not exist: ${filePath}`],
      notes: []
    };
  }

  const extension = path.extname(filePath).toLowerCase();
  if (extension !== ".xls" && extension !== ".xlsx") {
    return {
      imported: 0,
      skipped: 0,
      errors: ["Only .xls and .xlsx files are supported for Treasury Bonds import."],
      notes: []
    };
  }

  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const firstSheetName = workbook.SheetNames[0];
  const firstSheet = workbook.Sheets[firstSheetName];

  if (!firstSheet) {
    return {
      imported: 0,
      skipped: 0,
      errors: ["Workbook does not contain a readable sheet."],
      notes: []
    };
  }

  const rows = XLSX.utils.sheet_to_json<RawBondRow>(firstSheet, {
    defval: null,
    raw: false
  });

  if (rows.length === 0) {
    return {
      imported: 0,
      skipped: 0,
      errors: ["Treasury Bonds workbook is empty."],
      notes: []
    };
  }

  const account = ensureAccount({
    name: "Obligacje Skarbowe",
    type: "SAVINGS",
    baseCurrency: "PLN",
    targetAllocationPct: 0
  });

  const holdings: Omit<Holding, "id">[] = [];
  let skipped = 0;

  rows.forEach((row) => {
    const symbol = String(row["EMISJA"] ?? "").trim().toUpperCase();
    const quantity = normalizeNumber(row["DOSTĘPNA LICZBA OBLIGACJI"]);
    const nominalValue = normalizeNumber(row["WARTOŚĆ NOMINALNA"]);
    const currentValue = normalizeNumber(row["WARTOŚĆ AKTUALNA"]);
    const maturityDate = normalizeDate(row["DATA WYKUPU"]);

    if (!symbol || quantity <= 0 || nominalValue <= 0 || currentValue <= 0) {
      skipped += 1;
      return;
    }

    holdings.push({
      accountId: account.id,
      symbol,
      name: `Obligacje ${symbol}`,
      assetClass: "BOND",
      quantity,
      averageCost: nominalValue / quantity,
      currentPrice: currentValue / quantity,
      currency: "PLN",
      costBasisPln: nominalValue,
      impliedFxRateToPln: 1,
      targetAllocationPct: 0,
      maturityDate
    });
  });

  replaceHoldingsForAccount(account.id, holdings);

  return {
    imported: holdings.length,
    skipped,
    errors: [],
    notes: [
      `Imported ${holdings.length} Treasury Bond positions into Obligacje Skarbowe.`,
      "Current value and maturity date were taken directly from the statement."
    ]
  };
}
