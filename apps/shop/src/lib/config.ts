// Storefront configuration, read once from the environment. The shop holds no
// database: every catalogue read is a call to the API over the internal
// network. Because the store is server-rendered, these calls happen in the Astro
// process, never in the browser, so the API needs no public URL.

// Where the API answers. Defaults to localhost in dev; compose and Dokku point
// this at the API service on the shared internal network (http://attakk-api.web:3000).
// Read from process.env rather than import.meta.env so the running container's
// config decides it, not the value baked in at build time.
export const API_URL = process.env.API_URL ?? "http://localhost:3000";
