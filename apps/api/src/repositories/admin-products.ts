import type {
  AdminProductRow,
  Product,
  ProductCreateInput,
  ProductImage,
  ProductInput,
  ProductSize,
  ProductWithSizes,
  SizeInput,
} from "@attakk/types";
import { db } from "../db.js";
import { listProductImages } from "./images.js";

// The admin's product reads. Where the storefront catalogue only ever returns
// live rows, the admin edits drafts and hidden pieces too, so nothing here is
// filtered by status. All SQL lives in this module. Like the other admin-facing
// routes these carry no auth of their own — the session gate lives in the admin
// app and the private network is the boundary. Create, edit and delete land in
// later commits.

// p-prefixed because the list joins drops, and both tables carry an `id`.
const PRODUCT_COLUMNS = `
  p.id, p.drop_id, p.slug, p.name, p.description, p.price_rappen, p.fit,
  p.fit_url, p.min_orders, p.status, p.sort
`;

// Every product across every drop, ordered the way the drops and their products
// sort, each carrying its drop and a tally of units ordered. The admin groups the
// flat list by drop_id, so this needs no separate drops read (that arrives with
// the drops step). ordered_count sums the quantities on non-cancelled orders — a
// cancelled order is not a piece to produce, so it is left out of the tally the
// list compares against min_orders.
const listProductsStmt = db.prepare(
  `SELECT ${PRODUCT_COLUMNS},
          d.name AS drop_name, d.status AS drop_status,
          COALESCE((
            SELECT SUM(oi.qty) FROM order_items oi
              JOIN orders o ON o.id = oi.order_id
             WHERE oi.product_id = p.id AND o.status <> 'cancelled'
          ), 0) AS ordered_count
     FROM products p JOIN drops d ON d.id = p.drop_id
    ORDER BY d.sort, d.id, p.sort, p.id`,
);

export function listProductsForAdmin(): AdminProductRow[] {
  return listProductsStmt.all() as AdminProductRow[];
}

// One product with its sizes and images for the edit screen — any status, since
// the admin edits drafts and hidden pieces the catalogue would hide.
const productByIdStmt = db.prepare(
  `SELECT id, drop_id, slug, name, description, price_rappen, fit, fit_url,
          min_orders, status, sort
     FROM products WHERE id = ?`,
);
const sizesForProductStmt = db.prepare(
  `SELECT id, label, sort FROM product_sizes
    WHERE product_id = ? ORDER BY sort, id`,
);

export function getProductForAdmin(id: number): ProductWithSizes | undefined {
  const product = productByIdStmt.get(id) as Product | undefined;
  if (!product) return undefined;
  const sizes = sizesForProductStmt.all(id) as ProductSize[];
  const images = listProductImages(id);
  return { ...product, sizes, images };
}

// -------------------------------------------------------------- admin writes

// Why a create, edit, size change or delete was refused, for the reasons the
// route turns into a 4xx the admin can act on rather than a 500: a slug already
// in use (products.slug is UNIQUE), a create naming a drop that does not exist, a
// size edit referencing a size that is not on the product, an attempt to remove a
// size an order still references, or a delete of a product an order references
// (which must be hidden instead). Anything else (a broken database) stays a
// thrown 500.
export type ProductErrorCode =
  | "slug_taken"
  | "drop_not_found"
  | "unknown_size"
  | "size_in_use"
  | "has_orders";

export class ProductError extends Error {
  constructor(readonly code: ProductErrorCode) {
    super(code);
    this.name = "ProductError";
  }
}

const dropExistsStmt = db.prepare(`SELECT 1 FROM drops WHERE id = ?`);

function dropExists(id: number): boolean {
  return dropExistsStmt.get(id) !== undefined;
}

// The slug is the only UNIQUE column on products, so a unique-constraint failure
// on an insert or update is always a slug clash — mapped to slug_taken rather
// than surfaced as a 500. Catching the constraint (instead of a pre-check SELECT)
// avoids a check-then-insert race and keeps the DB the single arbiter.
function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

const insertProductStmt = db.prepare(
  `INSERT INTO products
     (drop_id, slug, name, description, price_rappen, fit, fit_url,
      min_orders, status, sort)
   VALUES
     (@drop_id, @slug, @name, @description, @price_rappen, @fit, @fit_url,
      @min_orders, @status, @sort)`,
);

// Create a product into an existing drop. The drop is checked first so a bad
// drop_id is a clean drop_not_found rather than a foreign-key 500, and a slug
// already taken is a slug_taken. Returns the stored product (with its empty sizes
// and images) so the admin lands straight on its edit screen.
export function createProduct(input: ProductCreateInput): ProductWithSizes {
  if (!dropExists(input.drop_id)) throw new ProductError("drop_not_found");
  let id: number;
  try {
    id = Number(insertProductStmt.run(input).lastInsertRowid);
  } catch (err) {
    if (isUniqueViolation(err)) throw new ProductError("slug_taken");
    throw err;
  }
  const product = getProductForAdmin(id);
  if (!product) throw new Error(`product ${id} missing right after insert`);
  return product;
}

const updateProductStmt = db.prepare(
  `UPDATE products SET
     slug = @slug, name = @name, description = @description,
     price_rappen = @price_rappen, fit = @fit, fit_url = @fit_url,
     min_orders = @min_orders, status = @status, sort = @sort
   WHERE id = @id`,
);

// Update a product's editable fields (not its drop or its sizes — sizes are their
// own endpoint). Returns undefined when no such product exists, so the route
// 404s; a slug taken by another product is a slug_taken. Re-saving a product with
// its own unchanged slug is fine — the UPDATE matches the same row, not a clash.
export function updateProduct(
  id: number,
  input: ProductInput,
): ProductWithSizes | undefined {
  if (productByIdStmt.get(id) === undefined) return undefined;
  try {
    updateProductStmt.run({ ...input, id });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ProductError("slug_taken");
    throw err;
  }
  return getProductForAdmin(id);
}

// The size ids of a product that at least one order line references. Deleting one
// would orphan an order_item (the FK is the (size_id, product_id) pair), so these
// cannot be removed regardless of the order's status — a cancelled order still
// records which size was ordered. DISTINCT because a size can appear on many.
const sizesWithOrdersStmt = db.prepare(
  `SELECT DISTINCT size_id FROM order_items
    WHERE product_id = ? AND size_id IS NOT NULL`,
);

const deleteSizeStmt = db.prepare(
  `DELETE FROM product_sizes WHERE id = ? AND product_id = ?`,
);
const renameSizeStmt = db.prepare(
  `UPDATE product_sizes SET label = @label WHERE id = @id AND product_id = @product_id`,
);
const updateSizeStmt = db.prepare(
  `UPDATE product_sizes SET label = @label, sort = @sort
    WHERE id = @id AND product_id = @product_id`,
);
const insertSizeStmt = db.prepare(
  `INSERT INTO product_sizes (product_id, label, sort)
   VALUES (@product_id, @label, @sort)`,
);

// A transient label no real size can collide with. zod trims every submitted
// label, so a stored label never carries a leading space, while every temp does;
// the id keeps temps unique among themselves. (A NUL sentinel would read neater
// but SQLite truncates bound text at the first NUL, collapsing every temp to "".)
const tempLabel = (id: number): string => ` ${String(id)}`;

// Reconcile a product's sizes to the desired list, in one transaction so a
// refusal leaves the rows untouched. Returns undefined when no such product
// exists (the route 404s). A desired size carrying an id must be a current size
// of this product (else unknown_size); a current size dropped from the list is
// deleted, unless an order references it (size_in_use). Kept sizes are renamed to
// a transient NUL label first, so a label swap or reorder can't trip the
// UNIQUE(product_id, label) index mid-update; then final labels are set and new
// sizes inserted. All SQL is here; the route only maps the errors.
export const setProductSizes = db.transaction(
  (productId: number, desired: SizeInput[]): ProductWithSizes | undefined => {
    if (productByIdStmt.get(productId) === undefined) return undefined;

    const current = sizesForProductStmt.all(productId) as ProductSize[];
    const currentIds = new Set(current.map((s) => s.id));
    for (const s of desired) {
      if (s.id !== undefined && !currentIds.has(s.id)) {
        throw new ProductError("unknown_size");
      }
    }

    const keptIds = new Set(
      desired.flatMap((s) => (s.id === undefined ? [] : [s.id])),
    );
    const withOrders = new Set(
      (sizesWithOrdersStmt.all(productId) as { size_id: number }[]).map(
        (r) => r.size_id,
      ),
    );
    const removed = current.filter((s) => !keptIds.has(s.id));
    for (const s of removed) {
      if (withOrders.has(s.id)) throw new ProductError("size_in_use");
    }

    for (const s of removed) deleteSizeStmt.run(s.id, productId);
    for (const s of desired) {
      if (s.id !== undefined) {
        renameSizeStmt.run({
          id: s.id,
          product_id: productId,
          label: tempLabel(s.id),
        });
      }
    }
    for (const s of desired) {
      if (s.id !== undefined) {
        updateSizeStmt.run({
          id: s.id,
          product_id: productId,
          label: s.label,
          sort: s.sort,
        });
      } else {
        insertSizeStmt.run({
          product_id: productId,
          label: s.label,
          sort: s.sort,
        });
      }
    }

    return getProductForAdmin(productId);
  },
);

const productHasOrdersStmt = db.prepare(
  `SELECT 1 FROM order_items WHERE product_id = ? LIMIT 1`,
);
const deleteProductByIdStmt = db.prepare(`DELETE FROM products WHERE id = ?`);

// Delete a product, returning the image rows it had so the route can unlink their
// files (the product_sizes and product_images rows cascade, but the files on disk
// do not). Returns undefined when no such product exists (the route 404s). A
// product any order references is kept — deleting it would orphan the order_items
// that record what someone paid for — so it is a has_orders refusal the admin
// resolves by hiding the product instead. Wrapped in a transaction so the
// orders check and the delete are one step. Images are captured before the delete
// since the rows are gone after it.
export const deleteProduct = db.transaction(
  (id: number): ProductImage[] | undefined => {
    if (productByIdStmt.get(id) === undefined) return undefined;
    if (productHasOrdersStmt.get(id) !== undefined) {
      throw new ProductError("has_orders");
    }
    const images = listProductImages(id);
    deleteProductByIdStmt.run(id);
    return images;
  },
);
