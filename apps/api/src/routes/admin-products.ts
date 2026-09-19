import { Hono } from "hono";
import {
  getProductForAdmin,
  listProductsForAdmin,
} from "../repositories/admin-products.js";
import { parseId } from "./params.js";

// The admin's product screens, reached over the internal network: the list of
// every product grouped by its drop with an ordered-units tally, and one product
// with its sizes and images for the edit form. Like the other admin routes it
// carries no auth of its own — the session gate lives in the admin app, and the
// private network is the boundary. No SQL here; the repository owns it. Create,
// edit and delete land in later commits.
export const adminProducts = new Hono();

adminProducts.get("/admin/products", (c) => c.json(listProductsForAdmin()));

adminProducts.get("/admin/products/:id", (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);
  const product = getProductForAdmin(id);
  if (!product) return c.json({ error: "not_found" }, 404);
  return c.json(product);
});
