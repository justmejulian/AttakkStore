import assert from "node:assert/strict";
import { after, test } from "node:test";
import { openTempApi, seedCatalog } from "../test-support.js";

const { db, cleanup } = await openTempApi();
seedCatalog(db);
const { orders } = await import("./orders.js");

after(() => cleanup());

test("cart quotes use current prices without creating an order", async () => {
  const size = db
    .prepare("SELECT id FROM product_sizes WHERE product_id = 10 LIMIT 1")
    .get() as { id: number };
  const count = () => db.prepare("SELECT count(*) AS n FROM orders").get();
  const before = count();
  const quote = () =>
    orders.request("/cart/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: [
          { product_id: 10, size_id: size.id, qty: 2, unit_price_rappen: 1 },
        ],
      }),
    });
  const response = await quote();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    items: [
      {
        product_id: 10,
        size_id: size.id,
        qty: 2,
        title: "Redline Jersey",
        unit_price_rappen: 9500,
        line_total_rappen: 19000,
      },
    ],
    total_rappen: 19000,
  });
  db.prepare("UPDATE products SET price_rappen = 9600 WHERE id = 10").run();
  try {
    assert.equal(
      ((await (await quote()).json()) as { total_rappen: number }).total_rappen,
      19200,
    );
  } finally {
    db.prepare("UPDATE products SET price_rappen = 9500 WHERE id = 10").run();
  }
  assert.deepEqual(count(), before);
});

test("cart quotes reject invalid carts and unavailable selections", async () => {
  for (const [items, status] of [
    [[], 400],
    [[{ product_id: 10, size_id: null, qty: 11 }], 400],
    [
      [
        { product_id: 10, size_id: null, qty: 1 },
        { product_id: 10, size_id: null, qty: 1 },
      ],
      400,
    ],
    [[{ product_id: 10, size_id: null, qty: 1 }], 422],
    [[{ product_id: 10, size_id: 9999, qty: 1 }], 422],
    [[{ product_id: 12, size_id: null, qty: 1 }], 422],
  ] as const) {
    const response = await orders.request("/cart/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items }),
    });
    assert.equal(response.status, status);
  }
});

async function post(body: unknown): Promise<Response> {
  return orders.request("/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// The visibility and pricing rules are the repository's tests; here we check
// only that the HTTP layer routes the three outcomes to the right status.
test("POST /orders creates the order and returns 201", async () => {
  const sizeId = (
    db
      .prepare("SELECT id FROM product_sizes WHERE product_id = 10 LIMIT 1")
      .get() as { id: number }
  ).id;
  const res = await post({
    email: "buyer@example.com",
    items: [{ product_id: 10, size_id: sizeId, qty: 1 }],
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as {
    reference: string;
    total_rappen: number;
  };
  assert.match(body.reference, /^RF/);
  assert.equal(body.total_rappen, 9500);
});

test("GET /orders/:reference requires the matching receipt token", async () => {
  const size = db
    .prepare(
      "SELECT id, label FROM product_sizes WHERE product_id = 10 LIMIT 1",
    )
    .get() as { id: number; label: string };
  const created = await post({
    email: "buyer@example.com",
    items: [
      {
        product_id: 10,
        size_id: size.id,
        qty: 1,
      },
    ],
  });
  const order = (await created.json()) as {
    reference: string;
    token: string;
  };
  const found = await orders.request(
    `/orders/${order.reference}?token=${order.token}`,
  );
  assert.equal(found.status, 200);
  assert.equal(found.headers.get("Cache-Control"), "no-store");
  const receipt = (await found.json()) as {
    items: { size_label: string }[];
    token?: string;
    note?: string;
  };
  assert.equal(receipt.items[0]?.size_label, size.label);
  assert.equal(receipt.token, undefined);
  assert.equal(receipt.note, undefined);
  assert.equal(
    (await orders.request(`/orders/${order.reference}?token=wrong`)).status,
    404,
  );
  assert.equal(
    (await orders.request(`/orders/${order.reference}`)).status,
    404,
  );
});

test("POST /orders rejects a malformed body with 400", async () => {
  assert.equal(
    (await post({ email: "buyer@example.com", items: [] })).status,
    400,
  );
  assert.equal(
    (
      await post({
        email: "not-an-email",
        items: [{ product_id: 10, size_id: null, qty: 1 }],
      })
    ).status,
    400,
  );
  assert.equal((await post({})).status, 400);
});

test("POST /orders rejects a repeated variant with 400", async () => {
  // Two lines for the same product and size would let MAX_LINE_QTY be doubled;
  // the schema requires each variant at most once, so this never reaches pricing.
  const sizeId = (
    db
      .prepare("SELECT id FROM product_sizes WHERE product_id = 10 LIMIT 1")
      .get() as { id: number }
  ).id;
  const res = await post({
    email: "buyer@example.com",
    items: [
      { product_id: 10, size_id: sizeId, qty: 10 },
      { product_id: 10, size_id: sizeId, qty: 10 },
    ],
  });
  assert.equal(res.status, 400);
});

test("POST /orders maps an unpurchasable product to 422", async () => {
  const res = await post({
    email: "buyer@example.com",
    items: [{ product_id: 11, size_id: null, qty: 1 }], // hidden product
  });
  assert.equal(res.status, 422);
  assert.deepEqual(await res.json(), { error: "product_unavailable" });
});
