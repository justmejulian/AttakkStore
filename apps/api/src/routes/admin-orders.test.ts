import assert from "node:assert/strict";
import { after, test } from "node:test";
import { openTempApi, seedCatalog } from "../test-support.js";

const { db, cleanup } = await openTempApi();
seedCatalog(db);
seedOrders();
const { adminOrders } = await import("./admin-orders.js");

after(() => cleanup());

// Three stored orders with fixed ids, one per status, inserted directly rather
// than through the order route so the list, the status filter and the detail
// view all have something deterministic to read. Product 10 is the seeded live
// jersey; its sizes are seeded by seedCatalog.
function seedOrders(): void {
  const size = (
    db
      .prepare(
        "SELECT id FROM product_sizes WHERE product_id = 10 AND label = 'M'",
      )
      .get() as { id: number }
  ).id;
  const insertOrder = db.prepare(
    `INSERT INTO orders (id, reference, token, email, total_rappen, status, created_at, paid_at, note)
     VALUES (@id, @reference, @token, @email, @total_rappen, @status, @created_at, @paid_at, @note)`,
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
      total_rappen: 9500,
      status: "pending",
      created_at: "2026-01-01T00:00:00.000Z",
      paid_at: null,
      note: "",
    });
    insertItem.run({
      order_id: 1,
      product_id: 10,
      size_id: size,
      qty: 1,
      unit_price_rappen: 9500,
      title: "Redline Jersey",
    });
    insertOrder.run({
      id: 2,
      reference: "RF74000002",
      token: "b".repeat(32),
      email: "paid@example.com",
      total_rappen: 9500,
      status: "paid",
      created_at: "2026-01-02T00:00:00.000Z",
      paid_at: "2026-01-03T00:00:00.000Z",
      note: "Paid at the shop.",
    });
    insertOrder.run({
      id: 3,
      reference: "RF74000003",
      token: "c".repeat(32),
      email: "cancelled@example.com",
      total_rappen: 3500,
      status: "cancelled",
      created_at: "2026-01-04T00:00:00.000Z",
      paid_at: null,
      note: "",
    });
  })();
}

interface OrderRow {
  id: number;
  status: string;
  paid_at: string | null;
  note: string;
  items?: unknown[];
}

test("GET /admin/orders lists every order, newest first, without items", async () => {
  const res = await adminOrders.request("/admin/orders");
  assert.equal(res.status, 200);
  const rows = (await res.json()) as OrderRow[];
  assert.deepEqual(
    rows.map((o) => o.id),
    [3, 2, 1],
  );
  // The list is the bare row: no items are joined until a detail view opens one,
  // and the receipt token is never in the list (it stays with the detail view).
  assert.ok(rows.every((o) => o.items === undefined));
  assert.ok(rows.every((o) => !("token" in o)));
});

test("GET /admin/orders?status= narrows to that status", async () => {
  const res = await adminOrders.request("/admin/orders?status=paid");
  assert.equal(res.status, 200);
  const rows = (await res.json()) as OrderRow[];
  assert.deepEqual(
    rows.map((o) => o.id),
    [2],
  );
});

test("GET /admin/orders rejects an unknown status with 400", async () => {
  const res = await adminOrders.request("/admin/orders?status=shipped");
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "invalid_status" });
});

test("GET /admin/orders/:id returns the order with its items", async () => {
  const res = await adminOrders.request("/admin/orders/1");
  assert.equal(res.status, 200);
  const order = (await res.json()) as OrderRow;
  assert.equal(order.id, 1);
  assert.equal(order.items?.length, 1);
});

test("GET /admin/orders/:id is 404 for a missing or non-numeric id", async () => {
  assert.equal((await adminOrders.request("/admin/orders/999")).status, 404);
  assert.equal((await adminOrders.request("/admin/orders/abc")).status, 404);
});

test("PATCH status to paid stamps paid_at; back to pending clears it", async () => {
  const paid = await patch("/admin/orders/1/status", { status: "paid" });
  assert.equal(paid.status, 200);
  const paidBody = (await paid.json()) as OrderRow;
  assert.equal(paidBody.status, "paid");
  assert.match(
    paidBody.paid_at ?? "",
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/,
  );

  const back = await patch("/admin/orders/1/status", { status: "pending" });
  const backBody = (await back.json()) as OrderRow;
  assert.equal(backBody.status, "pending");
  assert.equal(backBody.paid_at, null);
});

test("marking an already-paid order paid again keeps the original paid_at", async () => {
  // Order 2 is seeded paid with a fixed paid_at. Re-confirming paid must not
  // reset it to now, or the recorded payment date drifts on every re-save.
  const again = await patch("/admin/orders/2/status", { status: "paid" });
  const body = (await again.json()) as OrderRow;
  assert.equal(body.status, "paid");
  assert.equal(body.paid_at, "2026-01-03T00:00:00.000Z");
});

test("PATCH status rejects an unknown status (400) and a missing order (404)", async () => {
  assert.equal(
    (await patch("/admin/orders/1/status", { status: "shipped" })).status,
    400,
  );
  assert.equal(
    (await patch("/admin/orders/999/status", { status: "paid" })).status,
    404,
  );
});

test("PATCH note replaces the note; over-length is 400, missing order is 404", async () => {
  const res = await patch("/admin/orders/2/note", {
    note: "Called about pickup.",
  });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as OrderRow).note, "Called about pickup.");

  assert.equal(
    (await patch("/admin/orders/2/note", { note: "x".repeat(2001) })).status,
    400,
  );
  assert.equal(
    (await patch("/admin/orders/999/note", { note: "x" })).status,
    404,
  );
});

test("POST resend is 202 for an order and 404 for a missing one", async () => {
  // No SMTP is configured in tests, so the send is a no-op; the route still
  // answers 202 the moment it queues, which is all this checks.
  assert.equal(
    (await adminOrders.request("/admin/orders/1/resend", { method: "POST" }))
      .status,
    202,
  );
  assert.equal(
    (await adminOrders.request("/admin/orders/999/resend", { method: "POST" }))
      .status,
    404,
  );
});

function patch(path: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    adminOrders.request(path, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
