import { readFile, writeFile } from "node:fs/promises";

const templatePath = new URL("../wrangler.json", import.meta.url);
const outputPath = new URL("../.wrangler.deploy.json", import.meta.url);
const config = JSON.parse(await readFile(templatePath, "utf8"));
const database = config.d1_databases.find(({ binding }) => binding === "DB");
const id = process.env.RUA_D1_DATABASE_ID?.trim() || database.database_id;
const databaseId = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

if (!id || !databaseId.test(id)) {
  throw new Error("Set RUA_D1_DATABASE_ID to the ID of the existing Cloudflare D1 database before deploying.");
}

database.database_id = id;
await writeFile(outputPath, JSON.stringify(config, null, 2) + "\n");
