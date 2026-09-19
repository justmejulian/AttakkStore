import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  type AdminProductRow,
  derivativeWidths,
  type ProductWithSizes,
} from "@attakk/types";
import { openTempApi, seedCatalog } from "../test-support.js";

const { db, cleanup } = await openTempApi();
seedCatalog(db);
seedOrders();
// db.js is already imported by openTempApi (which set DATA_DIR first), so this
// resolves to the same module and its upload directories under the temp DATA_DIR.
const { ORIGINALS_DIR, UPLOADS_DIR } = await import("../db.js");
const { adminProducts } = await import("./admin-products.js");

after(() => cleanup());

// seedCatalog gives us four products across three drops (live, archived, draft),
// with product 10 carrying sizes. These two orders exercise ordered_count: a
// pending order for two jerseys (product 10) and a cancelled one for another
// jersey. The tally must count the pending units and ignore the cancelled ones,
// so product 10 lands on 2, not 3.
function seedOrders(): void {
  const size = (
    db
      .prepare(
        "SELECT id FROM product_sizes WHERE product_id = 10 AND label = 'M'",
      )
      .get() as { id: number }
  ).id;
  const insertOrder = db.prepare(
    `INSERT INTO orders (id, reference, token, email, total_rappen, status)
     VALUES (@id, @reference, @token, @email, @total_rappen, @status)`,
  );
  const insertItem = db.prepare(
    `INSERT INTO order_items (order_id, product_id, size_id, qty, unit_price_rappen, title)
     VALUES (@order_id, @product_id, @size_id, @qty, @unit_price_rappen, @title)`,
  );
  db.transaction(() => {
    insertOrder.run({
      id: 1,
      reference: "RF74000001",
      token: "a".repeat(32),
      email: "pending@example.com",
      total_rappen: 19000,
      status: "pending",
    });
    insertItem.run({
      order_id: 1,
      product_id: 10,
      size_id: size,
      qty: 2,
      unit_price_rappen: 9500,
      title: "Redline Jersey",
    });
    insertOrder.run({
      id: 2,
      reference: "RF74000002",
      token: "b".repeat(32),
      email: "cancelled@example.com",
      total_rappen: 9500,
      status: "cancelled",
    });
    insertItem.run({
      order_id: 2,
      product_id: 10,
      size_id: size,
      qty: 1,
      unit_price_rappen: 9500,
      title: "Redline Jersey",
    });
  })();
}

test("GET /admin/products lists every product, draft and hidden included", async () => {
  const res = await adminProducts.request("/admin/products");
  assert.equal(res.status, 200);
  const rows = (await res.json()) as AdminProductRow[];
  // All four seeded products, in drop-then-product sort order. The catalogue
  // would hide the hidden product (11) and the draft drop's product (13); the
  // admin sees them.
  assert.deepEqual(
    rows.map((p) => p.id),
    [10, 11, 12, 13],
  );
});

test("GET /admin/products carries the drop and an ordered-units tally", async () => {
  const rows = (await (
    await adminProducts.request("/admin/products")
  ).json()) as AdminProductRow[];
  const jersey = rows.find((p) => p.id === 10);
  assert.equal(jersey?.drop_name, "Redline");
  assert.equal(jersey?.drop_status, "live");
  // Two pending units; the cancelled order's unit does not count.
  assert.equal(jersey?.ordered_count, 2);
  // A product with no orders tallies zero, not null.
  assert.equal(rows.find((p) => p.id === 12)?.ordered_count, 0);
});

test("GET /admin/products/:id returns the product with its sizes and images", async () => {
  const res = await adminProducts.request("/admin/products/10");
  assert.equal(res.status, 200);
  const product = (await res.json()) as ProductWithSizes;
  assert.equal(product.id, 10);
  // Sizes come back in sort order (S, M, L), not insertion order.
  assert.deepEqual(
    product.sizes.map((s) => s.label),
    ["S", "M", "L"],
  );
  assert.ok(Array.isArray(product.images));
});

test("GET /admin/products/:id is 404 for a missing or non-numeric id", async () => {
  assert.equal(
    (await adminProducts.request("/admin/products/999")).status,
    404,
  );
  assert.equal(
    (await adminProducts.request("/admin/products/abc")).status,
    404,
  );
});

// A well-formed create body into the seeded live drop (1). Callers override the
// slug so tests don't collide on the products table's UNIQUE slug.
function createBody(slug: string): Record<string, unknown> {
  return {
    drop_id: 1,
    slug,
    name: "New Piece",
    price_rappen: 4200,
    min_orders: 5,
    status: "draft",
  };
}

test("POST /admin/products creates the product and returns it with empty sizes", async () => {
  const res = await post("/admin/products", createBody("new-piece"));
  assert.equal(res.status, 201);
  const product = (await res.json()) as ProductWithSizes & { drop_id: number };
  assert.equal(product.drop_id, 1);
  assert.equal(product.slug, "new-piece");
  assert.equal(product.price_rappen, 4200);
  assert.deepEqual(product.sizes, []);
  assert.deepEqual(product.images, []);
  // The row is real: it reads back through the detail endpoint.
  assert.equal(
    (await adminProducts.request(`/admin/products/${product.id}`)).status,
    200,
  );
});

test("POST /admin/products is 409 for a slug already in use", async () => {
  // Product 10 (seeded) owns redline-jersey.
  const res = await post("/admin/products", createBody("redline-jersey"));
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: "slug_taken" });
});

test("POST /admin/products is 422 when the drop does not exist", async () => {
  const res = await post("/admin/products", {
    ...createBody("orphan-piece"),
    drop_id: 999,
  });
  assert.equal(res.status, 422);
  assert.deepEqual(await res.json(), { error: "drop_not_found" });
});

test("POST /admin/products is 400 for a malformed body", async () => {
  // An uppercase slug breaks SLUG_PATTERN; a zero min_orders breaks the positive
  // check. Either is a 400 before any row is touched.
  assert.equal(
    (await post("/admin/products", createBody("Not A Slug"))).status,
    400,
  );
  assert.equal(
    (
      await post("/admin/products", {
        ...createBody("zero-target"),
        min_orders: 0,
      })
    ).status,
    400,
  );
});

test("PATCH /admin/products/:id edits the fields and returns the product", async () => {
  const res = await patch("/admin/products/12", {
    slug: "origins-tee",
    name: "Origins Tee (reissue)",
    price_rappen: 7000,
    min_orders: 3,
    status: "live",
  });
  assert.equal(res.status, 200);
  const product = (await res.json()) as ProductWithSizes;
  assert.equal(product.name, "Origins Tee (reissue)");
  assert.equal(product.price_rappen, 7000);
  // Re-saving with its own unchanged slug is not a clash.
  assert.equal(product.slug, "origins-tee");
});

test("PATCH /admin/products/:id is 409 for another product's slug, 404 when missing", async () => {
  // Product 12 trying to take product 10's slug.
  const clash = await patch("/admin/products/12", {
    slug: "redline-jersey",
    name: "x",
    price_rappen: 1,
    min_orders: 1,
    status: "draft",
  });
  assert.equal(clash.status, 409);
  assert.deepEqual(await clash.json(), { error: "slug_taken" });

  const missing = await patch("/admin/products/999", {
    slug: "ghost",
    name: "x",
    price_rappen: 1,
    min_orders: 1,
    status: "draft",
  });
  assert.equal(missing.status, 404);
});

test("PATCH /admin/products/:id is 400 for a malformed body", async () => {
  assert.equal(
    (await patch("/admin/products/12", { slug: "ok", name: "" })).status,
    400,
  );
});

test("PUT sizes reconciles insert, rename, reorder, delete and clear", async () => {
  // Product 13 (draft drop) has no sizes and no orders, so it is safe to churn.
  const added = await put("/admin/products/13/sizes", {
    sizes: [
      { label: "S", sort: 0 },
      { label: "M", sort: 1 },
    ],
  });
  assert.equal(added.status, 200);
  let sizes = ((await added.json()) as ProductWithSizes).sizes;
  assert.deepEqual(
    sizes.map((s) => s.label),
    ["S", "M"],
  );
  const kept = sizes.find((s) => s.label === "S");
  assert.ok(kept);

  // Keep S by id (renamed + reordered), drop M, add L.
  const reconciled = await put("/admin/products/13/sizes", {
    sizes: [
      { id: kept.id, label: "S2", sort: 1 },
      { label: "L", sort: 0 },
    ],
  });
  assert.equal(reconciled.status, 200);
  sizes = ((await reconciled.json()) as ProductWithSizes).sizes;
  // Ordered by sort: L (0) then S2 (1); M is gone; S kept its id across the rename.
  assert.deepEqual(
    sizes.map((s) => s.label),
    ["L", "S2"],
  );
  assert.equal(sizes.find((s) => s.label === "S2")?.id, kept.id);

  // The empty set clears every (order-free) size.
  const cleared = await put("/admin/products/13/sizes", { sizes: [] });
  assert.equal(cleared.status, 200);
  assert.deepEqual(((await cleared.json()) as ProductWithSizes).sizes, []);
});

test("PUT sizes handles a label swap without a unique-constraint error", async () => {
  // Seed a known two-size state, then swap the two labels between the same rows —
  // the case a naive update trips on UNIQUE(product_id, label) mid-write.
  const seed = await put("/admin/products/13/sizes", {
    sizes: [
      { label: "A", sort: 0 },
      { label: "B", sort: 1 },
    ],
  });
  const seeded = ((await seed.json()) as ProductWithSizes).sizes;
  const a = seeded.find((s) => s.label === "A");
  const b = seeded.find((s) => s.label === "B");
  assert.ok(a);
  assert.ok(b);

  const res = await put("/admin/products/13/sizes", {
    sizes: [
      { id: a.id, label: "B", sort: 0 },
      { id: b.id, label: "A", sort: 1 },
    ],
  });
  assert.equal(res.status, 200);
  assert.deepEqual(
    ((await res.json()) as ProductWithSizes).sizes.map((s) => s.label),
    ["B", "A"],
  );
});

test("PUT sizes refuses to drop an ordered size (409) or name an unknown one (422)", async () => {
  const current = (
    (await (
      await adminProducts.request("/admin/products/10")
    ).json()) as ProductWithSizes
  ).sizes.map((s) => ({ id: s.id, label: s.label, sort: s.sort }));

  // Product 10's M is referenced by the seeded orders, so dropping it is a 409.
  const dropM = await put("/admin/products/10/sizes", {
    sizes: current.filter((s) => s.label !== "M"),
  });
  assert.equal(dropM.status, 409);
  assert.deepEqual(await dropM.json(), { error: "size_in_use" });

  // An id that isn't one of product 10's sizes is a 422.
  const unknown = await put("/admin/products/10/sizes", {
    sizes: [...current, { id: 99999, label: "XXL", sort: 9 }],
  });
  assert.equal(unknown.status, 422);
  assert.deepEqual(await unknown.json(), { error: "unknown_size" });
});

test("PUT sizes is 400 for duplicate labels and 404 for a missing product", async () => {
  const dup = await put("/admin/products/13/sizes", {
    sizes: [{ label: "S" }, { label: "S" }],
  });
  assert.equal(dup.status, 400);
  assert.equal(
    (await put("/admin/products/999/sizes", { sizes: [] })).status,
    404,
  );
});

test("DELETE refuses a product an order references (409) and 404s a missing one", async () => {
  // Product 10 is referenced by the seeded orders, so it can't be deleted.
  const res = await del("/admin/products/10");
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: "has_orders" });
  // Still there — the refusal changed nothing.
  assert.equal((await adminProducts.request("/admin/products/10")).status, 200);
  assert.equal((await del("/admin/products/999")).status, 404);
  assert.equal((await del("/admin/products/abc")).status, 404);
});

test("DELETE removes a product, cascades its sizes and images, and unlinks files", async () => {
  // A fresh order-free product with a size and an image row whose files are on
  // disk, so the delete exercises both cascades and the file cleanup.
  const created = await post("/admin/products", createBody("to-delete"));
  const { id } = (await created.json()) as { id: number };
  await put(`/admin/products/${id}/sizes`, { sizes: [{ label: "S" }] });

  const hash = "deadbeefdeadbeef";
  const width = 800;
  db.prepare(
    `INSERT INTO product_images
       (product_id, hash, ext, alt, placeholder, width, height, sort)
     VALUES (?, ?, 'webp', '', '', ?, 1000, 0)`,
  ).run(id, hash, width);
  const files = [
    join(ORIGINALS_DIR, `${hash}.webp`),
    ...derivativeWidths(width).map((w) =>
      join(UPLOADS_DIR, `${hash}-${w}.webp`),
    ),
  ];
  for (const f of files) writeFileSync(f, "x");

  const res = await del(`/admin/products/${id}`);
  assert.equal(res.status, 204);
  assert.equal(
    (await adminProducts.request(`/admin/products/${id}`)).status,
    404,
  );
  const count = (table: string): number =>
    (
      db
        .prepare(`SELECT count(*) AS n FROM ${table} WHERE product_id = ?`)
        .get(id) as { n: number }
    ).n;
  assert.equal(count("product_sizes"), 0);
  assert.equal(count("product_images"), 0);
  assert.ok(files.every((f) => !existsSync(f)));
});

function del(path: string): Promise<Response> {
  return Promise.resolve(adminProducts.request(path, { method: "DELETE" }));
}

function put(path: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    adminProducts.request(path, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function post(path: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    adminProducts.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function patch(path: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    adminProducts.request(path, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
