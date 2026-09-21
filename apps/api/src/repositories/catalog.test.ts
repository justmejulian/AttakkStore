import assert from "node:assert/strict";
import { after, test } from "node:test";
import { openTempApi, seedCatalog } from "../test-support.js";

// Set up the connection and seed before importing the repository, since the
// repository prepares its statements against the singleton at import time.
const { db, cleanup } = await openTempApi();
seedCatalog(db);
const { getDropBySlug, getProductBySlug, listArchivedDrops, listLiveDrops } =
  await import("./catalog.js");

after(() => cleanup());

test("listLiveDrops returns only live drops", () => {
  assert.deepEqual(
    listLiveDrops().map((d) => d.slug),
    ["redline"],
  );
});

test("listLiveDrops excludes non-live products", () => {
  const [redline] = listLiveDrops();
  assert.deepEqual(
    redline.products.map((p) => p.slug),
    ["redline-jersey"],
  );
});

test("sizes come back ordered by sort, not insertion order", () => {
  const [redline] = listLiveDrops();
  assert.deepEqual(
    redline.products[0].sizes.map((s) => s.label),
    ["S", "M", "L"],
  );
});

test("listArchivedDrops returns only archived drops", () => {
  assert.deepEqual(
    listArchivedDrops().map((d) => d.slug),
    ["origins"],
  );
});

test("getDropBySlug returns live and archived drops, never draft or missing", () => {
  assert.equal(getDropBySlug("redline")?.status, "live");
  assert.equal(getDropBySlug("origins")?.status, "archived");
  assert.equal(getDropBySlug("secret"), undefined);
  assert.equal(getDropBySlug("nope"), undefined);
});

test("getProductBySlug respects both product and drop visibility", () => {
  assert.equal(getProductBySlug("redline-jersey")?.slug, "redline-jersey"); // live in a live drop
  assert.equal(getProductBySlug("origins-tee")?.slug, "origins-tee"); // live in an archived drop
  assert.equal(getProductBySlug("redline-hidden"), undefined); // hidden product
  assert.equal(getProductBySlug("secret-prod"), undefined); // live product in a draft drop
  assert.equal(getProductBySlug("nope"), undefined); // missing
});

test("getProductBySlug carries the drop the product belongs to", () => {
  // The page themes and decides purchasability from the embedded drop, so it must
  // be the product's own — a live one for the jersey, the archived one for the
  // tee, which is how the page knows the piece cannot be bought.
  const jersey = getProductBySlug("redline-jersey");
  assert.equal(jersey?.drop.slug, "redline");
  assert.equal(jersey?.drop.status, "live");

  const tee = getProductBySlug("origins-tee");
  assert.equal(tee?.drop.slug, "origins");
  assert.equal(tee?.drop.status, "archived");
});
