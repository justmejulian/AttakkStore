import { Hono } from "hono";
import {
  getDropBySlug,
  getProductBySlug,
  listLiveDrops,
} from "../repositories/catalog.js";

// Public read routes for the storefront: the live collections for the home
// page, one drop (live or archived) by slug, and one product by slug. No SQL
// here — the repository owns it. Writes arrive in the order and admin steps.
export const catalog = new Hono();

catalog.get("/drops", (c) => c.json(listLiveDrops()));

catalog.get("/drops/:slug", (c) => {
  const drop = getDropBySlug(c.req.param("slug"));
  if (!drop) return c.json({ error: "not_found" }, 404);
  return c.json(drop);
});

catalog.get("/products/:slug", (c) => {
  const product = getProductBySlug(c.req.param("slug"));
  if (!product) return c.json({ error: "not_found" }, 404);
  return c.json(product);
});
