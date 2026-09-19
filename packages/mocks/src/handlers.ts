import {
  loginInput,
  ORDER_STATUSES,
  orderInput,
  orderNoteInput,
  orderStatusInput,
} from "@attakk/types";
import { http, HttpResponse } from "msw";
import {
  adminCredentials,
  adminProducts,
  adminUser,
  allDrops,
  allOrders,
  createdOrder,
  liveDrops,
  orderListRows,
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
// read. Anything else is the 404 the shop routes to its not-found page. Both maps
// key off allDrops so "every drop" is spelled once; adding a fixture drop reaches
// the slug reads without touching this.
const dropsBySlug = new Map(allDrops.map((d) => [d.slug, d] as const));
const productsBySlug = new Map(
  allDrops.flatMap((d) => d.products).map((p) => [p.slug, p] as const),
);

// Stored orders by id, for the admin's detail, status and note handlers. The
// list is the same rows without their items (orderListRows).
const ordersById = new Map(allOrders.map((o) => [o.id, o] as const));

// Every product by id — the full ProductWithSizes, for the admin's edit-form
// read. The list (adminProducts) is the flat, drop-annotated projection.
const productsById = new Map(
  allDrops.flatMap((d) => d.products).map((p) => [p.id, p] as const),
);

function isOrderStatus(value: string): boolean {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

// The paid_at the status handler stamps when a not-yet-paid order is marked paid.
// The API stamps the real time; the mock is stateless, so it returns this fixed,
// obviously-synthetic value instead — distinct from any fixture's own paid_at.
const MOCK_PAID_STAMP = "2026-01-05T00:00:00.000Z";

export const handlers = [
  http.get("*/drops", () => HttpResponse.json(liveDrops)),

  http.get("*/drops/:slug", ({ params }) => {
    const drop = dropsBySlug.get(String(params.slug));
    return drop
      ? HttpResponse.json(drop)
      : HttpResponse.json({ error: "not_found" }, { status: 404 });
  }),

  // The admin's product screens. Registered before the storefront's
  // `*/products/:slug` read because MSW matches in order with a `*`-wildcard
  // origin: without this, `/admin/products/10` would match `*/products/:slug`
  // (slug "10") and 404. The real API has no such collision — Hono matches the
  // literal `/admin/products` and `/products` prefixes distinctly. The list is
  // every product grouped by drop with its ordered-units tally; the detail is the
  // full product with its sizes and images, keyed off the fixtures by id.
  http.get("*/admin/products", () => HttpResponse.json(adminProducts)),

  http.get("*/admin/products/:id", ({ params }) => {
    const product = productsById.get(Number(params.id));
    return product
      ? HttpResponse.json(product)
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

  // The admin's login. The real zod schema does the shape check, so a malformed
  // body is a 400 here for the same reason it is at the API; a matching username
  // and password return the user, anything else the same 401 the API gives — the
  // API verifies a scrypt hash, the mock a fixed pair, but the answers agree.
  http.post("*/admin/login", async ({ request }) => {
    const parsed = loginInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return HttpResponse.json({ error: "invalid" }, { status: 400 });
    }
    const { username, password } = parsed.data;
    if (
      username === adminCredentials.username &&
      password === adminCredentials.password
    ) {
      return HttpResponse.json(adminUser);
    }
    return HttpResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }),

  // The admin's order screens. The list is the bare rows, newest first, narrowed
  // by an optional status; an unknown status is a 400, the same as the API. The
  // detail, status and note handlers key off the fixture orders by id.
  http.get("*/admin/orders", ({ request }) => {
    const status = new URL(request.url).searchParams.get("status");
    if (status !== null && !isOrderStatus(status)) {
      return HttpResponse.json({ error: "invalid_status" }, { status: 400 });
    }
    const rows = status
      ? orderListRows.filter((o) => o.status === status)
      : orderListRows;
    return HttpResponse.json(rows);
  }),

  http.get("*/admin/orders/:id", ({ params }) => {
    const order = ordersById.get(Number(params.id));
    return order
      ? HttpResponse.json(order)
      : HttpResponse.json({ error: "not_found" }, { status: 404 });
  }),

  // Mark paid/cancelled/pending. Setting paid stamps paid_at, any other status
  // clears it — the API stamps the real time, the mock a fixed one, but the
  // shape and the paid/not-paid distinction match.
  http.patch("*/admin/orders/:id/status", async ({ params, request }) => {
    const order = ordersById.get(Number(params.id));
    if (!order)
      return HttpResponse.json({ error: "not_found" }, { status: 404 });
    const parsed = orderStatusInput.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return HttpResponse.json({ error: "invalid" }, { status: 400 });
    }
    const { status } = parsed.data;
    const paid_at =
      status === "paid" ? (order.paid_at ?? MOCK_PAID_STAMP) : null;
    return HttpResponse.json({ ...order, status, paid_at });
  }),

  http.patch("*/admin/orders/:id/note", async ({ params, request }) => {
    const order = ordersById.get(Number(params.id));
    if (!order)
      return HttpResponse.json({ error: "not_found" }, { status: 404 });
    const parsed = orderNoteInput.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return HttpResponse.json({ error: "invalid" }, { status: 400 });
    }
    return HttpResponse.json({ ...order, note: parsed.data.note });
  }),

  // Resend the QR bill. The send is the API's side effect; the mock just answers
  // the same 202-queued the moment the order is found.
  http.post("*/admin/orders/:id/resend", ({ params }) => {
    const order = ordersById.get(Number(params.id));
    if (!order)
      return HttpResponse.json({ error: "not_found" }, { status: 404 });
    return HttpResponse.json({ status: "queued" }, { status: 202 });
  }),
];
