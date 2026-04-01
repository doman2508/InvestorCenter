import { createApp } from "./app.js";
import { initDb } from "./db.js";
import { seedDb } from "./seed.js";

initDb();
seedDb();

const app = createApp();
const port = Number(process.env.PORT ?? 3030);

app.listen(port, () => {
  console.log(`Investor Center API listening on http://localhost:${port}`);
});
