import assert from "node:assert/strict";
import { after, test } from "node:test";
import { openTempApi, seedCatalog } from "../test-support.js";

// Set up the connection and seed before importing the repository, since it
// prepares its statements against the singleton at import time.
const { db, cleanup } = await openTempApi();
seedCatalog(db);
// A live, size-less product in the live drop, to exercise the null-size path
// the shared catalogue fixture does not cover (its live product has sizes).
db.exec(`
  INSERT INTO products (id, drop_id, slug, name, price_rappen, status, sort)
  VALUES (14, 1, 'redline-sticker', 'Redline Sticker', 500, 'live', 2);
`);
const { OrderError, createOrder, getOrder } = await import("./orders.js");

after(() => cleanup());

// Size ids are assigned at insert; look one up rather than assume its number.
const jerseySizeM = (
  db
    .prepare(
      "SELECT id FROM product_sizes WHERE product_id = 10 AND label = 'M'",
    )
    .get() as { id: number }
).id;

function orderCount(): number {
  return (db.prepare("SELECT count(*) AS n FROM orders").get() as { n: number })
    .n;
}

test("prices every line from the database, not the request", () => {
  const order = createOrder({
    email: "buyer@example.com",
    items: [{ product_id: 10, size_id: jerseySizeM, qty: 2 }],
  });

  assert.equal(order.items.length, 1);
  const [item] = order.items;
  assert.equal(item.unit_price_rappen, 9500); // the products row, product 10
  assert.equal(item.title, "Redline Jersey"); // copied in, not referenced
  assert.equal(item.size_id, jerseySizeM);
  assert.equal(item.qty, 2);
  assert.equal(order.total_rappen, 19000);
});

test("stamps a valid RF reference and a receipt token", () => {
  const order = createOrder({
    email: "buyer@example.com",
    items: [{ product_id: 14, size_id: null, qty: 1 }],
  });
  assert.match(order.reference, /^RF\d{2}\d{6}$/);
  assert.match(order.token, /^[0-9a-f]{32}$/);
  assert.equal(order.status, "pending");
});

test("sums a multi-line total across products", () => {
  const order = createOrder({
    email: "buyer@example.com",
    items: [
      { product_id: 10, size_id: jerseySizeM, qty: 1 },
      { product_id: 14, size_id: null, qty: 3 },
    ],
  });
  assert.equal(order.total_rappen, 9500 + 500 * 3);
  assert.equal(getOrder(order.id)?.total_rappen, order.total_rappen);
});

test("refuses products that are not purchasable", () => {
  for (const productId of [11, 12, 13, 999]) {
    // 11 hidden, 12 live in an archived drop, 13 live in a draft drop, 999 gone
    assert.throws(
      () =>
        createOrder({
          email: "buyer@example.com",
          items: [{ product_id: productId, size_id: null, qty: 1 }],
        }),
      (e) => e instanceof OrderError && e.code === "product_unavailable",
    );
  }
});

test("requires a size when the product has sizes", () => {
  assert.throws(
    () =>
      createOrder({
        email: "buyer@example.com",
        items: [{ product_id: 10, size_id: null, qty: 1 }],
      }),
    (e) => e instanceof OrderError && e.code === "size_required",
  );
});

test("rejects a size that does not belong to the product", () => {
  assert.throws(
    () =>
      createOrder({
        email: "buyer@example.com",
        items: [{ product_id: 10, size_id: 99999, qty: 1 }],
      }),
    (e) => e instanceof OrderError && e.code === "size_invalid",
  );
});

test("rejects a size on a product that has none", () => {
  assert.throws(
    () =>
      createOrder({
        email: "buyer@example.com",
        items: [{ product_id: 14, size_id: jerseySizeM, qty: 1 }],
      }),
    (e) => e instanceof OrderError && e.code === "size_not_allowed",
  );
});

test("a bad line rolls the whole order back", () => {
  const before = orderCount();
  assert.throws(() =>
    createOrder({
      email: "buyer@example.com",
      items: [
        { product_id: 10, size_id: jerseySizeM, qty: 1 }, // good
        { product_id: 11, size_id: null, qty: 1 }, // hidden → refused
      ],
    }),
  );
  assert.equal(orderCount(), before, "a failed order left rows behind");
});
