import { z } from "zod";
import { getAccounts, upsertTransactions } from "../repository.js";
import type { CsvImportResult, Transaction } from "../types.js";

  const csvRowSchema = z.object({
  accountName: z.string().min(1),
  symbol: z.string().min(1),
  tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(["BUY", "SELL", "CONTRIBUTION", "DIVIDEND", "INTEREST", "WITHDRAWAL", "TAX"]),
  quantity: z.coerce.number(),
  price: z.coerce.number(),
  fees: z.coerce.number().default(0),
  currency: z.string().min(1)
});

export function importTransactionsFromCsv(csvContent: string): CsvImportResult {
  const lines = csvContent.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return { imported: 0, skipped: 0, errors: ["Plik CSV jest pusty albo nie zawiera wierszy danych."] };
  }

  const header = lines[0].split(",").map((part) => part.trim());
  const requiredHeader = ["accountName", "symbol", "tradeDate", "type", "quantity", "price", "fees", "currency"];
  if (header.join("|") !== requiredHeader.join("|")) {
    return { imported: 0, skipped: 0, errors: [`Niepoprawny nagłówek CSV. Oczekiwano: ${requiredHeader.join(", ")}.`] };
  }

  const accounts = getAccounts();
  const parsedRows: Omit<Transaction, "id">[] = [];
  const errors: string[] = [];
  lines.slice(1).forEach((line, index) => {
    const values = line.split(",").map((part) => part.trim());
    const raw = Object.fromEntries(header.map((name, idx) => [name, values[idx] ?? ""]));
    const parsed = csvRowSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push(`Wiersz ${index + 2}: ${parsed.error.issues[0]?.message ?? "niepoprawne dane"}.`);
      return;
    }
    const account = accounts.find((item) => item.name === parsed.data.accountName);
    if (!account) {
      errors.push(`Wiersz ${index + 2}: konto "${parsed.data.accountName}" nie istnieje.`);
      return;
    }
    parsedRows.push({
      accountId: account.id,
      symbol: parsed.data.symbol,
      tradeDate: parsed.data.tradeDate,
      type: parsed.data.type,
      quantity: parsed.data.quantity,
      price: parsed.data.price,
      fees: parsed.data.fees,
      currency: parsed.data.currency
    });
  });

  if (errors.length > 0) {
    return { imported: 0, skipped: 0, errors };
  }

  const result = upsertTransactions(parsedRows);
  return { imported: result.imported, skipped: result.skipped, errors: [] };
}
