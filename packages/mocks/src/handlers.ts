import {
  cartInput,
  type CartQuote,
  adminActiveInput,
  adminUserCreateInput,
  dropInput,
  dropStatusInput,
  loginInput,
  ORDER_STATUSES,
  orderInput,
  orderNoteInput,
  orderStatusInput,
  productCreateInput,
  productInput,
  productSizesInput,
  settingsInput,
} from "@attakk/types";
import { http, HttpResponse } from "msw";
import { adminCredentials, adminUser, uploadedImage } from "./fixtures.js";
import * as store from "./state.js";

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

// Mirror of the API's per-line pricing check: the OrderError code a line would
// raise, or null when it is sellable. Kept in step with apps/api priceLine, and
// read off the store, so a drop archived or a size removed through the admin
// changes what the shop is allowed to buy.
function lineRejection(line: {
  product_id: number;
  size_id: number | null;
}): string | null {
  const sizes = store.purchasableSizes().get(line.product_id);
  if (!sizes) return "product_unavailable";
  if (sizes.size > 0) {
    if (line.size_id === null) return "size_required";
    if (!sizes.has(line.size_id)) return "size_invalid";
  } else if (line.size_id !== null) {
    return "size_not_allowed";
  }
  return null;
}

function isOrderStatus(value: string): boolean {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

export const handlers = [
  http.post("*/cart/quote", async ({ request }) => {
    const parsed = cartInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return HttpResponse.json({ error: "invalid" }, { status: 400 });
    }
    for (const line of parsed.data.items) {
      const error = lineRejection(line);
      if (error) return HttpResponse.json({ error }, { status: 422 });
    }
    const items = parsed.data.items.map((line) => {
      const product = store.productById(line.product_id)!;
      return {
        ...line,
        title: product.name,
        unit_price_rappen: product.price_rappen,
        line_total_rappen: product.price_rappen * line.qty,
      };
    });
    return HttpResponse.json({
      items,
      total_rappen: items.reduce(
        (sum, line) => sum + line.line_total_rappen,
        0,
      ),
    } satisfies CartQuote);
  }),
  // Registered before */drops for the same MSW *-wildcard reason as admin
  // products: without it, /admin/drops would match */drops and return the live
  // collections. The real API distinguishes the literal prefixes.
  http.get("*/admin/drops", () => HttpResponse.json(store.dropRows())),

  // Create a drop. The real zod does the shape check, so a bad body is a 400; then
  // a slug already in use is a 409, the same codes the API gives. On success a
  // synthesized row (fresh id) comes back 201.
  http.post("*/admin/drops", async ({ request }) => {
    const parsed = dropInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return HttpResponse.json({ error: "invalid" }, { status: 400 });
    }
    if (store.dropSlugTaken(parsed.data.slug)) {
      return HttpResponse.json({ error: "slug_taken" }, { status: 409 });
    }
    return HttpResponse.json(store.createDrop(parsed.data), { status: 201 });
  }),

  // The admin's drop detail, keyed off the fixtures by id. Registered before
  // */drops/:slug for the same *-wildcard reason as the list: without it,
  // /admin/drops/1 would match */drops/:slug (slug "1") and 404.
  http.get("*/admin/drops/:id", ({ params }) => {
    const drop = store.dropRowById(Number(params.id));
    return drop
      ? HttpResponse.json(drop)
      : HttpResponse.json({ error: "not_found" }, { status: 404 });
  }),

  // Edit a drop. A missing drop is a 404, a bad body a 400, a slug taken by a
  // DIFFERENT drop a 409 — re-saving a drop with its own slug is fine.
  http.patch("*/admin/drops/:id", async ({ params, request }) => {
    const id = Number(params.id);
    if (!store.dropExists(id)) {
      return HttpResponse.json({ error: "not_found" }, { status: 404 });
    }
    const parsed = dropInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return HttpResponse.json({ error: "invalid" }, { status: 400 });
    }
    if (store.dropSlugTaken(parsed.data.slug, id)) {
      return HttpResponse.json({ error: "slug_taken" }, { status: 409 });
    }
    return HttpResponse.json(store.updateDrop(id, parsed.data));
  }),

  // The archive control: flip a drop's status. A missing drop is a 404, a bad
  // status a 400; on success the drop comes back with the new status, the same as
  // the API. Registered with the other admin/drops writes, before */drops/:slug.
  http.patch("*/admin/drops/:id/status", async ({ params, request }) => {
    const id = Number(params.id);
    if (!store.dropExists(id)) {
      return HttpResponse.json({ error: "not_found" }, { status: 404 });
    }
    const parsed = dropStatusInput.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return HttpResponse.json({ error: "invalid" }, { status: 400 });
    }
    return HttpResponse.json(store.setDropStatus(id, parsed.data.status));
  }),

  http.get("*/drops", () => HttpResponse.json(store.dropsByStatus("live"))),

  http.get("*/archive", () =>
    HttpResponse.json(store.dropsByStatus("archived")),
  ),

  http.get("*/drops/:slug", ({ params }) => {
    const drop = store.dropBySlug(String(params.slug));
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
  http.get("*/admin/products", () =>
    HttpResponse.json(store.adminProductRows()),
  ),

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
    if (!store.dropExists(parsed.data.drop_id)) {
      return HttpResponse.json({ error: "drop_not_found" }, { status: 422 });
    }
    if (store.productSlugTaken(parsed.data.slug)) {
      return HttpResponse.json({ error: "slug_taken" }, { status: 409 });
    }
    return HttpResponse.json(store.createProduct(parsed.data), { status: 201 });
  }),

  http.get("*/admin/products/:id", ({ params }) => {
    const product = store.productById(Number(params.id));
    return product
      ? HttpResponse.json(product)
      : HttpResponse.json({ error: "not_found" }, { status: 404 });
  }),

  // Edit a product. A missing product is a 404, a bad body a 400, a slug taken by
  // a DIFFERENT product a 409 — re-saving a product with its own slug is fine.
  http.patch("*/admin/products/:id", async ({ params, request }) => {
    const id = Number(params.id);
    if (!store.productById(id)) {
      return HttpResponse.json({ error: "not_found" }, { status: 404 });
    }
    const parsed = productInput.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return HttpResponse.json({ error: "invalid" }, { status: 400 });
    }
    if (store.productSlugTaken(parsed.data.slug, id)) {
      return HttpResponse.json({ error: "slug_taken" }, { status: 409 });
    }
    return HttpResponse.json(store.updateProduct(id, parsed.data));
  }),

  // Replace a product's sizes. Missing product 404, bad body 400; a desired size
  // whose id is not on the product is a 422 unknown_size, and dropping a size an
  // order references is a 409 size_in_use — the API's reconcile guards. On success
  // the product comes back with the reconciled sizes (new ones get synthetic ids).
  http.put("*/admin/products/:id/sizes", async ({ params, request }) => {
    const product = store.productById(Number(params.id));
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
    const inUse = store.sizesInUse();
    const removedInUse = product.sizes.some(
      (s) => !keptIds.has(s.id) && inUse.has(`${product.id}:${s.id}`),
    );
    if (removedInUse) {
      return HttpResponse.json({ error: "size_in_use" }, { status: 409 });
    }
    return HttpResponse.json(
      store.setProductSizes(product.id, parsed.data.sizes),
    );
  }),

  // Delete a product. Missing is a 404; a product an order references is a 409
  // has_orders (hide it instead), the same refusal the API gives. Otherwise 204.
  http.delete("*/admin/products/:id", ({ params }) => {
    const id = Number(params.id);
    if (!store.productById(id)) {
      return HttpResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (store.productHasOrders(id)) {
      return HttpResponse.json({ error: "has_orders" }, { status: 409 });
    }
    store.deleteProduct(id);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get("*/products/:slug", ({ params }) => {
    const product = store.productWithDropBySlug(String(params.slug));
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
    return HttpResponse.json(store.createOrder(parsed.data), { status: 201 });
  }),

  // The admin's image writes. The processing and the content hash are the API's,
  // so the mock reuses one stored row's bytes for whatever is uploaded; what it
  // keeps is the row, at the end of the product's gallery. An unknown product or
  // image is the same 404 the API gives.
  http.post("*/products/:id/images", async ({ params, request }) => {
    const body = await request.formData().catch(() => null);
    const alt = body?.get("alt");
    const { id: _id, sort: _sort, ...bytes } = uploadedImage;
    void _id;
    void _sort;
    const image = store.addProductImage(Number(params.id), {
      ...bytes,
      alt: typeof alt === "string" ? alt : "",
    });
    return image
      ? HttpResponse.json(image, { status: 201 })
      : HttpResponse.json({ error: "not_found" }, { status: 404 });
  }),

  http.delete("*/images/:id", ({ params }) =>
    store.deleteProductImage(Number(params.id))
      ? new HttpResponse(null, { status: 204 })
      : HttpResponse.json({ error: "not_found" }, { status: 404 }),
  ),

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
    const rows = store.orderListRows();
    return HttpResponse.json(
      status ? rows.filter((o) => o.status === status) : rows,
    );
  }),

  http.get("*/admin/orders/:id", ({ params }) => {
    const order = store.orderById(Number(params.id));
    return order
      ? HttpResponse.json(order)
      : HttpResponse.json({ error: "not_found" }, { status: 404 });
  }),

  // Kept after the admin detail matcher: both paths end in /orders/:value, and
  // MSW resolves wildcard handlers in declaration order.
  http.get("*/orders/:reference", ({ params, request }) => {
    const token = new URL(request.url).searchParams.get("token");
    const receipt = store.receiptFor(String(params.reference), token);
    return receipt
      ? HttpResponse.json(receipt)
      : HttpResponse.json({ error: "not_found" }, { status: 404 });
  }),

  // Mark paid/cancelled/pending. Setting paid stamps paid_at, any other status
  // clears it — the API stamps the real time, the mock a fixed one, but the
  // shape and the paid/not-paid distinction match.
  http.patch("*/admin/orders/:id/status", async ({ params, request }) => {
    const id = Number(params.id);
    if (!store.orderById(id))
      return HttpResponse.json({ error: "not_found" }, { status: 404 });
    const parsed = orderStatusInput.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return HttpResponse.json({ error: "invalid" }, { status: 400 });
    }
    return HttpResponse.json(store.setOrderStatus(id, parsed.data.status));
  }),

  http.patch("*/admin/orders/:id/note", async ({ params, request }) => {
    const id = Number(params.id);
    if (!store.orderById(id))
      return HttpResponse.json({ error: "not_found" }, { status: 404 });
    const parsed = orderNoteInput.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return HttpResponse.json({ error: "invalid" }, { status: 400 });
    }
    return HttpResponse.json(store.setOrderNote(id, parsed.data.note));
  }),

  // Resend the QR bill. The send is the API's side effect; the mock just answers
  // the same 202-queued the moment the order is found.
  http.post("*/admin/orders/:id/resend", ({ params }) => {
    const order = store.orderById(Number(params.id));
    if (!order)
      return HttpResponse.json({ error: "not_found" }, { status: 404 });
    return HttpResponse.json({ status: "queued" }, { status: 202 });
  }),

  // The Settings screen: read the whole object, or save it. The PUT validates
  // with the real settingsInput so a bad IBAN or email is a 400 exactly as the
  // API rejects it, and echoes the normalised result back like the API's re-read.
  http.get("*/admin/settings", () =>
    HttpResponse.json(store.currentSettings()),
  ),
  http.put("*/admin/settings", async ({ request }) => {
    const parsed = settingsInput.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return HttpResponse.json(
        { error: "invalid", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    return HttpResponse.json(store.saveSettings(parsed.data));
  }),

  // The Users screen: list admins, create one, deactivate or restore one. Create
  // validates with the real adminUserCreateInput, so a too-short password or blank
  // username is a 400 exactly as the API rejects it, and a taken username a 409;
  // the new row carries a synthetic id. Deactivate/restore keys off the fixtures
  // by id, 404s an unknown one, and refuses to switch off the last active admin
  // with the same last_admin 409 the API's guard returns.
  http.get("*/admin/users", () => HttpResponse.json(store.adminUserList())),

  http.post("*/admin/users", async ({ request }) => {
    const parsed = adminUserCreateInput.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return HttpResponse.json(
        { error: "invalid", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    if (store.adminUsernameTaken(parsed.data.username)) {
      return HttpResponse.json({ error: "username_taken" }, { status: 409 });
    }
    return HttpResponse.json(store.createAdminUser(parsed.data.username), {
      status: 201,
    });
  }),

  http.patch("*/admin/users/:id/active", async ({ params, request }) => {
    const id = Number(params.id);
    const user = store.adminUserById(id);
    if (!user)
      return HttpResponse.json({ error: "not_found" }, { status: 404 });
    const parsed = adminActiveInput.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return HttpResponse.json({ error: "invalid" }, { status: 400 });
    }
    const { active } = parsed.data;
    if (!active && user.active === 1 && store.activeAdminCount() <= 1) {
      return HttpResponse.json({ error: "last_admin" }, { status: 409 });
    }
    return HttpResponse.json(store.setAdminUserActive(id, active));
  }),
];
