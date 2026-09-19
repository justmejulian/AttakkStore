import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { setupServer } from "msw/node";
import {
  adminCredentials,
  adminUser,
  createdOrder,
  liveDrops,
  orderListRows,
  paidOrder,
  uploadedImage,
} from "./fixtures.js";
import { handlers } from "./handlers.js";

// The mock's own side of the contract: that the handlers actually intercept
// (the `*` wildcard patterns bind to whatever host a consumer points at) and
// return the fixtures with the statuses the API's contract test proves its real
// routes return. Between this and apps/api's contract test, both sides are
// pinned to the same values, which is what keeps the mock from drifting.

const server = setupServer(...handlers);

// Any host — the point of the wildcard patterns is that the base URL is the
// consumer's, not this package's.
const base = "http://api.internal:3000";

before(() => server.listen({ onUnhandledRequest: "error" }));
after(() => server.close());

function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patch(path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("GET /drops returns the live collections", async () => {
  const res = await fetch(`${base}/drops`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), liveDrops);
});

test("GET /drops/:slug serves a known slug and 404s an unknown one", async () => {
  assert.equal((await fetch(`${base}/drops/redline`)).status, 200);
  assert.equal((await fetch(`${base}/drops/origins`)).status, 200);
  const miss = await fetch(`${base}/drops/nope`);
  assert.equal(miss.status, 404);
  assert.deepEqual(await miss.json(), { error: "not_found" });
});

test("GET /products/:slug serves a known slug and 404s an unknown one", async () => {
  assert.equal((await fetch(`${base}/products/redline-jersey`)).status, 200);
  assert.equal((await fetch(`${base}/products/nope`)).status, 404);
});

test("POST /orders returns the created order on a clean cart", async () => {
  const res = await post("/orders", {
    email: "buyer@example.com",
    items: [{ product_id: 10, size_id: 101, qty: 2 }],
  });
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), createdOrder);
});

test("POST /orders mirrors the API's rejections, code for code", async () => {
  // Malformed (bad email) and duplicate variant are the schema's 400s.
  assert.equal((await post("/orders", { email: "x", items: [] })).status, 400);
  const dup = await post("/orders", {
    email: "buyer@example.com",
    items: [
      { product_id: 10, size_id: 101, qty: 1 },
      { product_id: 10, size_id: 101, qty: 1 },
    ],
  });
  assert.equal(dup.status, 400);

  // Pricing's 422s, one per code, priced against the fixtures the way the API
  // prices against its table.
  const cases: [Record<string, unknown>, string][] = [
    [{ product_id: 999, size_id: null, qty: 1 }, "product_unavailable"],
    [{ product_id: 10, size_id: null, qty: 1 }, "size_required"],
    [{ product_id: 10, size_id: 900, qty: 1 }, "size_invalid"],
    [{ product_id: 11, size_id: 101, qty: 1 }, "size_not_allowed"],
  ];
  for (const [item, code] of cases) {
    const res = await post("/orders", {
      email: "buyer@example.com",
      items: [item],
    });
    assert.equal(res.status, 422, `${code} should be 422`);
    assert.deepEqual(await res.json(), { error: code });
  }
});

test("POST /admin/login accepts the fixture credentials and refuses the rest", async () => {
  const ok = await post("/admin/login", adminCredentials);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), adminUser);

  const wrong = await post("/admin/login", {
    username: adminCredentials.username,
    password: "nope",
  });
  assert.equal(wrong.status, 401);
  assert.deepEqual(await wrong.json(), { error: "invalid_credentials" });

  // A body the schema rejects is the same 400 the API gives.
  assert.equal((await post("/admin/login", { username: "x" })).status, 400);
});

test("GET /admin/orders lists the rows and filters by status", async () => {
  const all = await fetch(`${base}/admin/orders`);
  assert.equal(all.status, 200);
  assert.deepEqual(await all.json(), orderListRows);

  const paid = await fetch(`${base}/admin/orders?status=paid`);
  assert.deepEqual(
    await paid.json(),
    orderListRows.filter((o) => o.status === "paid"),
  );

  const bad = await fetch(`${base}/admin/orders?status=shipped`);
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { error: "invalid_status" });
});

test("GET /admin/orders/:id returns the order with items or 404s", async () => {
  const found = await fetch(`${base}/admin/orders/2`);
  assert.equal(found.status, 200);
  assert.deepEqual(await found.json(), paidOrder);
  assert.equal((await fetch(`${base}/admin/orders/999`)).status, 404);
});

test("PATCH status returns the updated order and stamps or clears paid_at", async () => {
  const paid = await patch("/admin/orders/1/status", { status: "paid" });
  const paidBody = (await paid.json()) as {
    status: string;
    paid_at: string | null;
  };
  assert.equal(paidBody.status, "paid");
  assert.notEqual(paidBody.paid_at, null);

  const cancelled = await patch("/admin/orders/1/status", {
    status: "cancelled",
  });
  assert.equal(
    ((await cancelled.json()) as { paid_at: string | null }).paid_at,
    null,
  );

  assert.equal(
    (await patch("/admin/orders/1/status", { status: "x" })).status,
    400,
  );
  assert.equal(
    (await patch("/admin/orders/999/status", { status: "paid" })).status,
    404,
  );
});

test("PATCH note returns the order with the new note", async () => {
  const res = await patch("/admin/orders/1/note", { note: "Chased payment." });
  assert.equal(
    ((await res.json()) as { note: string }).note,
    "Chased payment.",
  );
  assert.equal(
    (await patch("/admin/orders/999/note", { note: "x" })).status,
    404,
  );
});

test("POST resend is 202 for a known order and 404 otherwise", async () => {
  const ok = await fetch(`${base}/admin/orders/1/resend`, { method: "POST" });
  assert.equal(ok.status, 202);
  assert.deepEqual(await ok.json(), { status: "queued" });
  const miss = await fetch(`${base}/admin/orders/999/resend`, {
    method: "POST",
  });
  assert.equal(miss.status, 404);
});

test("image write routes return the stored row and an empty 204", async () => {
  const created = await fetch(`${base}/products/10/images`, { method: "POST" });
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), uploadedImage);

  const removed = await fetch(`${base}/images/5`, { method: "DELETE" });
  assert.equal(removed.status, 204);
  assert.equal(await removed.text(), "");
});
