import type {
  Drop,
  DropWithProducts,
  Product,
  ProductSize,
  ProductWithDrop,
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

// The archived collections, for the shop's archive grid. A drop that has ended
// keeps its page and its pieces; this is just the same read narrowed to the
// status the live one excludes, in the same sort order.
const archivedDropsStmt = db.prepare(
  `SELECT ${DROP_COLUMNS} FROM drops WHERE status = 'archived' ORDER BY sort, id`,
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

// The drop a product read attaches to itself. Keyed by id, any status: the
// product query above already proved the drop is live or archived, so this only
// ever reads a drop that exists and is public — it is the same row, fetched by
// the foreign key the product carries.
const dropByIdStmt = db.prepare(
  `SELECT ${DROP_COLUMNS} FROM drops WHERE id = ?`,
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

export function listArchivedDrops(): DropWithProducts[] {
  return (archivedDropsStmt.all() as Drop[]).map(withProducts);
}

export function getDropBySlug(slug: string): DropWithProducts | undefined {
  const drop = dropBySlugStmt.get(slug) as Drop | undefined;
  return drop ? withProducts(drop) : undefined;
}

export function getProductBySlug(slug: string): ProductWithDrop | undefined {
  const product = productBySlugStmt.get(slug) as Product | undefined;
  if (!product) return undefined;
  // The product query filters on the drop being live or archived, so the drop
  // should always be found — the page needs it for the collection's theme and
  // whether the piece can be bought. Guard it so an FK inconsistency fails loudly
  // (the route turns a throw into a 500) rather than serving a ProductWithDrop
  // whose drop is silently missing.
  const drop = dropByIdStmt.get(product.drop_id) as Drop | undefined;
  if (!drop) {
    throw new Error(
      `product ${product.slug} references missing drop ${product.drop_id}`,
    );
  }
  return { ...withSizes(product), drop };
}
