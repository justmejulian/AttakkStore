import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import type { ProductImage } from "@attakk/types";
import sharp from "sharp";
import { openTempApi, seedCatalog } from "../test-support.js";

const { db, cleanup } = await openTempApi();
seedCatalog(db);
// The router, the dirs it writes to, and the catalogue read all resolve the
// same temp DATA_DIR openTempApi set, so files land under the throwaway tree.
const { ORIGINALS_DIR, UPLOADS_DIR } = await import("../db.js");
const { images } = await import("./images.js");
const { getProductBySlug } = await import("../repositories/catalog.js");

after(() => cleanup());

function png(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 9, g: 9, b: 9 } },
  })
    .png()
    .toBuffer();
}

async function upload(
  productId: number,
  bytes: Buffer,
  { name = "photo.png", type = "image/png", alt = "" } = {},
): Promise<Response> {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], name, { type }));
  if (alt) form.set("alt", alt);
  return images.request(`/products/${productId}/images`, {
    method: "POST",
    body: form,
  });
}

function originalPath(img: ProductImage): string {
  return join(ORIGINALS_DIR, `${img.hash}.${img.ext}`);
}
function derivativePaths(img: ProductImage, widths: number[]): string[] {
  return widths.map((w) => join(UPLOADS_DIR, `${img.hash}-${w}.webp`));
}

test("POST stores the image, writes its files, and shows it on the product", async () => {
  const res = await upload(10, await png(1600, 1000), { alt: "the jersey" });
  assert.equal(res.status, 201);
  const img = (await res.json()) as ProductImage;

  assert.equal(img.alt, "the jersey");
  assert.equal(img.width, 1600);
  assert.equal(img.sort, 0);

  assert.ok(existsSync(originalPath(img)), "original on disk");
  for (const p of derivativePaths(img, [400, 800, 1200, 1600])) {
    assert.ok(existsSync(p), `derivative ${p}`);
  }

  // The catalogue read the shop makes now carries the image.
  const product = getProductBySlug("redline-jersey");
  assert.ok(product);
  assert.deepEqual(
    product.images.map((i) => i.id),
    [img.id],
  );
});

test("POST to a product that does not exist is 404", async () => {
  assert.equal((await upload(999999, await png(400, 400))).status, 404);
});

test("POST without a file is 400", async () => {
  const res = await images.request("/products/10/images", {
    method: "POST",
    body: new FormData(),
  });
  assert.equal(res.status, 400);
});

test("POST of a format off the allowlist is 400", async () => {
  const gif = await sharp(await png(50, 50))
    .gif()
    .toBuffer();
  const res = await upload(10, gif, { name: "x.gif", type: "image/gif" });
  assert.equal(res.status, 400);
  assert.equal(
    ((await res.json()) as { error: string }).error,
    "unsupported_format",
  );
});

test("POST past the size cap is 413", async () => {
  const huge = Buffer.alloc(10 * 1024 * 1024 + 1);
  const res = await upload(10, huge);
  assert.equal(res.status, 413);
});

test("POST with a body that isn't valid multipart is 400, not 500", async () => {
  const res = await images.request("/products/10/images", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=----zzz" },
    body: "not actually multipart",
  });
  assert.equal(res.status, 400);
});

test("POST with an over-length alt is 400", async () => {
  const res = await upload(10, await png(400, 400), { alt: "x".repeat(501) });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, "alt_too_long");
});

test("DELETE removes the row and its files", async () => {
  const img = (await (
    await upload(12, await png(800, 600))
  ).json()) as ProductImage;
  assert.ok(existsSync(originalPath(img)));

  const res = await images.request(`/images/${img.id}`, { method: "DELETE" });
  assert.equal(res.status, 204);

  assert.ok(!existsSync(originalPath(img)), "original gone");
  for (const p of derivativePaths(img, [400, 800])) {
    assert.ok(!existsSync(p), `derivative gone ${p}`);
  }
});

test("DELETE of an unknown id is 404", async () => {
  assert.equal(
    (await images.request("/images/999999", { method: "DELETE" })).status,
    404,
  );
});

test("shared files survive until the last row referencing them is deleted", async () => {
  // Identical bytes uploaded twice yield two rows over one set of hashed files.
  const bytes = await png(1200, 800);
  const a = (await (await upload(13, bytes)).json()) as ProductImage;
  const b = (await (await upload(13, bytes)).json()) as ProductImage;
  assert.equal(a.hash, b.hash);
  assert.ok(existsSync(originalPath(a)));

  // Deleting the first must not pull the files out from under the second.
  await images.request(`/images/${a.id}`, { method: "DELETE" });
  assert.ok(
    existsSync(originalPath(a)),
    "files kept while a row still uses them",
  );

  // Deleting the last one finally frees them.
  await images.request(`/images/${b.id}`, { method: "DELETE" });
  assert.ok(!existsSync(originalPath(b)), "files freed with the last row");
});
