import {
  adminUserCreateInput,
  dropInput,
  dropStatusInput,
  loginInput,
  MAX_NOTE_LEN,
  ORDER_STATUSES,
  orderNoteInput,
  orderStatusInput,
  productCreateInput,
  productInput,
  productSizesInput,
  settingsInput,
  type AdminProductRow,
  type AdminUser,
  type Drop,
  type OrderListRow,
  type OrderStatus,
  type OrderWithItems,
  type Product,
  type ProductWithSizes,
  type Settings,
} from "@attakk/types";
import { type Context, Hono } from "hono";
import { apiFetch, jsonBody } from "./api.js";
import { type AdminEnv, requireAuth } from "./auth.js";
import { ordersToCsv } from "./csv.js";
import { clearSession, getSession, setSession } from "./session.js";
import {
  type DropFormValues,
  dropEditPage,
  dropNewPage,
  dropsPage,
  homePage,
  loginPage,
  notFoundPage,
  orderDetailPage,
  ordersPage,
  productEditPage,
  type ProductFormValues,
  productNewPage,
  productsPage,
  serviceErrorPage,
  type NewSizeValues,
  type SettingsFormValues,
  settingsPage,
  type SizeRowValues,
  usersPage,
} from "./views.js";

// Whether an API response body carries the identity a session needs. Only id and
// username are read, so only those are required — the same shape check getSession
// applies to the cookie, so a drifted API body cannot open an empty session.
function hasIdentity(
  value: unknown,
): value is Pick<AdminUser, "id" | "username"> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AdminUser).id === "number" &&
    typeof (value as AdminUser).username === "string"
  );
}

// The admin's Hono app, built here and served by index.ts. Kept separate from
// the entry point so the routes can be driven with app.request in tests without
// binding a port.
export const app = new Hono<AdminEnv>();

// ---------------------------------------------------------------- public

// Liveness probe. Since every admin screen depends on the API, the check also
// reports whether the API is reachable over the internal network, so a broken
// link between the two shows up here rather than as a blank screen later.
app.get("/health", async (c) => {
  let api: "ok" | "unreachable" = "unreachable";
  try {
    const res = await apiFetch("/health");
    if (res.ok) api = "ok";
  } catch {
    // API not up yet — reported as unreachable below, never thrown.
  }
  return c.json({ status: "ok", service: "admin", api });
});

// The login form. Already signed in? Skip it.
app.get("/login", async (c) => {
  if (await getSession(c)) return c.redirect("/");
  return c.html(loginPage());
});

// Verify the credentials against the API and, on success, open a session. The
// admin holds no database, so the API is the only place the password is checked;
// this route turns its yes/no into a session cookie. A failed API check, a
// malformed form and an unreachable API all re-render the form with a message
// rather than leaking which of the three it was.
app.post("/login", async (c) => {
  const form = await c.req.parseBody();
  const username = typeof form.username === "string" ? form.username : "";
  const parsed = loginInput.safeParse({ username, password: form.password });
  if (!parsed.success) {
    return c.html(
      loginPage({ error: "Enter a username and password.", username }),
      400,
    );
  }

  // The API being down, timing out, erroring, or answering with something that
  // is not a user are all one thing to the operator: a service problem, not a
  // wrong password. They report it at 502 rather than sending someone to reset a
  // password that is fine.
  const serviceError = () =>
    c.html(
      loginPage({
        error: "The service is unavailable. Try again in a moment.",
        username: parsed.data.username,
      }),
      502,
    );

  let res: Response;
  try {
    res = await apiFetch("/admin/login", jsonBody("POST", parsed.data));
  } catch {
    return serviceError();
  }

  // Only a 401 is a credential failure; any other non-2xx is the API in trouble.
  if (res.status === 401) {
    return c.html(
      loginPage({
        error: "Those credentials did not work.",
        username: parsed.data.username,
      }),
      401,
    );
  }
  if (!res.ok) return serviceError();

  const body: unknown = await res.json().catch(() => null);
  if (!hasIdentity(body)) return serviceError();

  await setSession(c, { id: body.id, username: body.username });
  return c.redirect("/");
});

// Drop the session. Reached by a POST so a stray link or prefetch can never sign
// someone out; clearing an absent cookie is harmless, so no session is required.
app.post("/logout", (c) => {
  clearSession(c);
  return c.redirect("/login");
});

// -------------------------------------------------------------- protected

// Everything past here needs a valid session. Registering the gate after the
// public routes means those return before it runs, while every route below —
// and every screen added in later steps — is behind it.
app.use(requireAuth);

app.get("/", (c) => c.html(homePage(c.get("user"))));

// A single call to the API from a protected screen, with the two failure screens
// every one of them shares already resolved: the API being unreachable or 5xx is
// the service page (502), a 404 is the not-found page, and anything ok comes back
// as the Response for the route to read. Keeps each order route to its own logic
// rather than repeating the same try/catch and status ladder.
async function apiRequest(
  c: Context<AdminEnv>,
  path: string,
  init?: RequestInit,
): Promise<{ res: Response } | { errorPage: Response }> {
  const user = c.get("user");
  let res: Response;
  try {
    res = await apiFetch(path, init);
  } catch {
    return { errorPage: await c.html(serviceErrorPage(user), 502) };
  }
  if (res.status === 404) {
    return { errorPage: await c.html(notFoundPage(user), 404) };
  }
  if (!res.ok) return { errorPage: await c.html(serviceErrorPage(user), 502) };
  return { res };
}

// An unknown status in the query is ignored (the list shows all) rather than
// passed to the API, which would 400 it — the filter links only ever produce a
// real status, so a junk one is a hand-edited URL, not an error to surface.
function parseStatus(raw: string | undefined): OrderStatus | undefined {
  return raw && (ORDER_STATUSES as readonly string[]).includes(raw)
    ? (raw as OrderStatus)
    : undefined;
}

function ordersPath(status: OrderStatus | undefined): string {
  return status ? `/admin/orders?status=${status}` : "/admin/orders";
}

// The list read both the list screen and the CSV export need: the orders for the
// current filter, or the shared error page when the API is unreachable.
async function loadOrders(
  c: Context<AdminEnv>,
  status: OrderStatus | undefined,
): Promise<{ orders: OrderListRow[] } | { errorPage: Response }> {
  const r = await apiRequest(c, ordersPath(status));
  if ("errorPage" in r) return r;
  return { orders: (await r.res.json()) as OrderListRow[] };
}

// The API path for one order. The id comes from the URL, so it is encoded before
// being spliced in — a crafted segment must not leak into the API's path or query.
function orderPath(id: string, suffix = ""): string {
  return `/admin/orders/${encodeURIComponent(id)}${suffix}`;
}

app.get("/orders", async (c) => {
  const status = parseStatus(c.req.query("status"));
  const r = await loadOrders(c, status);
  if ("errorPage" in r) return r.errorPage;
  return c.html(ordersPage({ user: c.get("user"), orders: r.orders, status }));
});

app.get("/orders.csv", async (c) => {
  const status = parseStatus(c.req.query("status"));
  const r = await loadOrders(c, status);
  if ("errorPage" in r) return r.errorPage;
  c.header("content-type", "text/csv; charset=utf-8");
  c.header("content-disposition", 'attachment; filename="orders.csv"');
  return c.body(ordersToCsv(r.orders));
});

app.get("/orders/:id", async (c) => {
  const r = await apiRequest(c, orderPath(c.req.param("id")));
  if ("errorPage" in r) return r.errorPage;
  const order = (await r.res.json()) as OrderWithItems;
  const flash = c.req.query("sent")
    ? "The confirmation email has been resent."
    : undefined;
  return c.html(orderDetailPage({ user: c.get("user"), order, flash }));
});

// Mark paid / cancelled / pending. The form's button carries the target status;
// a body the shared schema rejects means a tampered form, so it bounces back to
// the order rather than erroring. On success, redirect to the order (POST-then-
// redirect) so a refresh doesn't re-submit.
app.post("/orders/:id/status", async (c) => {
  const id = c.req.param("id");
  const form = await c.req.parseBody();
  const parsed = orderStatusInput.safeParse({ status: form.status });
  if (!parsed.success) return c.redirect(`/orders/${id}`);
  const r = await apiRequest(
    c,
    orderPath(id, "/status"),
    jsonBody("PATCH", parsed.data),
  );
  if ("errorPage" in r) return r.errorPage;
  return c.redirect(`/orders/${id}`);
});

app.post("/orders/:id/note", async (c) => {
  const id = c.req.param("id");
  const form = await c.req.parseBody();
  const note = typeof form.note === "string" ? form.note : "";
  const parsed = orderNoteInput.safeParse({ note });
  if (!parsed.success) {
    // Too long: re-render the order with the typed note kept and an error beside
    // the field, rather than silently dropping what was written.
    const r = await apiRequest(c, orderPath(id));
    if ("errorPage" in r) return r.errorPage;
    const order = (await r.res.json()) as OrderWithItems;
    return c.html(
      orderDetailPage({
        user: c.get("user"),
        order,
        noteError: `Keep the note under ${MAX_NOTE_LEN} characters.`,
        noteValue: note,
      }),
      400,
    );
  }
  const r = await apiRequest(
    c,
    orderPath(id, "/note"),
    jsonBody("PATCH", parsed.data),
  );
  if ("errorPage" in r) return r.errorPage;
  return c.redirect(`/orders/${id}`);
});

app.post("/orders/:id/resend", async (c) => {
  const id = c.req.param("id");
  const r = await apiRequest(c, orderPath(id, "/resend"), { method: "POST" });
  if ("errorPage" in r) return r.errorPage;
  return c.redirect(`/orders/${id}?sent=1`);
});

// ------------------------------------------------------------ product screens

// A write to the API from a product screen. Unlike apiRequest (which folds every
// non-ok into the service page), a product write has expected 4xx the form must
// show — a taken slug, a validation refusal — so those come back as a `conflict`
// with the API's error code, while 404 and 5xx/unreachable are still the shared
// pages. Kept beside apiRequest so each route reads as its own success path.
async function apiWrite(
  c: Context<AdminEnv>,
  path: string,
  init: RequestInit,
): Promise<{ res: Response } | { errorPage: Response } | { conflict: string }> {
  const user = c.get("user");
  let res: Response;
  try {
    res = await apiFetch(path, init);
  } catch {
    return { errorPage: await c.html(serviceErrorPage(user), 502) };
  }
  if (res.ok) return { res };
  if (res.status === 404) {
    return { errorPage: await c.html(notFoundPage(user), 404) };
  }
  if (
    res.status === 400 ||
    res.status === 409 ||
    res.status === 413 ||
    res.status === 422
  ) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    return { conflict: body?.error ?? "invalid" };
  }
  return { errorPage: await c.html(serviceErrorPage(user), 502) };
}

// The API path for one product, with the id encoded before it is spliced in.
function productPath(id: string, suffix = ""): string {
  return `/admin/products/${encodeURIComponent(id)}${suffix}`;
}

const PRODUCT_FIELDS = [
  "slug",
  "name",
  "description",
  "price_rappen",
  "fit",
  "fit_url",
  "min_orders",
  "status",
  "sort",
] as const;

// A parsed form body: hono's parseBody yields string values (and File for a file
// input). Shared by the product and drop form parsers, so named for neither.
type FormBody = Record<string, string | File>;

function formStr(value: string | File | undefined): string {
  return typeof value === "string" ? value : "";
}

// A form value bound for a zod number field: a numeric string becomes a number,
// a blank one becomes undefined (so a required field is rejected and an optional
// one takes its default), and anything else is passed through unchanged so zod
// rejects it with a type error rather than the route silently coercing it.
function formNum(value: string | File | undefined): unknown {
  const s = formStr(value).trim();
  if (s === "") return undefined;
  const n = Number(s);
  return Number.isNaN(n) ? s : n;
}

// The submitted fields as productInput expects them (numbers parsed), for the zod
// check, and — separately — as strings, to echo back into the form on a reject.
function productInputFromForm(form: FormBody): Record<string, unknown> {
  return {
    slug: formStr(form.slug),
    name: formStr(form.name),
    description: formStr(form.description),
    price_rappen: formNum(form.price_rappen),
    fit: formStr(form.fit),
    fit_url: formStr(form.fit_url),
    min_orders: formNum(form.min_orders),
    status: formStr(form.status),
    sort: formNum(form.sort),
  };
}

// The create body: the shared fields plus the drop to create into.
function productCreateInputFromForm(form: FormBody): Record<string, unknown> {
  return { ...productInputFromForm(form), drop_id: formNum(form.drop_id) };
}

function formValues(form: FormBody): ProductFormValues {
  return Object.fromEntries(
    PRODUCT_FIELDS.map((f) => [f, formStr(form[f])]),
  ) as ProductFormValues;
}

// A blank set of field values for a fresh create form, with the sensible defaults
// the schema also carries (a draft, one order, sort 0).
function blankProductValues(): ProductFormValues {
  return {
    slug: "",
    name: "",
    description: "",
    price_rappen: "",
    fit: "",
    fit_url: "",
    min_orders: "1",
    status: "draft",
    sort: "0",
  };
}

// The drops the create form offers, or the shared error page.
async function loadDrops(
  c: Context<AdminEnv>,
): Promise<{ drops: Drop[] } | { errorPage: Response }> {
  const r = await apiRequest(c, "/admin/drops");
  if ("errorPage" in r) return r;
  return { drops: (await r.res.json()) as Drop[] };
}

function productValues(product: Product): ProductFormValues {
  return {
    slug: product.slug,
    name: product.name,
    description: product.description,
    price_rappen: String(product.price_rappen),
    fit: product.fit,
    fit_url: product.fit_url,
    min_orders: String(product.min_orders),
    status: product.status,
    sort: String(product.sort),
  };
}

// Zod issues to a per-field message, first message per field wins. Generic over the
// form's field set (the product and drop forms both use it): only issues whose path
// names one of `fields` are mapped, so an issue on a field the map's type does not
// carry — the create schema's drop_id, surfaced separately as dropError — is skipped
// rather than smuggled in.
function fieldErrors<T extends string>(
  fields: readonly T[],
  issues: readonly { path: PropertyKey[]; message: string }[],
): Partial<Record<T, string>> {
  const out: Partial<Record<T, string>> = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (
      typeof key === "string" &&
      (fields as readonly string[]).includes(key) &&
      !(key in out)
    ) {
      out[key as T] = issue.message;
    }
  }
  return out;
}

// The API's write refusals mapped to a slug-field message. slug_taken is the one a
// product or drop edit can hit (the row exists and its slug is the only unique
// column); anything else is mapped defensively so an unexpected code still reads on
// the slug. Both forms carry a `slug` field, so one shape serves both.
function conflictErrors(code: string): { slug: string } {
  if (code === "slug_taken") {
    return { slug: "That slug is already in use." };
  }
  return { slug: `The change was refused (${code}).` };
}

app.get("/products", async (c) => {
  const r = await apiRequest(c, "/admin/products");
  if ("errorPage" in r) return r.errorPage;
  const products = (await r.res.json()) as AdminProductRow[];
  const flash = c.req.query("deleted") ? "Product deleted." : undefined;
  return c.html(productsPage({ user: c.get("user"), products, flash }));
});

// The new-product form. Registered before /products/:id so "new" is never read as
// an id (Hono prefers a static segment, but the order makes it plain).
app.get("/products/new", async (c) => {
  const d = await loadDrops(c);
  if ("errorPage" in d) return d.errorPage;
  return c.html(
    productNewPage({
      user: c.get("user"),
      drops: d.drops,
      values: blankProductValues(),
      dropId: d.drops[0] ? String(d.drops[0].id) : "",
    }),
  );
});

// Create a product into a drop. Validated with productCreateInput; a bad body, a
// slug the API rejects (409) or a missing drop (422) re-render the form with the
// values kept and the error placed. On success, land on the new product's edit
// page so its sizes and images can be added.
app.post("/products", async (c) => {
  const form = await c.req.parseBody();
  const parsed = productCreateInput.safeParse(productCreateInputFromForm(form));

  const rerender = async (
    errors: Partial<Record<keyof ProductFormValues, string>>,
    dropError: string | undefined,
    status: 400 | 409 | 422,
  ): Promise<Response> => {
    const d = await loadDrops(c);
    if ("errorPage" in d) return d.errorPage;
    return c.html(
      productNewPage({
        user: c.get("user"),
        drops: d.drops,
        values: formValues(form),
        dropId: formStr(form.drop_id),
        errors,
        dropError,
      }),
      status,
    );
  };

  if (!parsed.success) {
    const issues = parsed.error.issues;
    const dropError = issues.find((i) => i.path[0] === "drop_id")?.message;
    return rerender(fieldErrors(PRODUCT_FIELDS, issues), dropError, 400);
  }

  const w = await apiWrite(c, "/admin/products", jsonBody("POST", parsed.data));
  if ("errorPage" in w) return w.errorPage;
  if ("conflict" in w) {
    if (w.conflict === "drop_not_found") {
      return rerender({}, "That drop no longer exists.", 422);
    }
    return rerender(
      conflictErrors(w.conflict),
      undefined,
      w.conflict === "slug_taken" ? 409 : 400,
    );
  }
  const created = (await w.res.json()) as Product;
  return c.redirect(`/products/${created.id}?saved=1`);
});

// How many blank rows the size editor offers for adding new sizes. A saved size
// becomes an existing row next load, so a handful is enough without client JS.
const NEW_SIZE_ROWS = 3;

// The size editor's rows for a stored product: each size as an existing row, plus
// the blank rows for adding more.
function sizeStateFromProduct(product: ProductWithSizes): {
  existing: SizeRowValues[];
  fresh: NewSizeValues[];
} {
  return {
    existing: product.sizes.map((s) => ({
      id: String(s.id),
      label: s.label,
      sort: String(s.sort),
      remove: false,
    })),
    fresh: Array.from({ length: NEW_SIZE_ROWS }, () => ({
      label: "",
      sort: "",
    })),
  };
}

// Read the size editor back: the desired size list for productSizesInput (kept
// existing rows plus non-blank new rows) and the rows as submitted, so a reject
// re-renders exactly what was typed. A removed row drops out of the desired list;
// a blank new row is ignored.
function sizesFromForm(form: FormBody): {
  sizes: unknown;
  state: { existing: SizeRowValues[]; fresh: NewSizeValues[] };
} {
  const existingCount = Number(formStr(form.existing_count)) || 0;
  const newCount = Number(formStr(form.new_count)) || 0;
  const existing: SizeRowValues[] = [];
  const fresh: NewSizeValues[] = [];
  const sizes: unknown[] = [];

  for (let i = 0; i < existingCount; i++) {
    const id = formStr(form[`id_${i}`]);
    const label = formStr(form[`label_${i}`]);
    const sort = formStr(form[`sort_${i}`]);
    const remove = formStr(form[`remove_${i}`]) !== "";
    existing.push({ id, label, sort, remove });
    if (!remove) sizes.push({ id: Number(id), label, sort: formNum(sort) });
  }
  for (let j = 0; j < newCount; j++) {
    const label = formStr(form[`new_label_${j}`]);
    const sort = formStr(form[`new_sort_${j}`]);
    fresh.push({ label, sort });
    if (label.trim() !== "") sizes.push({ label, sort: formNum(sort) });
  }
  return { sizes: { sizes }, state: { existing, fresh } };
}

// The API's size-reconcile refusals as a message for the editor.
function sizesConflictMessage(code: string): string {
  switch (code) {
    case "size_in_use":
      return "A size an order references can't be removed — hide the product instead.";
    case "unknown_size":
      return "One of those sizes no longer exists. Reload and try again.";
    default:
      return `The sizes were refused (${code}).`;
  }
}

app.get("/products/:id", async (c) => {
  const r = await apiRequest(c, productPath(c.req.param("id")));
  if ("errorPage" in r) return r.errorPage;
  const product = (await r.res.json()) as ProductWithSizes;
  const flash = c.req.query("saved") ? "Saved." : undefined;
  return c.html(
    productEditPage({
      user: c.get("user"),
      product,
      values: productValues(product),
      sizeState: sizeStateFromProduct(product),
      flash,
    }),
  );
});

// Save the product's fields. Validated with the same zod the API enforces; on a
// bad body or a slug the API rejects, the form comes back with the values kept
// and the error beside the field rather than dropping what was typed. On success,
// redirect to the product (POST-then-redirect) with a saved flash.
app.post("/products/:id", async (c) => {
  const id = c.req.param("id");
  const form = await c.req.parseBody();
  const parsed = productInput.safeParse(productInputFromForm(form));

  // Re-render the edit page with the submitted values and the given field errors.
  // The product is re-read for its heading, price hint and sizes; the form shows
  // what was typed, not the stored values.
  const reject = async (
    errors: Partial<Record<keyof ProductFormValues, string>>,
    status: 400 | 409,
  ): Promise<Response> => {
    const r = await apiRequest(c, productPath(id));
    if ("errorPage" in r) return r.errorPage;
    const product = (await r.res.json()) as ProductWithSizes;
    return c.html(
      productEditPage({
        user: c.get("user"),
        product,
        values: formValues(form),
        errors,
        sizeState: sizeStateFromProduct(product),
      }),
      status,
    );
  };

  if (!parsed.success)
    return reject(fieldErrors(PRODUCT_FIELDS, parsed.error.issues), 400);

  const w = await apiWrite(c, productPath(id), jsonBody("PATCH", parsed.data));
  if ("errorPage" in w) return w.errorPage;
  if ("conflict" in w) {
    return reject(
      conflictErrors(w.conflict),
      w.conflict === "slug_taken" ? 409 : 400,
    );
  }
  return c.redirect(`/products/${id}?saved=1`);
});

// Save the product's sizes: a full-list reconcile the API applies. Validated with
// the same productSizesInput zod; on a bad list or a reconcile the API refuses (a
// duplicate label, a size an order references), the editor comes back with the
// submitted rows kept and the reason shown. On success, redirect with a flash.
app.post("/products/:id/sizes", async (c) => {
  const id = c.req.param("id");
  const form = await c.req.parseBody();
  const { sizes, state } = sizesFromForm(form);
  const parsed = productSizesInput.safeParse(sizes);

  const reject = async (
    error: string,
    status: 400 | 409 | 422,
  ): Promise<Response> => {
    const r = await apiRequest(c, productPath(id));
    if ("errorPage" in r) return r.errorPage;
    const product = (await r.res.json()) as ProductWithSizes;
    return c.html(
      productEditPage({
        user: c.get("user"),
        product,
        values: productValues(product),
        sizeState: state,
        sizesError: error,
      }),
      status,
    );
  };

  if (!parsed.success) {
    return reject(parsed.error.issues[0]?.message ?? "Invalid sizes.", 400);
  }

  const w = await apiWrite(
    c,
    productPath(id, "/sizes"),
    jsonBody("PUT", parsed.data),
  );
  if ("errorPage" in w) return w.errorPage;
  if ("conflict" in w) {
    return reject(
      sizesConflictMessage(w.conflict),
      w.conflict === "size_in_use" ? 409 : 422,
    );
  }
  return c.redirect(`/products/${id}?saved=1`);
});

// Delete a product. On success, back to the list with a flash. A product an order
// references is refused (has_orders) — the API keeps the row so the order history
// stays intact — so the edit page comes back with a message steering to hiding it.
app.post("/products/:id/delete", async (c) => {
  const id = c.req.param("id");
  const w = await apiWrite(c, productPath(id), { method: "DELETE" });
  if ("errorPage" in w) return w.errorPage;
  if ("conflict" in w) {
    const r = await apiRequest(c, productPath(id));
    if ("errorPage" in r) return r.errorPage;
    const product = (await r.res.json()) as ProductWithSizes;
    const deleteError =
      w.conflict === "has_orders"
        ? "This product has orders and can't be deleted. Set its status to hidden instead."
        : `The delete was refused (${w.conflict}).`;
    return c.html(
      productEditPage({
        user: c.get("user"),
        product,
        values: productValues(product),
        sizeState: sizeStateFromProduct(product),
        deleteError,
      }),
      409,
    );
  }
  return c.redirect("/products?deleted=1");
});

// The API's image-upload refusals as a message for the edit page.
function imageErrorMessage(code: string): string {
  switch (code) {
    case "too_large":
      return "That image is too large.";
    case "no_file":
      return "Choose an image file to upload.";
    case "alt_too_long":
      return "The alt text is too long.";
    case "invalid_upload":
    case "unreadable":
      return "That file could not be read as an image.";
    default:
      return `The upload was refused (${code}).`;
  }
}

// Re-render the edit page with an image error, re-reading the product so its
// fields, sizes and remaining images are shown intact beside the message. The
// status mirrors the API's refusal (413 for an oversized upload, 400 otherwise),
// the way the fields, sizes and delete rejects each carry their API status.
async function renderImageError(
  c: Context<AdminEnv>,
  id: string,
  message: string,
  status: 400 | 413,
): Promise<Response> {
  const r = await apiRequest(c, productPath(id));
  if ("errorPage" in r) return r.errorPage;
  const product = (await r.res.json()) as ProductWithSizes;
  return c.html(
    productEditPage({
      user: c.get("user"),
      product,
      values: productValues(product),
      sizeState: sizeStateFromProduct(product),
      imageError: message,
    }),
    status,
  );
}

// Attach a photo. The admin holds no files: it reads the upload and forwards it
// to the API as multipart, which processes and stores it. The API's image routes
// live at the root (/products/:id/images, /images/:id), not under /admin. A
// refused upload (too large, unreadable) re-renders with the reason.
app.post("/products/:id/images", async (c) => {
  const id = c.req.param("id");
  const form = await c.req.parseBody();
  const file = form.file;
  const alt = formStr(form.alt);

  const body = new FormData();
  if (file instanceof File) body.append("file", file);
  if (alt) body.append("alt", alt);

  const w = await apiWrite(c, `/products/${encodeURIComponent(id)}/images`, {
    method: "POST",
    body,
  });
  if ("errorPage" in w) return w.errorPage;
  if ("conflict" in w) {
    const status = w.conflict === "too_large" ? 413 : 400;
    return renderImageError(c, id, imageErrorMessage(w.conflict), status);
  }
  return c.redirect(`/products/${id}?saved=1`);
});

// Remove a photo. The API deletes the row and, once no row references the same
// content hash, its files. A missing image is the shared 404.
app.post("/products/:id/images/:imageId/delete", async (c) => {
  const id = c.req.param("id");
  const imageId = c.req.param("imageId");
  const w = await apiWrite(c, `/images/${encodeURIComponent(imageId)}`, {
    method: "DELETE",
  });
  if ("errorPage" in w) return w.errorPage;
  if ("conflict" in w) {
    return renderImageError(c, id, "That image could not be deleted.", 400);
  }
  return c.redirect(`/products/${id}?saved=1`);
});

// -------------------------------------------------------------- drop screens

// The API path for one drop, with the id encoded before it is spliced in.
function dropPath(id: string, suffix = ""): string {
  return `/admin/drops/${encodeURIComponent(id)}${suffix}`;
}

const DROP_FIELDS = [
  "slug",
  "name",
  "year",
  "no",
  "status",
  "sort",
  "tagline",
  "body",
  "note",
  "color_primary",
  "color_secondary",
  "color_accent",
  "color_text",
  "display_font",
  "theme_base",
] as const;

// The submitted fields as dropInput expects them (numbers parsed), for the zod
// check. Create and edit share one shape — a drop has no parent to name.
function dropInputFromForm(form: FormBody): Record<string, unknown> {
  return {
    slug: formStr(form.slug),
    name: formStr(form.name),
    year: formNum(form.year),
    no: formNum(form.no),
    status: formStr(form.status),
    sort: formNum(form.sort),
    tagline: formStr(form.tagline),
    body: formStr(form.body),
    note: formStr(form.note),
    color_primary: formStr(form.color_primary),
    color_secondary: formStr(form.color_secondary),
    color_accent: formStr(form.color_accent),
    color_text: formStr(form.color_text),
    display_font: formStr(form.display_font),
    theme_base: formStr(form.theme_base),
  };
}

// The submitted values as strings, to echo back into the form on a reject.
function dropFormValues(form: FormBody): DropFormValues {
  return Object.fromEntries(
    DROP_FIELDS.map((f) => [f, formStr(form[f])]),
  ) as DropFormValues;
}

function dropValues(drop: Drop): DropFormValues {
  return {
    slug: drop.slug,
    name: drop.name,
    year: String(drop.year),
    no: String(drop.no),
    status: drop.status,
    sort: String(drop.sort),
    tagline: drop.tagline,
    body: drop.body,
    note: drop.note,
    color_primary: drop.color_primary,
    color_secondary: drop.color_secondary,
    color_accent: drop.color_accent,
    color_text: drop.color_text,
    display_font: drop.display_font,
    theme_base: drop.theme_base,
  };
}

// A blank set of field values for a fresh create form, with the defaults the schema
// also carries (a draft, sort 0) plus the shop's default font and base and the
// current year, so most creates only fill in a name, slug and number.
function blankDropValues(): DropFormValues {
  return {
    slug: "",
    name: "",
    year: String(new Date().getFullYear()),
    no: "",
    status: "draft",
    sort: "0",
    tagline: "",
    body: "",
    note: "",
    color_primary: "",
    color_secondary: "",
    color_accent: "",
    color_text: "",
    display_font: "Antonio",
    theme_base: "light",
  };
}

// The drops list: every drop, any status, with the per-row archive control. Reuses
// loadDrops, the same read the product create form's drop picker uses.
app.get("/drops", async (c) => {
  const d = await loadDrops(c);
  if ("errorPage" in d) return d.errorPage;
  const flash = c.req.query("updated") ? "Status updated." : undefined;
  return c.html(dropsPage({ user: c.get("user"), drops: d.drops, flash }));
});

// The new-drop form. Registered before /drops/:id so "new" is never read as an id.
app.get("/drops/new", (c) => {
  return c.html(
    dropNewPage({ user: c.get("user"), values: blankDropValues() }),
  );
});

// Create a drop. Validated with the same dropInput zod the API enforces; a bad
// body or a slug the API rejects (409) re-render the form with the values kept and
// the error placed. On success, land on the new drop's edit page.
app.post("/drops", async (c) => {
  const form = await c.req.parseBody();
  const parsed = dropInput.safeParse(dropInputFromForm(form));

  const reject = (
    errors: Partial<Record<keyof DropFormValues, string>>,
    status: 400 | 409,
  ): Promise<Response> =>
    Promise.resolve(
      c.html(
        dropNewPage({
          user: c.get("user"),
          values: dropFormValues(form),
          errors,
        }),
        status,
      ),
    );

  if (!parsed.success)
    return reject(fieldErrors(DROP_FIELDS, parsed.error.issues), 400);

  const w = await apiWrite(c, "/admin/drops", jsonBody("POST", parsed.data));
  if ("errorPage" in w) return w.errorPage;
  if ("conflict" in w) {
    return reject(
      conflictErrors(w.conflict),
      w.conflict === "slug_taken" ? 409 : 400,
    );
  }
  const created = (await w.res.json()) as Drop;
  return c.redirect(`/drops/${created.id}?saved=1`);
});

app.get("/drops/:id", async (c) => {
  const r = await apiRequest(c, dropPath(c.req.param("id")));
  if ("errorPage" in r) return r.errorPage;
  const drop = (await r.res.json()) as Drop;
  const flash = c.req.query("saved") ? "Saved." : undefined;
  return c.html(
    dropEditPage({
      user: c.get("user"),
      id: String(drop.id),
      values: dropValues(drop),
      flash,
    }),
  );
});

// Save a drop's fields (status included). Validated with the same dropInput zod;
// on a bad body or a slug the API rejects, the form comes back with the submitted
// values kept and the error beside the field. The reject re-renders from the
// submitted values, not a stored drop (the drop screen has no derived display
// fields) — but a bad body still confirms the drop exists first, so editing a
// missing drop is a 404, not a 400 form for a row that isn't there. On success,
// redirect with a flash.
app.post("/drops/:id", async (c) => {
  const id = c.req.param("id");
  const form = await c.req.parseBody();
  const parsed = dropInput.safeParse(dropInputFromForm(form));

  const reject = (
    errors: Partial<Record<keyof DropFormValues, string>>,
    status: 400 | 409,
  ): Promise<Response> =>
    Promise.resolve(
      c.html(
        dropEditPage({
          user: c.get("user"),
          id,
          values: dropFormValues(form),
          errors,
        }),
        status,
      ),
    );

  if (!parsed.success) {
    // A bad body renders the form; confirm the drop exists first so a bad-body
    // edit of a missing drop is the shared 404, matching the product edit route.
    const r = await apiRequest(c, dropPath(id));
    if ("errorPage" in r) return r.errorPage;
    return reject(fieldErrors(DROP_FIELDS, parsed.error.issues), 400);
  }

  const w = await apiWrite(c, dropPath(id), jsonBody("PATCH", parsed.data));
  if ("errorPage" in w) return w.errorPage;
  if ("conflict" in w) {
    return reject(
      conflictErrors(w.conflict),
      w.conflict === "slug_taken" ? 409 : 400,
    );
  }
  return c.redirect(`/drops/${id}?saved=1`);
});

// The archive control: flip a drop's status from the list. The dropdown only ever
// offers the three real statuses, so a body the schema rejects is a tampered form
// and bounces back to the list rather than erroring. On success, redirect to the
// list (POST-then-redirect) with a flash.
app.post("/drops/:id/status", async (c) => {
  const id = c.req.param("id");
  const form = await c.req.parseBody();
  const parsed = dropStatusInput.safeParse({ status: form.status });
  if (!parsed.success) return c.redirect("/drops");
  const r = await apiRequest(
    c,
    dropPath(id, "/status"),
    jsonBody("PATCH", parsed.data),
  );
  if ("errorPage" in r) return r.errorPage;
  return c.redirect("/drops?updated=1");
});

// ---------------------------------------------------------- settings screen

const SETTINGS_TEXT_FIELDS = [
  "creditor_name",
  "creditor_address",
  "creditor_building_number",
  "creditor_zip",
  "creditor_city",
  "creditor_country",
  "creditor_account",
  "notify_email",
] as const;

// The submitted settings as settingsInput expects them: the text fields as-is
// (it trims and normalises them itself) and shop_open as the boolean the checkbox
// stands for — present (any value) is open, absent is closed.
function settingsInputFromForm(form: FormBody): Record<string, unknown> {
  const out: Record<string, unknown> = { shop_open: "shop_open" in form };
  for (const f of SETTINGS_TEXT_FIELDS) out[f] = formStr(form[f]);
  return out;
}

// The submitted text values as strings, to echo back into the form on a reject.
function settingsFormValues(form: FormBody): SettingsFormValues {
  return Object.fromEntries(
    SETTINGS_TEXT_FIELDS.map((f) => [f, formStr(form[f])]),
  ) as SettingsFormValues;
}

function settingsValues(s: Settings): SettingsFormValues {
  return Object.fromEntries(
    SETTINGS_TEXT_FIELDS.map((f) => [f, s[f]]),
  ) as SettingsFormValues;
}

// The shared zod's refine codes as a message beside the field. A blank value is
// always accepted, so these only ever fire on a non-blank one that is wrong.
const SETTINGS_ERROR_MESSAGES: Record<string, string> = {
  invalid_iban:
    "That IBAN is not valid — check for a typo, and note a QR-IBAN is not accepted.",
  invalid_email: "Enter a valid email address, or leave it blank.",
  invalid_country: "The country must be CH, or blank.",
};

// fieldErrors keyed to the settings fields, then the known refine codes swapped
// for a readable message; anything else (a length cap) keeps zod's own text.
function settingsErrors(
  issues: readonly { path: PropertyKey[]; message: string }[],
): Partial<Record<keyof SettingsFormValues, string>> {
  const errors = fieldErrors(SETTINGS_TEXT_FIELDS, issues);
  for (const key of Object.keys(errors) as (keyof SettingsFormValues)[]) {
    const code = errors[key];
    if (code && code in SETTINGS_ERROR_MESSAGES) {
      errors[key] = SETTINGS_ERROR_MESSAGES[code];
    }
  }
  return errors;
}

app.get("/settings", async (c) => {
  const r = await apiRequest(c, "/admin/settings");
  if ("errorPage" in r) return r.errorPage;
  const settings = (await r.res.json()) as Settings;
  const flash = c.req.query("saved") ? "Saved." : undefined;
  return c.html(
    settingsPage({
      user: c.get("user"),
      values: settingsValues(settings),
      shopOpen: settings.shop_open,
      flash,
    }),
  );
});

// Save the whole settings object. Validated with the same zod the API enforces;
// on a bad IBAN, country or email the form comes back with the submitted values
// kept and the error beside the field. Because the admin validates first, a
// well-formed body is one the API accepts, so the PUT has no expected 4xx — an
// unreachable or erroring API is the shared service page. On success, redirect to
// a fresh read (POST-then-redirect) so the stored, normalised values are shown.
app.post("/settings", async (c) => {
  const form = await c.req.parseBody();
  const parsed = settingsInput.safeParse(settingsInputFromForm(form));
  if (!parsed.success) {
    return c.html(
      settingsPage({
        user: c.get("user"),
        values: settingsFormValues(form),
        shopOpen: "shop_open" in form,
        errors: settingsErrors(parsed.error.issues),
      }),
      400,
    );
  }
  const r = await apiRequest(
    c,
    "/admin/settings",
    jsonBody("PUT", parsed.data),
  );
  if ("errorPage" in r) return r.errorPage;
  return c.redirect("/settings?saved=1");
});

// ------------------------------------------------------------- users screen

const ADMIN_USER_FIELDS = ["username", "password"] as const;

// The list read the users screen and its two writes all share on a reject.
async function loadUsers(
  c: Context<AdminEnv>,
): Promise<{ users: AdminUser[] } | { errorPage: Response }> {
  const r = await apiRequest(c, "/admin/users");
  if ("errorPage" in r) return r;
  return { users: (await r.res.json()) as AdminUser[] };
}

app.get("/users", async (c) => {
  const r = await loadUsers(c);
  if ("errorPage" in r) return r.errorPage;
  const flash = c.req.query("created")
    ? "User created."
    : c.req.query("updated")
      ? "User updated."
      : undefined;
  return c.html(usersPage({ user: c.get("user"), users: r.users, flash }));
});

// Create an admin user. Validated with the same zod the API enforces (a blank
// username, a password under the floor); a username the API reports taken (409)
// re-renders the form with the error on that field. The password is never echoed
// back — only the username survives a reject. On success, back to the list.
app.post("/users", async (c) => {
  const form = await c.req.parseBody();
  const username = formStr(form.username);
  const parsed = adminUserCreateInput.safeParse({
    username,
    password: formStr(form.password),
  });

  const reject = async (
    errors: Partial<Record<"username" | "password", string>>,
    status: 400 | 409,
  ): Promise<Response> => {
    const r = await loadUsers(c);
    if ("errorPage" in r) return r.errorPage;
    return c.html(
      usersPage({
        user: c.get("user"),
        users: r.users,
        usernameValue: username,
        errors,
      }),
      status,
    );
  };

  if (!parsed.success) {
    return reject(fieldErrors(ADMIN_USER_FIELDS, parsed.error.issues), 400);
  }

  const w = await apiWrite(c, "/admin/users", jsonBody("POST", parsed.data));
  if ("errorPage" in w) return w.errorPage;
  if ("conflict" in w) {
    const message =
      w.conflict === "username_taken"
        ? "That username is already taken."
        : `The user was refused (${w.conflict}).`;
    return reject(
      { username: message },
      w.conflict === "username_taken" ? 409 : 400,
    );
  }
  return c.redirect("/users?created=1");
});

// Deactivate or restore a user. The desired state rides in a hidden field the row
// sets from the user's current status, so the button reads Deactivate or Restore.
// The API refuses to switch off the last active admin (last_admin, 409); that
// re-renders the list with the reason. On success, back to the list.
app.post("/users/:id/active", async (c) => {
  const id = c.req.param("id");
  const form = await c.req.parseBody();
  const active = formStr(form.active) === "true";
  const w = await apiWrite(
    c,
    `/admin/users/${encodeURIComponent(id)}/active`,
    jsonBody("PATCH", { active }),
  );
  if ("errorPage" in w) return w.errorPage;
  if ("conflict" in w) {
    const r = await loadUsers(c);
    if ("errorPage" in r) return r.errorPage;
    const message =
      w.conflict === "last_admin"
        ? "That is the last active admin — deactivating it would lock everyone out."
        : `The change was refused (${w.conflict}).`;
    return c.html(
      usersPage({ user: c.get("user"), users: r.users, actionError: message }),
      409,
    );
  }
  return c.redirect("/users?updated=1");
});
