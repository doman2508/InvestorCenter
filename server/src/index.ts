import fs from "node:fs";
import path from "node:path";
import express from "express";
import { createApp } from "./app.js";
import { initDb } from "./db.js";
import { seedDb } from "./seed.js";

initDb();
seedDb();

const app = createApp();
const port = Number(process.env.PORT ?? 3030);
const clientDistPath = path.resolve(process.cwd(), "dist");

if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(clientDistPath, "index.html"));
  });
}

app.listen(port, () => {
  console.log(`Investor Center API listening on http://localhost:${port}`);
});
