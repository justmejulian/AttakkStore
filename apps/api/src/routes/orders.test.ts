import assert from "node:assert/strict";
import { after, test } from "node:test";
import { openTempApi, seedCatalog } from "../test-support.js";

const { db, cleanup } = await openTempApi();
seedCatalog(db);
const { orders } = await import("./orders.js");

after(() => cleanup());

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

test("POST /orders maps an unpurchasable product to 422", async () => {
  const res = await post({
    email: "buyer@example.com",
    items: [{ product_id: 11, size_id: null, qty: 1 }], // hidden product
  });
  assert.equal(res.status, 422);
  assert.deepEqual(await res.json(), { error: "product_unavailable" });
});
