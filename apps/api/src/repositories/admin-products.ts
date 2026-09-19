import type {
  AdminProductRow,
  Product,
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
