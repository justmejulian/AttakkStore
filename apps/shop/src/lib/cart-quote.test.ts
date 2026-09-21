import assert from "node:assert/strict";
import { test } from "node:test";
import type { APIContext } from "astro";
import { POST } from "../pages/api/cart/quote.js";

const items = [{ product_id: 10, size_id: 101, qty: 2 }];

function quote(body: string) {
  return POST({
    request: new Request("http://shop.test/api/cart/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }),
  } as APIContext);
}

test("cart quote proxy rejects invalid input without calling the API", async (t) => {
  const upstream = t.mock.method(globalThis, "fetch", () => {
    throw new Error("Unexpected API request");
  });
  for (const body of ["{", JSON.stringify({ items: [] })]) {
    const response = await quote(body);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), { error: "invalid" });
  }
  assert.equal(upstream.mock.callCount(), 0);
});

test("cart quote proxy forwards only validated selections and preserves API results", async (t) => {
  for (const [status, body] of [
    [200, { items: [], total_rappen: 19000 }],
    [400, { error: "invalid" }],
    [422, { error: "product_unavailable" }],
  ] as const) {
    const respond: typeof fetch = async (url, init) => {
      assert.equal(
        new URL(url instanceof Request ? url.url : url).pathname,
        "/cart/quote",
      );
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(init?.body as string), { items });
      return Response.json(body, { status });
    };
    const upstream = t.mock.method(globalThis, "fetch", respond);
    const response = await quote(
      JSON.stringify({ items: [{ ...items[0], unit_price_rappen: 1 }] }),
    );
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), body);
    assert.equal(upstream.mock.callCount(), 1);
    upstream.mock.restore();
  }
});

test("cart quote proxy returns a retryable error for upstream failures", async (t) => {
  for (const fail of [
    () => Promise.reject(new Error("Connection refused")),
    () => Promise.resolve(new Response("Internal error", { status: 500 })),
    () => Promise.resolve(new Response("not JSON", { status: 200 })),
  ]) {
    const upstream = t.mock.method(globalThis, "fetch", fail);
    const response = await quote(JSON.stringify({ items }));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), { error: "unavailable" });
    upstream.mock.restore();
  }
});
