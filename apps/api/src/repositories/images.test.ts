import assert from "node:assert/strict";
import { after, test } from "node:test";
import { openTempApi, seedCatalog } from "../test-support.js";

// Prepare the connection and seed a product before importing the repository —
// it compiles its statements against the singleton at import time.
const { db, cleanup } = await openTempApi();
seedCatalog(db);
const { addProductImage, deleteProductImage, listProductImages } =
  await import("./images.js");

after(() => cleanup());

function newImage(hash: string) {
  return {
    product_id: 10,
    hash,
    ext: "jpg",
    alt: "a red jersey",
    placeholder: "data:image/webp;base64,AAAA",
    width: 1600,
    height: 1000,
  };
}

test("adds images and lists them for the product in sort order", () => {
  const first = addProductImage(newImage("aaaa1111"));
  const second = addProductImage(newImage("bbbb2222"));

  // sort is assigned server-side, appending after what is already there.
  assert.equal(first.sort, 0);
  assert.equal(second.sort, 1);
  assert.equal(first.alt, "a red jersey");
  assert.equal(first.width, 1600);

  const images = listProductImages(10);
  assert.deepEqual(
    images.map((i) => i.hash),
    ["aaaa1111", "bbbb2222"],
  );
});

test("delete returns the row's disk facts, then it is gone", () => {
  const added = addProductImage(newImage("cccc3333"));

  const deleted = deleteProductImage(added.id);
  assert.ok(deleted);
  assert.equal(deleted.hash, "cccc3333");
  assert.equal(deleted.ext, "jpg");
  assert.equal(deleted.width, 1600);

  assert.ok(!listProductImages(10).some((i) => i.id === added.id));
});

test("deleting an id that is already gone returns undefined", () => {
  assert.equal(deleteProductImage(999999), undefined);
});

test("images are cascade-deleted with their product", () => {
  db.exec(`
    INSERT INTO products (id, drop_id, slug, name, price_rappen, status, sort)
    VALUES (20, 1, 'gone-soon', 'Gone Soon', 1000, 'live', 9);
  `);
  addProductImage({ ...newImage("dddd4444"), product_id: 20 });
  assert.equal(listProductImages(20).length, 1);

  db.prepare("DELETE FROM products WHERE id = 20").run();
  assert.equal(listProductImages(20).length, 0);
});
