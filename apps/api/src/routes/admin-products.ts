import {
  productCreateInput,
  productInput,
  productSizesInput,
} from "@attakk/types";
import { type Context, Hono } from "hono";
import { ORIGINALS_DIR, UPLOADS_DIR } from "../db.js";
import { removeImageFiles } from "../images.js";
import {
  createProduct,
  deleteProduct,
  getProductForAdmin,
  listProductsForAdmin,
  ProductError,
  setProductSizes,
  updateProduct,
} from "../repositories/admin-products.js";
import { countProductImagesByHash } from "../repositories/images.js";
import { parseId } from "./params.js";

// The admin's product screens, reached over the internal network: the list of
// every product grouped by its drop with an ordered-units tally, and one product
// with its sizes and images for the edit form, plus create and edit. Like the
// other admin routes it carries no auth of its own — the session gate lives in
// the admin app, and the private network is the boundary. No SQL here; the
// repository owns it. Size editing and delete land in later commits.
export const adminProducts = new Hono();

// Turn a repository ProductError into the 4xx it maps to: a conflict with an
// existing row (a taken slug, a size still in use) is a 409; a request that names
// something that isn't there (a missing drop, a size not on the product) is a
// 422. Anything else is a real fault and rethrown to the 500 handler.
function productError(c: Context, err: unknown): Response {
  if (err instanceof ProductError) {
    switch (err.code) {
      case "slug_taken":
      case "size_in_use":
      case "has_orders":
        return c.json({ error: err.code }, 409);
      case "drop_not_found":
      case "unknown_size":
        return c.json({ error: err.code }, 422);
    }
  }
  throw err;
}

// The image directories, so a product delete can unlink the files its images left
// on disk (the rows cascade, the files do not). Same pair the image routes use.
const IMAGE_DIRS = { uploadsDir: UPLOADS_DIR, originalsDir: ORIGINALS_DIR };

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

// Replace a product's whole size set. A bad body is a 400, a missing product a
// 404; the reconcile refuses (422 unknown_size) a size not on the product and
// (409 size_in_use) removing a size an order references. On success the product
// comes back with its new sizes.
adminProducts.put("/admin/products/:id/sizes", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);
  const parsed = productSizesInput.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  }
  try {
    const product = setProductSizes(id, parsed.data.sizes);
    if (!product) return c.json({ error: "not_found" }, 404);
    return c.json(product);
  } catch (err) {
    return productError(c, err);
  }
});

// Delete a product. A missing product is a 404; a product any order references is
// a 409 has_orders (the admin hides it instead, since deleting would orphan the
// order lines that record what was bought). On success its sizes and image rows
// cascade, and the image files whose last referencing row is now gone are
// unlinked, mirroring the image-delete route's content-hash bookkeeping.
adminProducts.delete("/admin/products/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);
  let images;
  try {
    images = deleteProduct(id);
  } catch (err) {
    return productError(c, err);
  }
  if (images === undefined) return c.json({ error: "not_found" }, 404);

  for (const image of images) {
    if (countProductImagesByHash(image.hash) === 0) {
      await removeImageFiles(IMAGE_DIRS, image);
    }
  }
  return c.body(null, 204);
});
