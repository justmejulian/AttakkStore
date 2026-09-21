import { computed } from "nanostores";
import { persistentAtom } from "@nanostores/persistent";
import { MAX_LINE_QTY } from "@attakk/types";

// The cart: one store, owned here, not poked into localStorage from several
// places. It is a @nanostores/persistent atom, so it survives a reload and stays
// in sync across tabs; the interactive cart controls are Preact islands bound to
// it through @nanostores/preact, never the other way round. The cart is never
// trusted — the API reprices every line from its own table at checkout — so what
// is stored here is display data plus the ids and quantity an order needs.

// One line of the cart: a product, its chosen size (null when the product has no
// sizes), and how many. The title, price and size label are copied in for the
// cart and checkout to render without another fetch, the way an order snapshots
// them; a later price change never rewrites a line already in someone's cart, and
// the bill is recomputed server-side regardless. slug links back to the product.
export interface CartLine {
  product_id: number;
  size_id: number | null;
  qty: number;
  slug: string;
  title: string;
  unit_price_rappen: number;
  size_label: string | null;
}

// The identity of a cart line: a product and, if it has sizes, its chosen size.
// The cart holds at most one line per variant — adding the same one again sums
// the quantity rather than appending — mirroring the API, which rejects a cart
// that repeats a variant. Same shape the order schema's own (module-private)
// variantKey uses in @attakk/types — keep the `:none` sentinel identical if
// either ever changes.
function variantKey(productId: number, sizeId: number | null): string {
  return `${productId}:${sizeId ?? "none"}`;
}

// A value is a usable cart line only if every field it will be read by is the
// right type — product and quantity as positive integers, size as an id or null,
// the display strings present. A line that fails (an old or tampered shape) is
// dropped rather than trusted, so a stored cart from a previous version can't
// surface `undefined` fields or an NaN count.
function isCartLine(value: unknown): value is CartLine {
  if (typeof value !== "object" || value === null) return false;
  const l = value as Record<string, unknown>;
  return (
    Number.isInteger(l.product_id) &&
    (l.product_id as number) > 0 &&
    (l.size_id === null ||
      (Number.isInteger(l.size_id) && (l.size_id as number) > 0)) &&
    Number.isInteger(l.qty) &&
    (l.qty as number) > 0 &&
    typeof l.slug === "string" &&
    typeof l.title === "string" &&
    Number.isInteger(l.unit_price_rappen) &&
    (l.size_label === null || typeof l.size_label === "string")
  );
}

// The atom's decoder: parse the stored blob and keep only well-formed lines.
// localStorage can hold anything by the time we read it — an old shape, a value
// hand-edited, a truncated write — so a non-array, a parse error, or a corrupt
// line all degrade to a clean-or-empty cart rather than throwing or poisoning the
// store. Exported so it can be tested directly (the persistent atom only runs
// decode against real storage).
export function parseCart(raw: string): CartLine[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isCartLine) : [];
  } catch {
    return [];
  }
}

// The atom is a single JSON blob (not a persistentMap of scattered keys) so the
// line array stays one value; parseCart guards what comes back off disk.
export const cart = persistentAtom<CartLine[]>("attakk:cart", [], {
  encode: JSON.stringify,
  decode: parseCart,
});

// The total number of pieces in the cart, for the nav count — the sum of the
// line quantities, not the number of lines. Derived, so it can never disagree
// with the cart it is read from.
export const cartCount = computed(cart, (lines) =>
  lines.reduce((total, line) => total + line.qty, 0),
);

// Add a piece to the cart, or raise the quantity of one already in it. Quantity
// is capped at MAX_LINE_QTY — the same per-variant ceiling the API enforces, so
// the cart can never build an order the checkout would reject. Adding an existing
// variant sums toward that cap rather than appending a second line.
export function addToCart(line: Omit<CartLine, "qty">, qty = 1): void {
  const key = variantKey(line.product_id, line.size_id);
  const lines = cart.get();
  const existing = lines.find(
    (l) => variantKey(l.product_id, l.size_id) === key,
  );
  if (existing) {
    const next = Math.min(existing.qty + qty, MAX_LINE_QTY);
    cart.set(lines.map((l) => (l === existing ? { ...l, qty: next } : l)));
  } else {
    cart.set([...lines, { ...line, qty: Math.min(qty, MAX_LINE_QTY) }]);
  }
}

// Set a variant's quantity outright (the cart page's quantity control), clamped
// to 1..MAX_LINE_QTY — dropping to zero is a removal, which removeFromCart does.
// A no-op if the variant is not in the cart.
export function setQty(
  productId: number,
  sizeId: number | null,
  qty: number,
): void {
  const key = variantKey(productId, sizeId);
  const clamped = Math.min(Math.max(qty, 1), MAX_LINE_QTY);
  cart.set(
    cart
      .get()
      .map((l) =>
        variantKey(l.product_id, l.size_id) === key
          ? { ...l, qty: clamped }
          : l,
      ),
  );
}

// Drop a variant from the cart entirely.
export function removeFromCart(productId: number, sizeId: number | null): void {
  const key = variantKey(productId, sizeId);
  cart.set(
    cart.get().filter((l) => variantKey(l.product_id, l.size_id) !== key),
  );
}

// Empty the cart — after a completed order, or a manual clear.
export function clearCart(): void {
  cart.set([]);
}
