import type {
  AdminProductRow,
  Product,
  ProductCreateInput,
  ProductInput,
  ProductSize,
  ProductWithSizes,
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

// Why a create or edit was refused, for the reasons the route turns into a 4xx
// the admin can act on rather than a 500: a slug already in use (products.slug is
// UNIQUE), or a create naming a drop that does not exist. Anything else (a broken
// database) stays a thrown 500.
export type ProductErrorCode = "slug_taken" | "drop_not_found";

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
