import { useState } from "preact/hooks";
import { MAX_LINE_QTY } from "@attakk/types";
import { addToCart } from "@/lib/cart.ts";

// The product page's one interactive control: choose a size (when the piece has
// them), a quantity, and add the variant to the cart store. Everything else on
// the page is server-rendered markup — this is hydrated because it owns state and
// writes to the cart. It carries no styles of its own; the page owns the buybox_*
// rules in its <style is:global>, so this stays pure markup bound to the store.

interface Size {
  id: number;
  label: string;
}

interface Props {
  productId: number;
  slug: string;
  title: string;
  unitPriceRappen: number;
  // Empty for a size-less piece (a cap, one-size) — then there is nothing to
  // choose and the variant's size is null.
  sizes: Size[];
}

export default function BuyBox({
  productId,
  slug,
  title,
  unitPriceRappen,
  sizes,
}: Props) {
  const hasSizes = sizes.length > 0;
  const [sizeId, setSizeId] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  // A size-less piece is always ready; a sized one needs a chosen size first, so
  // the button can't add a line the checkout would reject for a missing size.
  const canAdd = !hasSizes || sizeId !== null;

  function add() {
    if (!canAdd) return;
    const size = sizes.find((s) => s.id === sizeId);
    addToCart(
      {
        product_id: productId,
        size_id: hasSizes ? sizeId : null,
        slug,
        title,
        unit_price_rappen: unitPriceRappen,
        size_label: size?.label ?? null,
      },
      qty,
    );
    setAdded(true);
    // A brief confirmation, then back to the resting label — the nav count is the
    // durable signal that the piece landed in the cart.
    window.setTimeout(() => setAdded(false), 1800);
  }

  return (
    <div class="buybox">
      {hasSizes && (
        <div class="buybox_field">
          <span class="buybox_label" id={`size-label-${productId}`}>
            Size
          </span>
          <div
            class="buybox_sizes"
            role="group"
            aria-labelledby={`size-label-${productId}`}
          >
            {sizes.map((size) => (
              <button
                key={size.id}
                type="button"
                class={`buybox_size${size.id === sizeId ? " is-selected" : ""}`}
                aria-pressed={size.id === sizeId}
                onClick={() => setSizeId(size.id)}
              >
                {size.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div class="buybox_field">
        <span class="buybox_label" id={`qty-label-${productId}`}>
          Quantity
        </span>
        <div
          class="buybox_qty"
          role="group"
          aria-labelledby={`qty-label-${productId}`}
        >
          <button
            type="button"
            class="buybox_step"
            aria-label="Decrease quantity"
            disabled={qty <= 1}
            onClick={() => setQty((n) => Math.max(1, n - 1))}
          >
            −
          </button>
          <span class="buybox_qty-value" aria-live="polite">
            {qty}
          </span>
          <button
            type="button"
            class="buybox_step"
            aria-label="Increase quantity"
            disabled={qty >= MAX_LINE_QTY}
            onClick={() => setQty((n) => Math.min(MAX_LINE_QTY, n + 1))}
          >
            +
          </button>
        </div>
      </div>

      <button
        type="button"
        class="buybox_add"
        disabled={!canAdd}
        onClick={add}
      >
        {added ? "Added to cart ✓" : "Add to cart"}
      </button>

      {hasSizes && !canAdd && (
        <p class="buybox_hint">Select a size to add this piece.</p>
      )}
    </div>
  );
}
