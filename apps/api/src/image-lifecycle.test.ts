import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { derivativeWidths } from "@attakk/types";
import { openTempApi, seedCatalog } from "./test-support.js";

// Open the connection and seed products before importing anything that reaches
// it — the repository compiles its statements against the singleton at import.
const { db, cleanup } = await openTempApi();
seedCatalog(db);
const { IMAGE_DIRS, releaseImages } = await import("./image-lifecycle.js");
const { addProductImage, deleteProductImage } =
  await import("./repositories/images.js");

after(() => cleanup());

const WIDTH = 1600;

// Stand in for a processed upload: the derivative set writeImageFiles would
// have written for this hash, plus the original beside it.
function writeFilesFor(hash: string) {
  writeFileSync(join(IMAGE_DIRS.originalsDir, `${hash}.jpg`), "original");
  for (const w of derivativeWidths(WIDTH)) {
    writeFileSync(join(IMAGE_DIRS.uploadsDir, `${hash}-${w}.webp`), "webp");
  }
}

function filesExist(hash: string): boolean {
  return (
    existsSync(join(IMAGE_DIRS.originalsDir, `${hash}.jpg`)) &&
    derivativeWidths(WIDTH).every((w) =>
      existsSync(join(IMAGE_DIRS.uploadsDir, `${hash}-${w}.webp`)),
    )
  );
}

function addImage(productId: number, hash: string) {
  writeFilesFor(hash);
  return addProductImage({
    product_id: productId,
    hash,
    ext: "jpg",
    alt: "",
    placeholder: "",
    width: WIDTH,
    height: 1000,
  });
}

test("the files of a deleted row are given up once no row references the hash", async () => {
  const image = addImage(10, "1111aaaa11110000");
  deleteProductImage(image.id);

  await releaseImages([image]);
  assert.equal(filesExist(image.hash), false);
});

test("files shared by another row survive until the last row is gone", async () => {
  // The same bytes attached to two products: one hash, one file set, two rows.
  const hash = "2222bbbb22220000";
  const first = addImage(10, hash);
  const second = addImage(12, hash);

  deleteProductImage(first.id);
  await releaseImages([first]);
  assert.equal(
    filesExist(hash),
    true,
    "the second row still shows these files",
  );

  deleteProductImage(second.id);
  await releaseImages([second]);
  assert.equal(filesExist(hash), false);
});

test("a whole cascaded set is released together, sharing included", async () => {
  // What a product delete hands over: rows already gone, two of them sharing a
  // hash with each other and one sharing with a row on another product.
  const shared = "3333cccc33330000";
  const own = "4444dddd44440000";
  const kept = "5555eeee55550000";

  const a = addImage(10, own);
  const b = addImage(10, shared);
  const c = addImage(10, shared);
  const d = addImage(10, kept);
  const elsewhere = addImage(12, kept);

  for (const image of [a, b, c, d]) deleteProductImage(image.id);
  await releaseImages([a, b, c, d]);

  assert.equal(filesExist(own), false);
  assert.equal(filesExist(shared), false, "both rows on this product are gone");
  assert.equal(filesExist(kept), true, "another product still shows these");

  deleteProductImage(elsewhere.id);
  await releaseImages([elsewhere]);
  assert.equal(filesExist(kept), false);
});

test("releasing nothing, or the same row twice, is a no-op rather than a throw", async () => {
  const image = addImage(10, "6666ffff66660000");
  deleteProductImage(image.id);

  await releaseImages([]);
  await releaseImages([image]);
  await releaseImages([image]);
  assert.equal(filesExist(image.hash), false);
});
