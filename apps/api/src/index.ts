import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { db } from "./db.js";
import { migrate } from "./migrate.js";

const PORT = Number(process.env.PORT ?? 3000);

// Bring the schema up to date before serving. On a fresh volume this creates
// every table; on one already migrated it is a no-op.
migrate(db);

const app = new Hono();

// Liveness probe. Reading sqlite_version exercises the better-sqlite3 native
// binding, and user_version confirms the schema is applied, so a broken build
// or an unmigrated volume shows up here rather than on the first query. The API
// is internal-only, so this is the one route reachable now.
app.get("/health", (c) => {
  const { version } = db
    .prepare("select sqlite_version() as version")
    .get() as { version: string };
  const schema = db.pragma("user_version", { simple: true }) as number;
  return c.json({ status: "ok", service: "api", sqlite: version, schema });
});

serve({ fetch: app.fetch, port: PORT }, ({ port }) => {
  console.log(`api listening on :${port}`);
});
