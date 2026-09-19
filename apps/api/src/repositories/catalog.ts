import type {
  Drop,
  DropWithProducts,
  Product,
  ProductSize,
  ProductWithSizes,
} from "@attakk/types";
import { db } from "../db.js";
import { listProductImages } from "./images.js";

// The catalogue reads the shop makes. All SQL lives here — route handlers call
// these and serve the typed result straight back. Only public rows ever leave:
// draft drops and non-live products are filtered out at the query, so nothing
// unpublished can reach the shop by asking for it directly.

// Explicit column lists rather than SELECT * so the response shape is a
// deliberate contract, not whatever columns the table happens to have.
const DROP_COLUMNS = `
  id, slug, name, year, no, status, sort, tagline, body, note,
  color_primary, color_secondary, color_accent, color_text,
  display_font, theme_base
`;
const PRODUCT_COLUMNS = `
  id, drop_id, slug, name, description, price_rappen, fit, fit_url,
  min_orders, status, sort
`;

// Prepared once at import: opening the connection in ./db migrates the schema,
// so the tables these compile against already exist.
const liveDropsStmt = db.prepare(
  `SELECT ${DROP_COLUMNS} FROM drops WHERE status = 'live' ORDER BY sort, id`,
);

// Live or archived, never draft: an archived drop keeps its URL and returns
// 200 with its pieces, so both the drop page and the archive page read from
// here. Purchasability is the drop's status, which the shop decides.
const dropBySlugStmt = db.prepare(
  `SELECT ${DROP_COLUMNS} FROM drops
   WHERE slug = ? AND status IN ('live', 'archived')`,
);

const liveProductsForDropStmt = db.prepare(
  `SELECT ${PRODUCT_COLUMNS} FROM products
   WHERE drop_id = ? AND status = 'live' ORDER BY sort, id`,
);

const productBySlugStmt = db.prepare(
  `SELECT ${PRODUCT_COLUMNS} FROM products p
   WHERE p.slug = ? AND p.status = 'live'
     AND EXISTS (
       SELECT 1 FROM drops d
       WHERE d.id = p.drop_id AND d.status IN ('live', 'archived')
     )`,
);

const sizesForProductStmt = db.prepare(
  `SELECT id, label, sort FROM product_sizes
   WHERE product_id = ? ORDER BY sort, id`,
);

function withSizes(product: Product): ProductWithSizes {
  const sizes = sizesForProductStmt.all(product.id) as ProductSize[];
  const images = listProductImages(product.id);
  return { ...product, sizes, images };
}

function withProducts(drop: Drop): DropWithProducts {
  const products = (liveProductsForDropStmt.all(drop.id) as Product[]).map(
    withSizes,
  );
  return { ...drop, products };
}

export function listLiveDrops(): DropWithProducts[] {
  return (liveDropsStmt.all() as Drop[]).map(withProducts);
}

export function getDropBySlug(slug: string): DropWithProducts | undefined {
  const drop = dropBySlugStmt.get(slug) as Drop | undefined;
  return drop ? withProducts(drop) : undefined;
}

export function getProductBySlug(slug: string): ProductWithSizes | undefined {
  const product = productBySlugStmt.get(slug) as Product | undefined;
  return product ? withSizes(product) : undefined;
}
