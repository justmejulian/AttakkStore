import { useStore } from "@nanostores/preact";
import { cartCount } from "@/lib/cart.ts";

// The nav's cart tally, the one piece of the header that has to be live: a Preact
// island bound to the cart store, so adding a piece anywhere updates every copy
// of the count at once. Server-rendered as [00] (the cart starts empty), then
// hydrated from localStorage — the same bracketed, zero-padded shape the static
// placeholder had, so the nav does not shift when it wakes up.
export default function CartCount() {
  const count = useStore(cartCount);
  return <span class="nav_count">[{String(count).padStart(2, "0")}]</span>;
}
