import {
  loginInput,
  ORDER_STATUSES,
  orderInput,
  orderNoteInput,
  orderStatusInput,
  productCreateInput,
  productInput,
  productSizesInput,
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

// The drops a product can be created into, and the slugs already in use — the
// two things the create/edit handlers check, mirroring the API's drop-exists and
// slug-unique guards. The mock is stateless, so these are the seeded fixtures.
const dropIds = new Set(allDrops.map((d) => d.id));
const productSlugs = new Set(
  allDrops.flatMap((d) => d.products).map((p) => p.slug),
);

// The id a created product comes back with. The API assigns the next rowid; the
// mock is stateless, so it returns this fixed, obviously-synthetic id instead,
// distinct from any seeded product's.
const MOCK_NEW_PRODUCT_ID = 900;

// The base id newly-inserted sizes come back with, for the same stateless reason.
const MOCK_NEW_SIZE_ID = 950;

// The (product, size) pairs an order line references, so the size reconcile can
// refuse to drop a size still in use — mirroring the API, which counts a size in
// use regardless of the order's status (a cancelled order still records it).
const sizesInUse = new Set(
  allOrders.flatMap((o) =>
    o.items.flatMap((i) =>
      i.size_id === null ? [] : [`${i.product_id}:${i.size_id}`],
    ),
  ),
);

// The products at least one order references, so the delete handler can refuse
// them (409 has_orders) the way the API does — an order line pins the product,
// which must be hidden rather than deleted.
const productsWithOrders = new Set(
  allOrders.flatMap((o) => o.items.map((i) => i.product_id)),
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

  // Create a product. The real zod does the shape check, so a bad body is a 400;
  // then a drop that does not exist is a 422 and a slug already in use a 409, the
  // same codes the API gives. On success a synthesized row (fresh id, empty sizes
  // and images) comes back 201.
  http.post("*/admin/products", async ({ request }) => {
    const parsed = productCreateInput.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return HttpResponse.json({ error: "invalid" }, { status: 400 });
    }
    if (!dropIds.has(parsed.data.drop_id)) {
      return HttpResponse.json({ error: "drop_not_found" }, { status: 422 });
    }
    if (productSlugs.has(parsed.data.slug)) {
      return HttpResponse.json({ error: "slug_taken" }, { status: 409 });
    }
    return HttpResponse.json(
      { id: MOCK_NEW_PRODUCT_ID, ...parsed.data, sizes: [], images: [] },
      { status: 201 },
    );
  }),

  http.get("*/admin/products/:id", ({ params }) => {
    const product = productsById.get(Number(params.id));
    return product
      ? HttpResponse.json(product)
      : HttpResponse.json({ error: "not_found" }, { status: 404 });
  }),

  // Edit a product. A missing product is a 404, a bad body a 400, a slug taken by
  // a DIFFERENT product a 409 — re-saving a product with its own slug is fine.
  http.patch("*/admin/products/:id", async ({ params, request }) => {
    const product = productsById.get(Number(params.id));
    if (!product) {
      return HttpResponse.json({ error: "not_found" }, { status: 404 });
    }
    const parsed = productInput.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return HttpResponse.json({ error: "invalid" }, { status: 400 });
    }
    const clash = [...productsById.values()].some(
      (p) => p.id !== product.id && p.slug === parsed.data.slug,
    );
    if (clash) {
      return HttpResponse.json({ error: "slug_taken" }, { status: 409 });
    }
    return HttpResponse.json({ ...product, ...parsed.data });
  }),

  // Replace a product's sizes. Missing product 404, bad body 400; a desired size
  // whose id is not on the product is a 422 unknown_size, and dropping a size an
  // order references is a 409 size_in_use — the API's reconcile guards. On success
  // the product comes back with the reconciled sizes (new ones get synthetic ids).
  http.put("*/admin/products/:id/sizes", async ({ params, request }) => {
    const product = productsById.get(Number(params.id));
    if (!product) {
      return HttpResponse.json({ error: "not_found" }, { status: 404 });
    }
    const parsed = productSizesInput.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return HttpResponse.json({ error: "invalid" }, { status: 400 });
    }
    const currentIds = new Set(product.sizes.map((s) => s.id));
    if (
      parsed.data.sizes.some((s) => s.id !== undefined && !currentIds.has(s.id))
    ) {
      return HttpResponse.json({ error: "unknown_size" }, { status: 422 });
    }
    const keptIds = new Set(
      parsed.data.sizes.flatMap((s) => (s.id === undefined ? [] : [s.id])),
    );
    const removedInUse = product.sizes.some(
      (s) => !keptIds.has(s.id) && sizesInUse.has(`${product.id}:${s.id}`),
    );
    if (removedInUse) {
      return HttpResponse.json({ error: "size_in_use" }, { status: 409 });
    }
    let nextId = MOCK_NEW_SIZE_ID;
    const sizes = parsed.data.sizes.map((s) => ({
      id: s.id ?? nextId++,
      label: s.label,
      sort: s.sort,
    }));
    return HttpResponse.json({ ...product, sizes });
  }),

  // Delete a product. Missing is a 404; a product an order references is a 409
  // has_orders (hide it instead), the same refusal the API gives. Otherwise 204.
  http.delete("*/admin/products/:id", ({ params }) => {
    const product = productsById.get(Number(params.id));
    if (!product) {
      return HttpResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (productsWithOrders.has(product.id)) {
      return HttpResponse.json({ error: "has_orders" }, { status: 409 });
    }
    return new HttpResponse(null, { status: 204 });
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
