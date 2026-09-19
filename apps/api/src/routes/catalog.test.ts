import assert from "node:assert/strict";
import { after, test } from "node:test";
import { openTempApi, seedCatalog } from "../test-support.js";

const { db, cleanup } = await openTempApi();
seedCatalog(db);
const { catalog } = await import("./catalog.js");

after(() => cleanup());

// Thin coverage of the HTTP layer: that a hit serves JSON and a miss maps to
// 404. The visibility rules themselves are the repository's tests, not
// re-asserted here.
test("GET /drops serves 200 and the live collections as JSON", async () => {
  const res = await catalog.request("/drops");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { slug: string }[];
  assert.deepEqual(
    body.map((d) => d.slug),
    ["redline"],
  );
});

test("GET /drops/:slug is 200 for an archived drop and 404 for a draft one", async () => {
  assert.equal((await catalog.request("/drops/origins")).status, 200);
  assert.equal((await catalog.request("/drops/secret")).status, 404);
});

test("GET /products/:slug maps a missing product to 404", async () => {
  assert.equal((await catalog.request("/products/redline-jersey")).status, 200);
  assert.equal((await catalog.request("/products/nope")).status, 404);
});
