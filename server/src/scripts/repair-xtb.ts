import { initDb } from "../db.js";
import { renameAccount } from "../repository.js";
import { importXtbWorkbook } from "../services/xtbImporter.js";
import { syncPortfolioHoldings } from "../services/holdingsSync.js";

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: node dist-server/scripts/repair-xtb.js <xlsx-path>");
  process.exit(1);
}

initDb();
renameAccount(3, "XTB");
const imported = importXtbWorkbook(filePath, "XTB");
const synced = syncPortfolioHoldings();

console.log(JSON.stringify({ imported, synced }, null, 2));
