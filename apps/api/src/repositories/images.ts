import type { ProductImage } from "@attakk/types";
import { db } from "../db.js";

// The product-image rows. All SQL lives here; the route processes the upload,
// writes the files and calls these to record or forget the derived facts. Only
// what the shop needs to render is stored — the hash, dimensions and blurred
// placeholder — never the derivative widths, which the shop recomputes from the
// width via the shared derivativeWidths.

const IMAGE_COLUMNS = `id, hash, ext, alt, placeholder, width, height, sort`;

const listForProductStmt = db.prepare(
  `SELECT ${IMAGE_COLUMNS} FROM product_images
   WHERE product_id = ? ORDER BY sort, id`,
);

// New images sort after the ones already there, so an upload lands at the end
// of the gallery rather than jumping to the front. COALESCE covers the first
// image, where there is no existing MAX.
const insertStmt = db.prepare(
  `INSERT INTO product_images (product_id, hash, ext, alt, placeholder, width, height, sort)
   VALUES (
     @product_id, @hash, @ext, @alt, @placeholder, @width, @height,
     (SELECT COALESCE(MAX(sort), -1) + 1 FROM product_images WHERE product_id = @product_id)
   )
   RETURNING ${IMAGE_COLUMNS}`,
);

const deleteStmt = db.prepare(
  `DELETE FROM product_images WHERE id = ? RETURNING ${IMAGE_COLUMNS}`,
);

// Uploads attach to any product, not only the live ones the catalogue exposes,
// so this is a plain existence check rather than a catalogue read — the admin
// adds photos to a draft product before it goes live.
const productExistsStmt = db.prepare(`SELECT 1 FROM products WHERE id = ?`);

// How many rows still point at a content hash. Filenames are the hash, so the
// same bytes uploaded twice share one set of files on disk; the delete route
// checks this after removing a row and only unlinks the files when nothing else
// references them, so deleting one image never breaks another.
const countByHashStmt = db.prepare(
  `SELECT count(*) AS n FROM product_images WHERE hash = ?`,
);

export function listProductImages(productId: number): ProductImage[] {
  return listForProductStmt.all(productId) as ProductImage[];
}

export interface NewProductImage {
  product_id: number;
  hash: string;
  ext: string;
  alt: string;
  placeholder: string;
  width: number;
  height: number;
}

export function addProductImage(image: NewProductImage): ProductImage {
  return insertStmt.get(image) as ProductImage;
}

// Returns the deleted row — its hash, ext and width are what the caller needs
// to unlink the files off disk — or undefined if the id was already gone.
export function deleteProductImage(id: number): ProductImage | undefined {
  return deleteStmt.get(id) as ProductImage | undefined;
}

export function productExists(id: number): boolean {
  return productExistsStmt.get(id) !== undefined;
}

export function countProductImagesByHash(hash: string): number {
  return (countByHashStmt.get(hash) as { n: number }).n;
}
