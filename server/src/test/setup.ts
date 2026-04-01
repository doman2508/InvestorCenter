import fs from "node:fs";
import path from "node:path";

process.env.INVESTOR_CENTER_DB_PATH = path.resolve(process.cwd(), "data", "investor-center.test.json");

const dbPath = process.env.INVESTOR_CENTER_DB_PATH;

if (fs.existsSync(dbPath)) {
  fs.rmSync(dbPath, { force: true });
}
