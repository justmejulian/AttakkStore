import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { MAX_LINE_QTY } from "@attakk/types";
import {
  addToCart,
  cart,
  cartCount,
  clearCart,
  parseCart,
  removeFromCart,
  setQty,
  type CartLine,
} from "./cart.ts";

// The cart store's logic — variant merging, the MAX_LINE_QTY cap, quantity edits
// and removal. Pure state, no localStorage: in node the persistent atom keeps its
// value in memory, so get/set exercise the same code the browser runs. The store
// is a module singleton, so each test starts from an empty cart.

beforeEach(() => clearCart());

// A cart line for a sized product; override any field per test.
function line(
  over: Partial<Omit<CartLine, "qty">> = {},
): Omit<CartLine, "qty"> {
  return {
    product_id: 10,
    size_id: 101,
    slug: "redline-jersey",
    title: "Redline Jersey",
    unit_price_rappen: 9500,
    size_label: "M",
    ...over,
  };
}

test("addToCart appends a new variant with its quantity", () => {
  addToCart(line(), 2);
  assert.deepEqual(
    cart.get().map((l) => [l.product_id, l.size_id, l.qty]),
    [[10, 101, 2]],
  );
});

test("adding the same variant sums the quantity into one line", () => {
  addToCart(line(), 1);
  addToCart(line(), 2);
  const lines = cart.get();
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.qty, 3);
});

test("a variant's quantity is capped at MAX_LINE_QTY", () => {
  addToCart(line(), MAX_LINE_QTY - 1);
  addToCart(line(), 5);
  assert.equal(cart.get()[0]!.qty, MAX_LINE_QTY);
});

test("a single add over the cap is clamped too", () => {
  addToCart(line(), MAX_LINE_QTY + 10);
  assert.equal(cart.get()[0]!.qty, MAX_LINE_QTY);
});

test("different sizes of one product are distinct lines", () => {
  addToCart(line({ size_id: 100, size_label: "S" }), 1);
  addToCart(line({ size_id: 101, size_label: "M" }), 1);
  assert.equal(cart.get().length, 2);
});

test("a size-less product keys on its null size", () => {
  addToCart(line({ product_id: 11, size_id: null, size_label: null }), 1);
  addToCart(line({ product_id: 11, size_id: null, size_label: null }), 1);
  const lines = cart.get();
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.qty, 2);
});

test("cartCount sums quantities across lines, not the line count", () => {
  addToCart(line({ size_id: 100 }), 2);
  addToCart(line({ size_id: 101 }), 3);
  assert.equal(cartCount.get(), 5);
});

test("setQty clamps to 1..MAX_LINE_QTY and leaves others alone", () => {
  addToCart(line({ size_id: 100 }), 1);
  addToCart(line({ size_id: 101 }), 4);

  setQty(10, 101, 99);
  assert.equal(cart.get().find((l) => l.size_id === 101)!.qty, MAX_LINE_QTY);

  setQty(10, 101, 0);
  assert.equal(cart.get().find((l) => l.size_id === 101)!.qty, 1);

  assert.equal(cart.get().find((l) => l.size_id === 100)!.qty, 1);
});

test("setQty on a variant not in the cart is a no-op", () => {
  addToCart(line(), 1);
  setQty(999, null, 5);
  assert.equal(cart.get().length, 1);
});

test("removeFromCart drops only the matching variant", () => {
  addToCart(line({ size_id: 100 }), 1);
  addToCart(line({ size_id: 101 }), 1);
  removeFromCart(10, 100);
  assert.deepEqual(
    cart.get().map((l) => l.size_id),
    [101],
  );
});

test("clearCart empties the cart", () => {
  addToCart(line(), 3);
  clearCart();
  assert.deepEqual(cart.get(), []);
  assert.equal(cartCount.get(), 0);
});

test("parseCart round-trips a well-formed stored cart", () => {
  const stored: CartLine[] = [{ ...line(), qty: 2 }];
  assert.deepEqual(parseCart(JSON.stringify(stored)), stored);
});

test("parseCart drops malformed lines but keeps the good ones", () => {
  const good: CartLine = { ...line(), qty: 1 };
  const raw = JSON.stringify([
    good,
    { ...line() }, // no qty — an older shape
    { ...line(), qty: 0 }, // non-positive qty
    { ...line(), product_id: "10" }, // wrong type
    "not-a-line",
  ]);
  assert.deepEqual(parseCart(raw), [good]);
});

test("parseCart yields an empty cart for a non-array or non-JSON blob", () => {
  assert.deepEqual(parseCart(JSON.stringify({ not: "an array" })), []);
  assert.deepEqual(parseCart("{ broken json"), []);
});
