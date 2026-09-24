import assert from "node:assert/strict";
import { test } from "node:test";
import type { CartQuote } from "@attakk/types";
import type { CartLine } from "./cart.js";
import {
  fetchQuote,
  messageFor,
  pricedLine,
  quoteBody,
  quoteItems,
} from "./cart-quote.js";

const copy = {
  product_unavailable: "A piece in your cart is no longer available.",
  unavailable: "We couldn’t check your total.",
};

const line: CartLine = {
  product_id: 10,
  size_id: 101,
  qty: 2,
  slug: "jersey",
  title: "Jersey",
  unit_price_rappen: 9500,
  size_label: "M",
};

const quote: CartQuote = {
  items: [
    {
      product_id: 10,
      size_id: 101,
      qty: 2,
      unit_price_rappen: 9500,
      title: "Jersey",
      line_total_rappen: 19000,
    },
  ],
  total_rappen: 19000,
};

function respond(status: number, body: unknown): typeof fetch {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
}

test("the projection carries identities and counts, never prices or titles", () => {
  assert.deepEqual(quoteItems([line]), [
    { product_id: 10, size_id: 101, qty: 2 },
  ]);
  assert.equal(
    quoteBody([line]),
    '{"items":[{"product_id":10,"size_id":101,"qty":2}]}',
  );
  // Two carts that differ only in what is rendered ask the same question.
  assert.equal(quoteBody([line]), quoteBody([{ ...line, title: "Renamed" }]));
  assert.notEqual(quoteBody([line]), quoteBody([{ ...line, qty: 3 }]));
});

test("only copy the surface wrote is ever shown", () => {
  assert.equal(
    messageFor(new Error(copy.product_unavailable), copy),
    copy.product_unavailable,
  );
  assert.equal(
    messageFor(new Error("Failed to fetch"), copy),
    copy.unavailable,
  );
  assert.equal(messageFor(new TypeError("bad json"), copy), copy.unavailable);
  assert.equal(messageFor("not an error at all", copy), copy.unavailable);
});

test("a quote is returned as it came back", async (t) => {
  t.mock.method(globalThis, "fetch", respond(200, quote));
  const result = await fetchQuote(
    quoteBody([line]),
    copy,
    new AbortController().signal,
  );
  assert.deepEqual(result, { quote });
});

test("the request posts the projected cart as JSON", async (t) => {
  const seen: { url?: string; init?: RequestInit } = {};
  const send: typeof fetch = async (url, init) => {
    seen.url = String(url);
    seen.init = init;
    return new Response(JSON.stringify(quote), { status: 200 });
  };
  t.mock.method(globalThis, "fetch", send);
  await fetchQuote(quoteBody([line]), copy, new AbortController().signal);
  assert.equal(seen.url, "/api/cart/quote");
  assert.equal(seen.init?.method, "POST");
  assert.equal(seen.init?.body, quoteBody([line]));
});

test("a refused cart becomes the sentence written for its code", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    respond(422, { error: "product_unavailable" }),
  );
  const result = await fetchQuote(
    quoteBody([line]),
    copy,
    new AbortController().signal,
  );
  assert.deepEqual(result, { error: copy.product_unavailable });
});

test("an unknown code, an unreachable proxy and an unreadable body all fall back", async (t) => {
  const unreadable: typeof fetch = async () =>
    new Response("not json", { status: 200 });
  const refuse: typeof fetch = async () => {
    throw new Error("Failed to fetch");
  };
  for (const responder of [
    respond(503, { error: "brand_new_code" }),
    respond(500, {}),
    unreadable,
    refuse,
  ]) {
    const mocked = t.mock.method(globalThis, "fetch", responder);
    const result = await fetchQuote(
      quoteBody([line]),
      copy,
      new AbortController().signal,
    );
    assert.deepEqual(result, { error: copy.unavailable });
    mocked.mock.restore();
  }
});

test("an aborted request has no answer to render", async (t) => {
  const controller = new AbortController();
  const slow: typeof fetch = async () => {
    controller.abort();
    return new Response(JSON.stringify(quote), { status: 200 });
  };
  t.mock.method(globalThis, "fetch", slow);
  assert.equal(
    await fetchQuote(quoteBody([line]), copy, controller.signal),
    null,
  );
});

test("a line is priced by its variant, not its position", () => {
  assert.equal(pricedLine(quote, line), quote.items[0]);
  assert.equal(pricedLine(quote, { ...line, size_id: 102 }), undefined);
  assert.equal(pricedLine(quote, { ...line, product_id: 11 }), undefined);
  assert.equal(pricedLine(undefined, line), undefined);
});
