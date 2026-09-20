import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Drop } from "@attakk/types";
import { openTempApi, seedCatalog } from "../test-support.js";

const { db, cleanup } = await openTempApi();
seedCatalog(db);
const { adminDrops } = await import("./admin-drops.js");

after(() => cleanup());

test("GET /admin/drops lists every drop, draft and archived included", async () => {
  const res = await adminDrops.request("/admin/drops");
  assert.equal(res.status, 200);
  const drops = (await res.json()) as Drop[];
  // seedCatalog has a live (1), an archived (2) and a draft (3) drop, ordered by
  // sort; the catalogue would hide the draft, the admin sees all three.
  assert.deepEqual(
    drops.map((d) => d.id),
    [1, 2, 3],
  );
  assert.ok(drops.some((d) => d.status === "draft"));
});

test("GET /admin/drops/:id returns one drop, any status", async () => {
  // Drop 3 is a draft the catalogue would hide; the admin edits it, so the detail
  // read serves it.
  const res = await adminDrops.request("/admin/drops/3");
  assert.equal(res.status, 200);
  const drop = (await res.json()) as Drop;
  assert.equal(drop.id, 3);
  assert.equal(drop.status, "draft");
});

test("GET /admin/drops/:id is 404 for an unknown or bad id", async () => {
  const missing = await adminDrops.request("/admin/drops/999");
  assert.equal(missing.status, 404);
  const bad = await adminDrops.request("/admin/drops/abc");
  assert.equal(bad.status, 404);
});
