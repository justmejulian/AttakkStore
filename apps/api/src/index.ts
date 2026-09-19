import { mkdirSync } from "node:fs";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import Database from "better-sqlite3";

const PORT = Number(process.env.PORT ?? 3000);

// The API owns the data volume: the SQLite file lives here and the uploads it
// serves the shop read-only sit under it. Ensure the tree exists before the
// database or a read-only mount expects it. Defaults to a local ./data in dev;
// compose and Dokku point DATA_DIR at the mounted volume.
const DATA_DIR = process.env.DATA_DIR ?? "./data";
mkdirSync(`${DATA_DIR}/uploads`, { recursive: true });

const app = new Hono();

// Liveness probe. Opening an in-memory database exercises the better-sqlite3
// native binding, so a broken build shows up here rather than on the first
// query. The API is internal-only, so this is the one route reachable now.
app.get("/health", (c) => {
  const db = new Database(":memory:");
  const row = db.prepare("select sqlite_version() as version").get() as {
    version: string;
  };
  db.close();
  return c.json({ status: "ok", service: "api", sqlite: row.version });
});

serve({ fetch: app.fetch, port: PORT }, ({ port }) => {
  console.log(`api listening on :${port}`);
});
