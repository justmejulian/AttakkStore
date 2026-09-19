import { MAX_ALT_LEN } from "@attakk/types";
import { Hono } from "hono";
import { ORIGINALS_DIR, UPLOADS_DIR } from "../db.js";
import {
  ImageError,
  processImage,
  removeImageFiles,
  writeImageFiles,
} from "../images.js";
import {
  addProductImage,
  countProductImagesByHash,
  deleteProductImage,
  productExists,
} from "../repositories/images.js";
import { parseId } from "./params.js";

// The admin's image writes, reached over the internal network: attach a photo
// to a product, or remove one. Processing and SQL live in ../images and the
// repository; this layer only parses the request, maps failures to a status,
// and orders the two side effects. Like the order endpoint, it carries no auth
// yet — the service token guarding the admin's calls arrives with the admin.
export const images = new Hono();

const IMAGE_DIRS = { uploadsDir: UPLOADS_DIR, originalsDir: ORIGINALS_DIR };

// A refused upload maps to the client's fault, never a 500: too big is 413,
// everything else (undecodable bytes, a format off the allowlist) is 400.
function statusFor(code: ImageError["code"]): 413 | 400 {
  return code === "too_large" ? 413 : 400;
}

images.post("/products/:id/images", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);
  if (!productExists(id)) return c.json({ error: "not_found" }, 404);

  // parseBody throws on a body that isn't valid multipart; a malformed upload
  // is the client's fault, so it is a 400, not the 500 an escaped throw becomes.
  let body;
  try {
    body = await c.req.parseBody();
  } catch {
    return c.json({ error: "invalid_upload" }, 400);
  }
  const file = body["file"];
  if (!(file instanceof File)) return c.json({ error: "no_file" }, 400);
  const alt = typeof body["alt"] === "string" ? body["alt"] : "";
  if (alt.length > MAX_ALT_LEN) return c.json({ error: "alt_too_long" }, 400);

  let processed;
  try {
    processed = await processImage(Buffer.from(await file.arrayBuffer()));
  } catch (err) {
    if (err instanceof ImageError) {
      return c.json({ error: err.code }, statusFor(err.code));
    }
    throw err;
  }

  // Files first, then the row: a stored row always has its files on disk. A
  // failed upload can leave content-hashed files with no row, which are inert
  // and reused the next time the same bytes arrive.
  await writeImageFiles(IMAGE_DIRS, processed);
  const image = addProductImage({
    product_id: id,
    hash: processed.hash,
    ext: processed.ext,
    alt,
    placeholder: processed.placeholder,
    width: processed.width,
    height: processed.height,
  });
  return c.json(image, 201);
});

images.delete("/images/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);

  const deleted = deleteProductImage(id);
  if (!deleted) return c.json({ error: "not_found" }, 404);

  // Filenames are the content hash, so the same bytes uploaded more than once
  // share one set of files. Only unlink them once the last row referencing the
  // hash is gone, or deleting one image would break another that still shows it.
  if (countProductImagesByHash(deleted.hash) === 0) {
    await removeImageFiles(IMAGE_DIRS, deleted);
  }
  return c.body(null, 204);
});
