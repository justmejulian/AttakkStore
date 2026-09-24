import { useStore } from "@nanostores/preact";
import { useState } from "preact/hooks";
import type { OrderWithItems } from "@attakk/types";
import { cart, clearCart } from "@/lib/cart.ts";
import {
  messageFor,
  pricedLine,
  quoteItems,
  useCartQuote,
} from "@/lib/cart-quote.ts";
import { formatFrancs } from "@/lib/format.ts";

// The wording this screen is willing to show — the quote's failures said to
// someone mid-payment, plus rate_limited, which only the order endpoint can
// answer with. The cart writes its own, gentler, set for the same codes.
const messages: Record<string, string> = {
  invalid: "Check your email and cart, then try again.",
  product_unavailable:
    "A piece in your cart is no longer available. Return to your cart to update it.",
  size_required:
    "A piece now needs a size. Return to your cart and add it again.",
  size_invalid:
    "A selected size is no longer available. Return to your cart and choose another.",
  size_not_allowed:
    "A piece no longer uses sizes. Return to your cart and add it again.",
  rate_limited:
    "Too many order attempts were made from this connection. Please try again in 15 minutes.",
  unavailable:
    "We couldn’t place your order. Your cart is saved. Please try again.",
};

export default function Checkout() {
  const lines = useStore(cart);
  const {
    quote,
    error: quoteError,
    pending,
    retry,
  } = useCartQuote(lines, messages);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    if (!form.checkValidity() || !quote || submitting) return;

    setSubmitting(true);
    setError("");
    const data = new FormData(form);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          website: data.get("website"),
          items: quoteItems(lines),
        }),
      });
      const body = response.status === 204 ? null : await response.json();
      if (!response.ok || !body?.reference || !body?.token) {
        throw new Error(messages[body?.error] ?? messages.unavailable);
      }
      const order = body as OrderWithItems;
      clearCart();
      window.location.assign(
        `/order/${encodeURIComponent(order.reference)}?token=${encodeURIComponent(order.token)}`,
      );
    } catch (reason) {
      setError(messageFor(reason, messages));
      setSubmitting(false);
    }
  }

  if (lines.length === 0) {
    return (
      <div class="checkout_empty">
        <p class="text-style-h3">Your cart is empty.</p>
        <a class="checkout_action" href="/#drops">
          Explore the drops <span aria-hidden="true">↗</span>
        </a>
      </div>
    );
  }

  return (
    <div class="checkout_layout">
      <form class="checkout_form" onSubmit={submit}>
        <div>
          <label class="checkout_label" for="checkout-email">
            Email address
          </label>
          <input
            class="checkout_input"
            id="checkout-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onInput={(event) => setEmail(event.currentTarget.value)}
          />
        </div>
        <div class="checkout_trap" aria-hidden="true">
          <label for="checkout-website">Website</label>
          <input
            id="checkout-website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
          />
        </div>
        <p>
          We’ll email your Swiss QR bill here. Your pieces will be ready for
          pickup at ATTAKK HQ in roughly 6–10 weeks.
        </p>
        {error && (
          <p class="checkout_error" role="alert">
            {error}
          </p>
        )}
        <button
          class="checkout_action"
          type="submit"
          disabled={!quote || submitting}
        >
          {submitting ? "Placing order…" : "Place order"}
        </button>
        <p class="checkout_fineprint">
          By placing the order, you confirm that the email address is yours and
          that you’ll pay the QR bill sent to it.
        </p>
      </form>

      <aside class="checkout_summary" aria-label="Order summary">
        <h2 class="text-style-h3">Your order</h2>
        <ul class="checkout_list">
          {lines.map((line) => {
            const priced = pricedLine(quote, line);
            return (
              <li
                class="checkout_item"
                key={`${line.product_id}:${line.size_id}`}
              >
                <span>
                  {priced?.title ?? line.title} × {line.qty}
                  <small>{line.size_label ?? "One size"}</small>
                </span>
                <span>
                  {priced
                    ? `CHF ${formatFrancs(priced.line_total_rappen)}`
                    : "—"}
                </span>
              </li>
            );
          })}
        </ul>
        <div class="checkout_total" aria-live="polite">
          <span>Total</span>
          <span>
            {quote
              ? `CHF ${formatFrancs(quote.total_rappen)}`
              : pending
                ? "Checking…"
                : "—"}
          </span>
        </div>
        {/* Without the retry the order cannot be placed at all: the submit
            button stays disabled until there is a quote, and nothing else on
            this screen asks for one again. */}
        {quoteError && (
          <>
            <p class="checkout_error" role="alert">
              {quoteError}
            </p>
            <button class="checkout_retry" type="button" onClick={retry}>
              Try again
            </button>
          </>
        )}
        <a class="checkout_back" href="/cart">
          ← Edit cart
        </a>
      </aside>
    </div>
  );
}
