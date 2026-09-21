import { useStore } from "@nanostores/preact";
import { useEffect, useState } from "preact/hooks";
import { MAX_LINE_QTY, type CartQuote } from "@attakk/types";
import { cart, removeFromCart, setQty } from "@/lib/cart.ts";
import { formatFrancs } from "@/lib/format.ts";

const errors: Record<string, string> = {
  invalid:
    "This cart exceeds the order limits or contains an invalid selection. Adjust the quantities or remove a piece and try again.",
  product_unavailable:
    "A piece in your cart is no longer available. Remove pieces from closed drops to continue.",
  size_required:
    "A piece now needs a size. Remove it and choose a size on its product page.",
  size_invalid:
    "A selected size is no longer available. Remove the piece and choose a size again.",
  size_not_allowed:
    "A piece no longer uses sizes. Remove it and add it again from its product page.",
  unavailable:
    "We couldn’t check your total. Your cart is saved. Please try again.",
};

export default function Cart() {
  const lines = useStore(cart);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    attempt: number;
    quote?: CartQuote;
    error?: string;
  } | null>(null);
  const key = JSON.stringify({
    items: lines.map(({ product_id, size_id, qty }) => ({
      product_id,
      size_id,
      qty,
    })),
  });
  const current =
    result?.key === key && result.attempt === attempt ? result : null;
  const quote = current?.quote;

  useEffect(() => {
    if (JSON.parse(key).items.length === 0) return;
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch("/api/cart/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: key,
          signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.json();
          throw new Error(errors[body.error] ?? errors.unavailable);
        }
        const quote: CartQuote = await response.json();
        if (!controller.signal.aborted) setResult({ key, attempt, quote });
      } catch (error) {
        if (!controller.signal.aborted) {
          setResult({
            key,
            attempt,
            error:
              error instanceof Error &&
              Object.values(errors).includes(error.message)
                ? error.message
                : errors.unavailable,
          });
        }
      }
    }
    void refresh();
    return () => controller.abort();
  }, [key, attempt]);

  if (lines.length === 0) {
    return (
      <div class="cart_empty">
        <p class="text-style-h3">Room for something good.</p>
        <p>Your cart is empty. Find your next piece in the current drops.</p>
        <a class="cart_action" href="/#drops">
          Explore the drops <span aria-hidden="true">↗</span>
        </a>
      </div>
    );
  }

  return (
    <div class="cart_layout">
      <div>
        <ul class="cart_list" aria-label="Cart items">
          {lines.map((line) => {
            const priced = quote?.items.find(
              (item) =>
                item.product_id === line.product_id &&
                item.size_id === line.size_id,
            );
            const title = priced?.title ?? line.title;
            const label = `${title}${line.size_label ? `, ${line.size_label}` : ""}`;
            return (
              <li class="cart_item" key={`${line.product_id}:${line.size_id}`}>
                <div class="cart_details">
                  <a
                    class="cart_title text-style-h4"
                    href={`/products/${encodeURIComponent(line.slug)}`}
                  >
                    {title}
                  </a>
                  <p class="cart_label">
                    Size: {line.size_label ?? "One size"}
                  </p>
                  <p class="cart_label">
                    {priced
                      ? `CHF ${formatFrancs(priced.unit_price_rappen)} each`
                      : current?.error
                        ? "Price unavailable"
                        : "Price being checked"}
                  </p>
                </div>
                <div class="cart_controls">
                  <label class="cart_label">
                    Quantity
                    <select
                      aria-label={`Quantity for ${label}`}
                      value={line.qty}
                      onChange={(event) =>
                        setQty(
                          line.product_id,
                          line.size_id,
                          Number(event.currentTarget.value),
                        )
                      }
                    >
                      {Array.from({ length: MAX_LINE_QTY }, (_, i) => (
                        <option value={i + 1} key={i}>
                          {i + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    class="cart_remove"
                    type="button"
                    aria-label={`Remove ${label}`}
                    onClick={() =>
                      removeFromCart(line.product_id, line.size_id)
                    }
                  >
                    Remove
                  </button>
                </div>
                <p class="cart_price">
                  {priced
                    ? `CHF ${formatFrancs(priced.line_total_rappen)}`
                    : "—"}
                </p>
              </li>
            );
          })}
        </ul>
        <a class="cart_continue" href="/#drops">
          ← Keep looking
        </a>
      </div>
      <aside class="cart_summary" aria-label="Order summary">
        <h2 class="text-style-h3">Your selection</h2>
        <div class="cart_total" aria-live="polite" aria-atomic="true">
          <span>Total</span>
          <span>{quote ? `CHF ${formatFrancs(quote.total_rappen)}` : "—"}</span>
        </div>
        <p class="cart_status" role="status">
          {current?.error ??
            (!current
              ? "Checking current prices…"
              : "Current prices checked. Final total confirmed at checkout.")}
        </p>
        {current?.error && (
          <button
            class="cart_retry"
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try again
          </button>
        )}
        <button class="cart_action" type="button" disabled>
          Checkout coming soon
        </button>
        <p>
          Made on demand. Ready for pickup at ATTAKK HQ in roughly 6–10 weeks.
        </p>
        <p class="cart_label">Pay by Swiss QR bill · Sent by email</p>
      </aside>
    </div>
  );
}
