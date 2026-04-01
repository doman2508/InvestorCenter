import { initDb } from "../db.js";
import { seedDb } from "../seed.js";
import { importXtbWorkbook } from "../services/xtbImporter.js";

const filePath = process.argv[2];
const accountName = process.argv[3] ?? "XTB";

if (!filePath) {
  console.error("Usage: tsx server/src/scripts/import-xtb.ts <xlsx-path> [account-name]");
  process.exit(1);
}

initDb();
seedDb();

const result = importXtbWorkbook(filePath, accountName);

if (result.errors.length > 0) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(result, null, 2));
