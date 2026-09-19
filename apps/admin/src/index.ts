import { serve } from "@hono/node-server";
import { app } from "./app.js";

// Defaults to 3001 so running the admin and the API side by side in dev with no
// PORT set neither collides on a port nor makes /health fetch itself (the API
// default is 3000).
const PORT = Number(process.env.PORT ?? 3001);

serve({ fetch: app.fetch, port: PORT }, ({ port }) => {
  console.log(`admin listening on :${port}`);
});
