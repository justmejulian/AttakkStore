import type { ProductImage } from "@attakk/types";
import { ORIGINALS_DIR, UPLOADS_DIR } from "./db.js";
import { removeImageFiles } from "./images.js";
import { countProductImagesByHash } from "./repositories/images.js";

// Where the bookkeeping between the image rows and the files on disk lives.
// ./images knows how to write and unlink a file set but is deliberately kept
// away from the connection, and the repository owns the SQL but must not touch
// the filesystem; the rule that joins them belongs to neither, and used to be
// written out in both routes that delete an image.
export const IMAGE_DIRS = {
  uploadsDir: UPLOADS_DIR,
  originalsDir: ORIGINALS_DIR,
};

// Give up the files behind image rows that are already gone from the database.
// Filenames are the content hash, so the same bytes uploaded twice share one
// set of files on disk: unlink them only once the last row referencing the hash
// has been deleted, or removing one image would blank another that still shows
// it. Sequential on purpose — a product's images are few, and two rows of one
// product can share a hash, where a parallel sweep would race on the same count.
//
// Call it after the rows are gone: an image route deletes one row and passes
// it, a product delete cascades its rows and passes the set it snapshotted.
// Missing files are ignored downstream, so a repeat is a no-op rather than a
// throw.
export async function releaseImages(images: ProductImage[]): Promise<void> {
  for (const image of images) {
    if (countProductImagesByHash(image.hash) === 0) {
      await removeImageFiles(IMAGE_DIRS, image);
    }
  }
}
