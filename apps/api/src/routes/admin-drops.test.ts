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

function post(path: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    adminDrops.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function patch(path: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    adminDrops.request(path, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

// A well-formed create/edit body. Callers override the slug so tests don't collide
// on the drops table's UNIQUE slug. Colours and the display font exercise the
// theming fields the write carries.
function dropBody(slug: string): Record<string, unknown> {
  return {
    slug,
    name: "Nightfall",
    year: 2026,
    no: 4,
    status: "draft",
    tagline: "After dark.",
    body: "The night collection.",
    note: "internal",
    color_primary: "#0a0a0a",
    color_secondary: "#f5f5f5",
    color_accent: "#e11d2a",
    color_text: "#ffffff",
    display_font: "Antonio",
    theme_base: "dark",
  };
}

test("POST /admin/drops creates the drop and reads it back", async () => {
  const res = await post("/admin/drops", dropBody("nightfall"));
  assert.equal(res.status, 201);
  const drop = (await res.json()) as Drop;
  assert.equal(drop.slug, "nightfall");
  assert.equal(drop.theme_base, "dark");
  assert.equal(drop.color_primary, "#0a0a0a");
  // The row is real: it reads back through the detail endpoint.
  assert.equal(
    (await adminDrops.request(`/admin/drops/${drop.id}`)).status,
    200,
  );
});

test("POST /admin/drops is 409 for a slug already in use", async () => {
  // Drop 1 (seeded) owns the redline slug.
  const res = await post("/admin/drops", dropBody("redline"));
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: "slug_taken" });
});

test("POST /admin/drops is 400 for a bad slug and a bad colour", async () => {
  assert.equal((await post("/admin/drops", dropBody("Bad Slug"))).status, 400);
  const badColour = { ...dropBody("ok-slug"), color_primary: "red" };
  assert.equal((await post("/admin/drops", badColour)).status, 400);
});

test("PATCH /admin/drops/:id edits the drop, its own slug allowed", async () => {
  // Drop 2 is the seeded archived Origins; re-save it live with its own slug.
  const res = await patch("/admin/drops/2", {
    ...dropBody("origins"),
    name: "Origins Redux",
    status: "live",
  });
  assert.equal(res.status, 200);
  const drop = (await res.json()) as Drop;
  assert.equal(drop.id, 2);
  assert.equal(drop.name, "Origins Redux");
  assert.equal(drop.status, "live");
});

test("PATCH /admin/drops/:id is 409 for another drop's slug, 404 for a missing drop", async () => {
  // Drop 3 (secret) taking drop 1's slug is a clash.
  const clash = await patch("/admin/drops/3", dropBody("redline"));
  assert.equal(clash.status, 409);
  const missing = await patch("/admin/drops/999", dropBody("whatever"));
  assert.equal(missing.status, 404);
});
