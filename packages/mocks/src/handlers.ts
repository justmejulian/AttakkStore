import { orderInput } from "@attakk/types";
import { http, HttpResponse } from "msw";
import {
  createdOrder,
  liveDrops,
  originsDrop,
  redlineDrop,
  uploadedImage,
} from "./fixtures.js";

// The MSW handlers the shop and admin register through setupServer, so their
// code calls fetch exactly as in production and is answered by the fixtures
// rather than a running API. Paths are matched with a `*` origin so a handler
// binds to /drops on whatever host the consumer points at, without this package
// knowing the API's URL.
//
// The route surface mirrors the API: the catalogue reads, the order write with
// its rejections, and the admin's image writes. Responses come straight from
// fixtures, so what the shop sees in development is what the API's contract test
// proves the real routes return.

// The purchasable products and each one's size ids, taken from the live drop —
// an archived drop's pieces are deliberately absent. The order handler prices a
// line against this the way the API's priceLine does, so the mock returns the
// same 422 the API would for an unsellable product or a wrong/missing size.
const purchasable = new Map(
  redlineDrop.products.map(
    (p) => [p.id, new Set(p.sizes.map((s) => s.id))] as const,
  ),
);

// Mirror of the API's per-line pricing check: the OrderError code a line would
// raise, or null when it is sellable. Kept in step with apps/api priceLine.
function lineRejection(line: {
  product_id: number;
  size_id: number | null;
}): string | null {
  const sizes = purchasable.get(line.product_id);
  if (!sizes) return "product_unavailable";
  if (sizes.size > 0) {
    if (line.size_id === null) return "size_required";
    if (!sizes.has(line.size_id)) return "size_invalid";
  } else if (line.size_id !== null) {
    return "size_not_allowed";
  }
  return null;
}

// One drop, by slug — live or archived, mirroring the API's live-or-archived
// read. Anything else is the 404 the shop routes to its not-found page.
const dropsBySlug = new Map(
  [redlineDrop, originsDrop].map((d) => [d.slug, d] as const),
);
const productsBySlug = new Map(
  [redlineDrop, originsDrop]
    .flatMap((d) => d.products)
    .map((p) => [p.slug, p] as const),
);

export const handlers = [
  http.get("*/drops", () => HttpResponse.json(liveDrops)),

  http.get("*/drops/:slug", ({ params }) => {
    const drop = dropsBySlug.get(String(params.slug));
    return drop
      ? HttpResponse.json(drop)
      : HttpResponse.json({ error: "not_found" }, { status: 404 });
  }),

  http.get("*/products/:slug", ({ params }) => {
    const product = productsBySlug.get(String(params.slug));
    return product
      ? HttpResponse.json(product)
      : HttpResponse.json({ error: "not_found" }, { status: 404 });
  }),

  // The one write the shop makes. The real zod schema does the shape branching,
  // so a malformed or duplicate-variant cart is a 400 here for the same reason
  // it is at the API; then each line is priced against the fixtures the way the
  // API prices against its table, so an unsellable product or a wrong/missing
  // size comes back as the same 422 with the same code.
  http.post("*/orders", async ({ request }) => {
    const parsed = orderInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return HttpResponse.json({ error: "invalid" }, { status: 400 });
    }
    for (const line of parsed.data.items) {
      const code = lineRejection(line);
      if (code) return HttpResponse.json({ error: code }, { status: 422 });
    }
    return HttpResponse.json(createdOrder, { status: 201 });
  }),

  // The admin's image writes. The processing and content-hash bookkeeping are
  // the API's; the mock just returns a stored row and an empty 204.
  http.post("*/products/:id/images", () =>
    HttpResponse.json(uploadedImage, { status: 201 }),
  ),

  http.delete("*/images/:id", () => new HttpResponse(null, { status: 204 })),
];
