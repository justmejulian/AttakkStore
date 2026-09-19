import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import sharp from "sharp";
import {
  ImageError,
  processImage,
  removeImageFiles,
  writeImageFiles,
} from "./images.js";

// Synthetic fixtures rather than committed photos: a flat-colour raster is all
// the pipeline needs to exercise decode, resize and re-encode.
function png(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 30, b: 60 },
    },
  })
    .png()
    .toBuffer();
}

test("derives webp renditions only down from the source, never up", async () => {
  const img = await processImage(await png(1600, 1000));

  assert.equal(img.ext, "png");
  assert.equal(img.width, 1600);
  assert.equal(img.height, 1000);
  assert.deepEqual(
    img.derivatives.map((d) => d.width),
    [400, 800, 1200, 1600],
  );
  assert.match(img.placeholder, /^data:image\/webp;base64,/);

  // Each derivative is a real webp at the width it claims.
  for (const d of img.derivatives) {
    const meta = await sharp(d.webp).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.width, d.width);
  }
});

test("a source narrower than the smallest width still gets one rendition", async () => {
  const img = await processImage(await png(300, 300));
  assert.deepEqual(
    img.derivatives.map((d) => d.width),
    [300],
  );
});

test("hashes the content, so the same bytes reuse the same stem", async () => {
  const bytes = await png(800, 600);
  const a = await processImage(bytes);
  const b = await processImage(bytes);
  assert.equal(a.hash, b.hash);

  const other = await processImage(await png(801, 600));
  assert.notEqual(a.hash, other.hash);
});

test("applies EXIF orientation, reporting upright dimensions", async () => {
  // Orientation 6 is a quarter turn: an 800×400 landscape is really 400×800.
  const rotated = await sharp({
    create: {
      width: 800,
      height: 400,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();

  const img = await processImage(rotated);
  assert.equal(img.ext, "jpg");
  assert.equal(img.width, 400);
  assert.equal(img.height, 800);
});

test("accepts AVIF, which sharp decodes as heif, storing it as avif", async () => {
  // sharp reports metadata.format === "heif" for both AVIF and HEIC; only the
  // AV1-compressed one is AVIF, and that is what the shop accepts.
  const avif = await sharp(await png(800, 600))
    .avif()
    .toBuffer();
  const img = await processImage(avif);
  assert.equal(img.ext, "avif");
  assert.equal(img.width, 800);
});

test("does not upscale the placeholder past a tiny source", async () => {
  const img = await processImage(await png(10, 10));
  const base64 = img.placeholder.replace(/^data:image\/webp;base64,/, "");
  const meta = await sharp(Buffer.from(base64, "base64")).metadata();
  assert.equal(meta.width, 10);
});

test("rejects a file that does not decode as an image", async () => {
  await assert.rejects(
    () => processImage(Buffer.from("this is not an image")),
    (err) => err instanceof ImageError && err.code === "unreadable",
  );
});

test("rejects a decodable image in a format not on the allowlist", async () => {
  const gif = await sharp(await png(50, 50))
    .gif()
    .toBuffer();
  await assert.rejects(
    () => processImage(gif),
    (err) => err instanceof ImageError && err.code === "unsupported_format",
  );
});

test("rejects an upload past the size cap before decoding", async () => {
  await assert.rejects(
    () => processImage(Buffer.alloc(10 * 1024 * 1024 + 1)),
    (err) => err instanceof ImageError && err.code === "too_large",
  );
});

test("writes the original and every derivative, then removes them all", async () => {
  const root = mkdtempSync(join(tmpdir(), "attakk-images-test-"));
  after(() => rmSync(root, { recursive: true, force: true }));
  const dirs = {
    uploadsDir: join(root, "uploads"),
    originalsDir: join(root, "originals"),
  };
  mkdirSync(dirs.uploadsDir);
  mkdirSync(dirs.originalsDir);

  const img = await processImage(await png(1200, 800));
  await writeImageFiles(dirs, img);

  const original = join(dirs.originalsDir, `${img.hash}.${img.ext}`);
  const derivatives = img.derivatives.map((d) =>
    join(dirs.uploadsDir, `${img.hash}-${d.width}.webp`),
  );
  assert.ok(existsSync(original), "original written outside the served dir");
  for (const p of derivatives) assert.ok(existsSync(p), `derivative ${p}`);

  await removeImageFiles(dirs, img);
  assert.ok(!existsSync(original), "original removed");
  for (const p of derivatives)
    assert.ok(!existsSync(p), `derivative gone ${p}`);

  // A repeated delete is a no-op, not a throw.
  await removeImageFiles(dirs, img);
});
