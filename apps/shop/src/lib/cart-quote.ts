import { useEffect, useState } from "preact/hooks";
import type { CartQuote } from "@attakk/types";
import type { CartLine } from "./cart.js";

// Asking the API what the cart costs, owned in one place. The cart and the
// checkout both show a server-priced total, and both used to run their own copy
// of this — the projection, the request, the abort, the error copy and the
// stale-result rule — which had already drifted into two different freshness
// models and only one retry. The lifecycle lives here now; a surface supplies
// its own wording and renders the result.
//
// Everything below the hook is a plain function so it can be tested under
// node:test: the shop has no DOM or component-test setup, so useCartQuote is
// kept thin enough to read, and the behaviour that matters sits in fetchQuote.

// The sentences a surface is willing to show, keyed by the error code the API
// and the quote proxy return (product_unavailable, size_required, …) plus the
// "unavailable" fallback every surface must define.
export type QuoteCopy = Record<string, string>;

// One priced line as the quote carries it.
export type QuoteItem = CartQuote["items"][number];

// What the browser is allowed to say about its cart: identities and counts, no
// prices. The API reprices every line from its own table, so the titles and
// prices a CartLine carries for rendering are deliberately left behind here.
// The checkout sends the same projection when it places the order.
export function quoteItems(lines: CartLine[]) {
  return lines.map(({ product_id, size_id, qty }) => ({
    product_id,
    size_id,
    qty,
  }));
}

// The request body, which doubles as the identity of a cart state: two carts
// that project to the same string want the same quote, so this is also what
// stale results are compared against.
export function quoteBody(lines: CartLine[]): string {
  return JSON.stringify({ items: quoteItems(lines) });
}

// Only copy written by a surface is ever shown. A fetch rejection carries a
// browser string ("Failed to fetch") and a body that would not parse carries a
// TypeError, neither of which belongs in front of someone mid-payment.
export function messageFor(reason: unknown, copy: QuoteCopy): string {
  return reason instanceof Error && Object.values(copy).includes(reason.message)
    ? reason.message
    : copy.unavailable;
}

export type QuoteResult =
  | { quote: CartQuote; error?: undefined }
  | { quote?: undefined; error: string };

// One attempt at a quote. Resolves with the quote or a sentence to show, and
// with null when the caller aborted — an aborted request has no answer worth
// rendering, which is what keeps a superseded cart from overwriting a newer one.
// The status is checked before the body is read, so a response that is not a
// quote can never be mistaken for one.
export async function fetchQuote(
  body: string,
  copy: QuoteCopy,
  signal: AbortSignal,
): Promise<QuoteResult | null> {
  try {
    const response = await fetch("/api/cart/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal,
    });
    if (!response.ok) {
      const failed = (await response.json()) as { error?: string };
      throw new Error(copy[failed.error ?? ""] ?? copy.unavailable);
    }
    const quote = (await response.json()) as CartQuote;
    return signal.aborted ? null : { quote };
  } catch (reason) {
    return signal.aborted ? null : { error: messageFor(reason, copy) };
  }
}

// The priced counterpart of a cart line, or undefined while there is no quote.
// Matched on the variant — a product and its chosen size — the same identity
// the cart itself is keyed by.
export function pricedLine(
  quote: CartQuote | undefined,
  line: CartLine,
): QuoteItem | undefined {
  return quote?.items.find(
    (item) =>
      item.product_id === line.product_id && item.size_id === line.size_id,
  );
}

// A result is only trusted while it still answers the cart on screen: it is
// stamped with the cart it was requested for and the attempt that asked, and
// read back only when both still match. That tag, rather than clearing the
// state on every change, is what keeps a stale total from flashing up between
// a cart edit and its new quote.
interface TaggedResult {
  key: string;
  attempt: number;
  quote?: CartQuote;
  error?: string;
}

export function useCartQuote(lines: CartLine[], copy: QuoteCopy) {
  const key = quoteBody(lines);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<TaggedResult | null>(null);
  const current =
    result?.key === key && result.attempt === attempt ? result : null;

  // Keyed on the cart and the retry counter, so editing the cart or pressing
  // "Try again" starts a fresh request and aborts the one it replaces. `copy` is
  // a module constant in every surface, so it is not a dependency.
  useEffect(() => {
    if (lines.length === 0) return;
    const controller = new AbortController();
    void fetchQuote(key, copy, controller.signal).then((outcome) => {
      if (outcome) setResult({ key, attempt, ...outcome });
    });
    return () => controller.abort();
  }, [key, attempt]);

  return {
    quote: current?.quote,
    error: current?.error,
    // A cart with lines and no answer yet — the prices are being checked.
    pending: lines.length > 0 && current === null,
    retry: () => setAttempt((value) => value + 1),
  };
}
