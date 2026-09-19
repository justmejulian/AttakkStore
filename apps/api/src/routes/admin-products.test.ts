import assert from "node:assert/strict";
import type { AdminProductRow, ProductWithSizes } from "@attakk/types";
import { after, test } from "node:test";
import { openTempApi, seedCatalog } from "../test-support.js";

const { db, cleanup } = await openTempApi();
seedCatalog(db);
seedOrders();
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
