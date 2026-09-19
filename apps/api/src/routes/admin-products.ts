import { productCreateInput, productInput } from "@attakk/types";
import { type Context, Hono } from "hono";
import {
  createProduct,
  getProductForAdmin,
  listProductsForAdmin,
  ProductError,
  updateProduct,
} from "../repositories/admin-products.js";
import { parseId } from "./params.js";

// The admin's product screens, reached over the internal network: the list of
// every product grouped by its drop with an ordered-units tally, and one product
// with its sizes and images for the edit form, plus create and edit. Like the
// other admin routes it carries no auth of its own — the session gate lives in
// the admin app, and the private network is the boundary. No SQL here; the
// repository owns it. Size editing and delete land in later commits.
export const adminProducts = new Hono();

// Turn a repository ProductError into the 4xx it maps to: a slug already in use
// is a conflict (409), a create naming a missing drop is the request's fault
// (422). Anything else is a real fault and rethrown to the 500 handler.
function productError(c: Context, err: unknown): Response {
  if (err instanceof ProductError) {
    return c.json({ error: err.code }, err.code === "slug_taken" ? 409 : 422);
  }
  throw err;
}

adminProducts.get("/admin/products", (c) => c.json(listProductsForAdmin()));

// Create a product into a drop. A bad body is a 400 (with the zod issues), a
// missing drop a 422 and a slug already taken a 409; on success the stored
// product comes back 201 so the admin lands on its edit screen.
adminProducts.post("/admin/products", async (c) => {
  const parsed = productCreateInput.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  }
  try {
    return c.json(createProduct(parsed.data), 201);
  } catch (err) {
    return productError(c, err);
  }
});

adminProducts.get("/admin/products/:id", (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);
  const product = getProductForAdmin(id);
  if (!product) return c.json({ error: "not_found" }, 404);
  return c.json(product);
});

// Edit a product's fields (not its drop or sizes). A bad body is a 400, a missing
// product a 404 and a slug taken by another product a 409; on success the updated
// product comes back.
adminProducts.patch("/admin/products/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);
  const parsed = productInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  }
  try {
    const product = updateProduct(id, parsed.data);
    if (!product) return c.json({ error: "not_found" }, 404);
    return c.json(product);
  } catch (err) {
    return productError(c, err);
  }
});
