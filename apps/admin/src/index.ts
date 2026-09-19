import { serve } from "@hono/node-server";
import { Hono } from "hono";

// Defaults to 3001 so running the admin and the API side by side in dev with no
// PORT set neither collides on a port nor makes /health fetch itself (the API
// default below is 3000).
const PORT = Number(process.env.PORT ?? 3001);

// The admin holds no database of its own — it renders HTML and reads and writes
// through the API over the internal network. Defaults to localhost in dev;
// compose and Dokku point this at the API service on the shared network.
const API_URL = process.env.API_URL ?? "http://localhost:3000";

const app = new Hono();

// Liveness probe. Since every admin screen depends on the API, the check also
// reports whether the API is reachable over the internal network, so a broken
// link between the two shows up here rather than as a blank screen later.
app.get("/health", async (c) => {
  let api: "ok" | "unreachable" = "unreachable";
  try {
    const res = await fetch(new URL("/health", API_URL));
    if (res.ok) api = "ok";
  } catch {
    // API not up yet — reported as unreachable below, never thrown.
  }
  return c.json({ status: "ok", service: "admin", api });
});

serve({ fetch: app.fetch, port: PORT }, ({ port }) => {
  console.log(`admin listening on :${port}`);
});
