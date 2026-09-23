import assert from "node:assert/strict";
import { test } from "node:test";
import type { APIContext } from "astro";
import { POST, resetOrderRateLimits } from "../pages/api/orders.js";
import { getReceiptOrder } from "./orders.js";

const order = {
  email: "buyer@example.com",
  items: [{ product_id: 10, size_id: 101, qty: 2 }],
};

// `forwarded` is the X-Forwarded-For nginx would send; `clientAddress` is the
// socket address Astro reports, which the route only falls back to when no
// header is present.
function post(body: unknown, forwarded?: string, clientAddress = "192.0.2.1") {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (forwarded) headers["X-Forwarded-For"] = forwarded;
  return POST({
    clientAddress,
    request: new Request("http://shop.test/api/orders", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  } as APIContext);
}

function created(reference = "RF74000001") {
  return Response.json({ reference, token: "0".repeat(32) }, { status: 201 });
}

test("checkout rejects malformed input and quietly catches the honeypot", async (t) => {
  resetOrderRateLimits();
  const upstream = t.mock.method(globalThis, "fetch", () => {
    throw new Error("Unexpected API request");
  });
  assert.equal((await post({ email: "x", items: [] })).status, 400);
  assert.equal(
    (await post({ ...order, website: "https://spam.test" })).status,
    204,
  );
  assert.equal(upstream.mock.callCount(), 0);
});

test("checkout forwards validated order fields and preserves API results", async (t) => {
  resetOrderRateLimits();
  const created = {
    id: 1,
    reference: "RF74000001",
    token: "0".repeat(32),
    ...order,
  };
  const upstream = t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(
        new URL(url instanceof Request ? url.url : url).pathname,
        "/orders",
      );
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(init?.body as string), order);
      return Response.json(created, { status: 201 });
    },
  );
  const response = await post({ ...order, website: "" });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal((await response.json()).reference, created.reference);
  assert.equal(upstream.mock.callCount(), 1);
});

test("checkout limits order creation per client address", async (t) => {
  resetOrderRateLimits();
  const upstream = t.mock.method(globalThis, "fetch", async () => created());
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await post(order, "198.51.100.8")).status, 201);
  }
  const limited = await post(order, "198.51.100.8");
  assert.equal(limited.status, 429);
  assert.deepEqual(await limited.json(), { error: "rate_limited" });
  assert.equal(upstream.mock.callCount(), 5);

  // A different client is unaffected: the budget is per address, not per shop.
  assert.equal((await post(order, "198.51.100.9")).status, 201);
});

// nginx appends the address it saw to whatever the caller sent, so the real
// client is the LAST entry. Taking the first would let a bot rotate a header and
// buy itself a fresh budget per request.
test("checkout throttles on the last forwarded address, not the first", async (t) => {
  resetOrderRateLimits();
  t.mock.method(globalThis, "fetch", async () => created());
  for (let i = 0; i < 5; i += 1) {
    const spoofed = `10.0.0.${i}, 198.51.100.20`;
    assert.equal((await post(order, spoofed)).status, 201);
  }
  assert.equal((await post(order, "10.0.0.99, 198.51.100.20")).status, 429);
});

test("checkout falls back to the socket address with no forwarded header", async (t) => {
  resetOrderRateLimits();
  t.mock.method(globalThis, "fetch", async () => created());
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await post(order, undefined, "203.0.113.55")).status, 201);
  }
  assert.equal((await post(order, undefined, "203.0.113.55")).status, 429);
  assert.equal((await post(order, undefined, "203.0.113.56")).status, 201);
});

// Only orders the API creates send mail, so only those spend the budget — a
// customer correcting a cart the API refuses must not be locked out for it.
test("checkout does not spend the budget on carts the API rejects", async (t) => {
  resetOrderRateLimits();
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: "product_unavailable" }, { status: 422 }),
  );
  for (let i = 0; i < 8; i += 1) {
    assert.equal((await post(order, "198.51.100.30")).status, 422);
  }
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => created());
  assert.equal((await post(order, "198.51.100.30")).status, 201);
});

test("checkout turns API failures into a retryable response", async (t) => {
  resetOrderRateLimits();
  // The route logs the cause; silence it so a deliberate failure does not read
  // like a broken test run.
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async () =>
    Promise.reject(new Error("Connection refused")),
  );
  const response = await post(order, "203.0.113.4");
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "unavailable" });
});

test("receipt reads require the reference and token", async (t) => {
  const upstream = t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request) => {
      const parsed = new URL(url instanceof Request ? url.url : url);
      assert.equal(parsed.pathname, "/orders/RF74000001");
      assert.equal(parsed.searchParams.get("token"), "secret token");
      return Response.json({ reference: "RF74000001", items: [] });
    },
  );
  assert.equal(
    (await getReceiptOrder("RF74000001", "secret token"))?.reference,
    "RF74000001",
  );
  assert.equal(upstream.mock.callCount(), 1);
  upstream.mock.restore();

  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: "not_found" }, { status: 404 }),
  );
  assert.equal(await getReceiptOrder("RF00000000", "wrong"), null);
});
