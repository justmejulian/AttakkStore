import {
  type AdminProductRow,
  MAX_FIT_LEN,
  MAX_FIT_URL_LEN,
  MAX_PRODUCT_DESCRIPTION_LEN,
  MAX_PRODUCT_NAME_LEN,
  MAX_SIZE_LABEL_LEN,
  MAX_SLUG_LEN,
  ORDER_STATUSES,
  type OrderListRow,
  type OrderStatus,
  type OrderWithItems,
  PRODUCT_STATUSES,
  type ProductWithSizes,
} from "@attakk/types";
import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { formatChf, formatTimestamp } from "./format.js";
import type { Session } from "./session.js";

// The fields of the product edit form, as strings: the values echoed back into
// the inputs, whether they came from the stored product or a rejected submission.
export type ProductFormValues = Record<
  | "slug"
  | "name"
  | "description"
  | "price_rappen"
  | "fit"
  | "fit_url"
  | "min_orders"
  | "status"
  | "sort",
  string
>;

// A row of the size editor. Existing sizes carry their id (so the reconcile keeps
// the row an order references) and can be marked for removal; a new size is a
// blank row with no id. All values are strings — what the form submits and echoes.
export interface SizeRowValues {
  id: string;
  label: string;
  sort: string;
  remove: boolean;
}
export interface NewSizeValues {
  label: string;
  sort: string;
}

// Server-rendered HTML, plain forms, no client framework and no build step — the
// admin is presentation over the API. This is a deliberately spare shell; the
// real styling and the seven screens land in the steps that follow. What matters
// at this step is that login, the session and the auth gate work end to end.

// hono/html returns a promise when any interpolated value is one, so both the
// body passed in and the page handed back are the async-or-sync union; c.html
// accepts either.
type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

function layout(title: string, body: Html): Html {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title} · attakk admin</title>
      </head>
      <body>
        ${body}
      </body>
    </html>`;
}

// The login form. `error` shows above the fields when a prior attempt failed;
// the username is preserved so a wrong password does not also wipe the field.
// Interpolated values are escaped by hono/html, so a value echoed back into the
// form cannot inject markup.
export function loginPage(opts: { error?: string; username?: string } = {}) {
  return layout(
    "Sign in",
    html`<main>
      <h1>attakk admin</h1>
      ${opts.error ? html`<p role="alert">${opts.error}</p>` : ""}
      <form method="post" action="/login">
        <label
          >Username
          <input
            name="username"
            value="${opts.username ?? ""}"
            autocomplete="username"
            autofocus
            required
        /></label>
        <label
          >Password
          <input
            name="password"
            type="password"
            autocomplete="current-password"
            required
        /></label>
        <button type="submit">Sign in</button>
      </form>
    </main>`,
  );
}

// The chrome every signed-in screen shares: a nav across the screens, who is
// signed in, and the sign-out control. Screens pass their own <main> body. Kept
// spare and unstyled — the design overlay is a later step; this is structure.
function shell(title: string, user: Session, body: Html): Html {
  return layout(
    title,
    html`<header>
        <nav>
          <a href="/orders">Orders</a> · <a href="/products">Products</a>
        </nav>
        <p>
          Signed in as <strong>${user.username}</strong>.
          <form method="post" action="/logout">
            <button type="submit">Sign out</button>
          </form>
        </p>
      </header>
      <main>${body}</main>`,
  );
}

// The signed-in landing page. The screens hang off the nav; this is just the
// entry point past the auth gate.
export function homePage(user: Session) {
  return shell(
    "Home",
    user,
    html`<p>Welcome. Pick a screen from the nav above.</p>`,
  );
}

// Franc-formatted total with the currency, for display only.
function chf(rappen: number): string {
  return `CHF ${formatChf(rappen)}`;
}

// The status filter: one link per status plus "All", the active one marked. The
// links carry the filter in the query string, so the CSV export below can reuse
// whatever is selected.
function statusFilter(active: OrderStatus | undefined): Html {
  const link = (label: string, status: OrderStatus | undefined) => {
    const href = status ? `/orders?status=${status}` : "/orders";
    return active === status
      ? html`<strong>${label}</strong>`
      : html`<a href="${href}">${label}</a>`;
  };
  return html`<p>
    ${link("All", undefined)}
    ${ORDER_STATUSES.map((s) => html` · ${link(s, s)}`)}
  </p>`;
}

// The orders list: newest first, filtered by status, each row linking to its
// detail. Reference, email, total and status are what the screen needs; the CSV
// export carries the same rows, filter included.
export function ordersPage(opts: {
  user: Session;
  orders: OrderListRow[];
  status: OrderStatus | undefined;
}) {
  const csvHref = opts.status
    ? `/orders.csv?status=${opts.status}`
    : "/orders.csv";
  return shell(
    "Orders",
    opts.user,
    html`<h1>Orders</h1>
      ${statusFilter(opts.status)}
      <p><a href="${csvHref}">Export CSV</a></p>
      ${
        opts.orders.length === 0
          ? html`<p>No orders.</p>`
          : html`<table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Email</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Placed</th>
                </tr>
              </thead>
              <tbody>
                ${opts.orders.map(
                  (o) =>
                    html`<tr>
                      <td><a href="/orders/${o.id}">${o.reference}</a></td>
                      <td>${o.email}</td>
                      <td>${chf(o.total_rappen)}</td>
                      <td>${o.status}</td>
                      <td>${formatTimestamp(o.created_at)}</td>
                    </tr>`,
                )}
              </tbody>
            </table>`
      }`,
  );
}

// The order detail: line items, the status controls, the note field and the
// resend control. `flash` shows a one-off confirmation (the bill was resent);
// `noteError` re-renders the note field with its message when a note was refused.
export function orderDetailPage(opts: {
  user: Session;
  order: OrderWithItems;
  flash?: string;
  noteError?: string;
  noteValue?: string;
}) {
  const { order } = opts;
  // The statuses this order can move to: every status but the one it is in.
  const targets = ORDER_STATUSES.filter((s) => s !== order.status);
  return shell(
    `Order ${order.reference}`,
    opts.user,
    html`<p><a href="/orders">← All orders</a></p>
      ${opts.flash ? html`<p role="status">${opts.flash}</p>` : ""}
      <h1>${order.reference}</h1>
      <dl>
        <dt>Status</dt>
        <dd>${order.status}</dd>
        <dt>Email</dt>
        <dd>${order.email}</dd>
        <dt>Total</dt>
        <dd>${chf(order.total_rappen)}</dd>
        <dt>Placed</dt>
        <dd>${formatTimestamp(order.created_at)}</dd>
        <dt>Paid</dt>
        <dd>${order.paid_at ? formatTimestamp(order.paid_at) : "—"}</dd>
      </dl>

      <h2>Items</h2>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Line</th>
          </tr>
        </thead>
        <tbody>
          ${order.items.map(
            (item) =>
              html`<tr>
                <td>
                  ${item.title}${
                    item.size_id !== null ? html` · size #${item.size_id}` : ""
                  }
                </td>
                <td>${item.qty}</td>
                <td>${chf(item.unit_price_rappen)}</td>
                <td>${chf(item.unit_price_rappen * item.qty)}</td>
              </tr>`,
          )}
        </tbody>
      </table>

      <h2>Status</h2>
      <form method="post" action="/orders/${order.id}/status">
        ${targets.map(
          (s) =>
            html`<button type="submit" name="status" value="${s}">
              Mark ${s}
            </button> `,
        )}
      </form>

      <h2>Note</h2>
      ${opts.noteError ? html`<p role="alert">${opts.noteError}</p>` : ""}
      <form method="post" action="/orders/${order.id}/note">
        <textarea name="note" rows="3" maxlength="2000">
${opts.noteValue ?? order.note}</textarea>
        <button type="submit">Save note</button>
      </form>

      <h2>Confirmation email</h2>
      <form method="post" action="/orders/${order.id}/resend">
        <button type="submit">Resend the bill</button>
      </form>`,
  );
}

// A signed-in screen that could not load its data. Two shapes: the order does
// not exist (404) and the API is unreachable or erroring (502). Both keep the
// nav so the operator is one click from a screen that works.
export function notFoundPage(user: Session) {
  return shell(
    "Not found",
    user,
    html`<h1>Not found</h1>
      <p>That order does not exist. <a href="/orders">Back to orders</a>.</p>`,
  );
}

export function serviceErrorPage(user: Session) {
  return shell(
    "Service unavailable",
    user,
    html`<h1>Service unavailable</h1>
      <p>The API could not be reached. Try again in a moment.</p>`,
  );
}

// ----------------------------------------------------------------- products

// The flat product list, already ordered by the API as drop-then-product,
// regrouped into its drops for display without re-sorting. Consecutive rows share
// a drop, so a single pass collects each run.
function byDrop(
  products: AdminProductRow[],
): { name: string; status: string; products: AdminProductRow[] }[] {
  const groups: {
    id: number;
    name: string;
    status: string;
    products: AdminProductRow[];
  }[] = [];
  for (const p of products) {
    const last = groups.at(-1);
    if (last && last.id === p.drop_id) last.products.push(p);
    else
      groups.push({
        id: p.drop_id,
        name: p.drop_name,
        status: p.drop_status,
        products: [p],
      });
  }
  return groups;
}

// The products screen: every product grouped by its drop, each row linking to its
// edit page and showing status, price, and the ordered-units tally against the
// pre-order target so it is clear how close a piece is to being made.
export function productsPage(opts: {
  user: Session;
  products: AdminProductRow[];
}) {
  return shell(
    "Products",
    opts.user,
    html`<h1>Products</h1>
      ${
        opts.products.length === 0
          ? html`<p>No products yet.</p>`
          : byDrop(opts.products).map(
              (group) =>
                html`<section>
                  <h2>${group.name} <small>(${group.status})</small></h2>
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Status</th>
                        <th>Price</th>
                        <th>Ordered</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${group.products.map(
                        (p) =>
                          html`<tr>
                            <td><a href="/products/${p.id}">${p.name}</a></td>
                            <td>${p.status}</td>
                            <td>${chf(p.price_rappen)}</td>
                            <td>${p.ordered_count} / ${p.min_orders}</td>
                          </tr>`,
                      )}
                    </tbody>
                  </table>
                </section>`,
            )
      }`,
  );
}

// One text/number field of the edit form, with its value echoed back and any
// error shown beside it. Interpolated values are escaped by hono/html, so a
// rejected value cannot inject markup when it is rendered back into the input.
function textField(opts: {
  label: string;
  name: keyof ProductFormValues;
  values: ProductFormValues;
  errors?: Partial<Record<keyof ProductFormValues, string>>;
  type?: "text" | "number";
  required?: boolean;
  maxlength?: number;
  min?: number;
  hint?: string;
}): Html {
  const err = opts.errors?.[opts.name];
  return html`<p>
    <label
      >${opts.label}
      <input
        name="${opts.name}"
        type="${opts.type ?? "text"}"
        value="${opts.values[opts.name]}"
        ${opts.required ? html`required` : html``}
        ${opts.maxlength ? html`maxlength="${opts.maxlength}"` : html``}
        ${opts.min !== undefined ? html`min="${opts.min}"` : html``}
    /></label>
    ${opts.hint ? html`<small>${opts.hint}</small>` : ""}
    ${err ? html`<span role="alert">${err}</span>` : ""}
  </p>`;
}

// The size editor: one row per existing size (its id hidden so the reconcile
// keeps it, a remove checkbox to drop it) followed by a few blank rows for new
// sizes. A full-list form posting to its own route, so it and the fields form are
// independent — rejecting one leaves the other showing stored values. Counts are
// carried in hidden fields so the POST knows how many rows to read. `sizesError`
// shows above when the reconcile is refused (a duplicate label, a size in use).
function sizesForm(opts: {
  productId: number;
  existing: SizeRowValues[];
  fresh: NewSizeValues[];
  error?: string;
}): Html {
  return html`<h2>Sizes</h2>
    ${opts.error ? html`<p role="alert">${opts.error}</p>` : ""}
    <form method="post" action="/products/${opts.productId}/sizes">
      <input
        type="hidden"
        name="existing_count"
        value="${opts.existing.length}"
      />
      <input type="hidden" name="new_count" value="${opts.fresh.length}" />
      ${
        opts.existing.length === 0
          ? html`<p>No sizes yet.</p>`
          : opts.existing.map(
              (row, i) =>
                html`<p>
                  <input type="hidden" name="id_${i}" value="${row.id}" />
                  <input
                    name="label_${i}"
                    value="${row.label}"
                    maxlength="${MAX_SIZE_LABEL_LEN}"
                    aria-label="Size label"
                  />
                  <input
                    name="sort_${i}"
                    type="number"
                    value="${row.sort}"
                    min="0"
                    aria-label="Sort"
                  />
                  <label>
                    <input
                      type="checkbox"
                      name="remove_${i}"
                      value="1"
                      ${row.remove ? html`checked` : html``}
                    />
                    remove
                  </label>
                </p>`,
            )
      }
      <p><em>Add sizes</em></p>
      ${opts.fresh.map(
        (row, j) =>
          html`<p>
            <input
              name="new_label_${j}"
              value="${row.label}"
              maxlength="${MAX_SIZE_LABEL_LEN}"
              placeholder="new size"
              aria-label="New size label"
            />
            <input
              name="new_sort_${j}"
              type="number"
              value="${row.sort}"
              min="0"
              aria-label="New size sort"
            />
          </p>`,
      )}
      <button type="submit">Save sizes</button>
    </form>`;
}

// The product edit page: two independent forms — the fields (with the current
// values and a franc price hint) and the size editor. `errors` marks a field the
// fields form rejected; `sizeState` supplies the size rows (submitted values on a
// size reject, stored otherwise) and `sizesError` its message; `flash` confirms a
// save. Images land in the next step.
export function productEditPage(opts: {
  user: Session;
  product: ProductWithSizes;
  values: ProductFormValues;
  errors?: Partial<Record<keyof ProductFormValues, string>>;
  sizeState: { existing: SizeRowValues[]; fresh: NewSizeValues[] };
  sizesError?: string;
  flash?: string;
}) {
  const { product, values, errors } = opts;
  return shell(
    product.name,
    opts.user,
    html`<p><a href="/products">← All products</a></p>
      ${opts.flash ? html`<p role="status">${opts.flash}</p>` : ""}
      <h1>${product.name}</h1>

      <form method="post" action="/products/${product.id}">
        ${textField({
          label: "Slug",
          name: "slug",
          values,
          errors,
          required: true,
          maxlength: MAX_SLUG_LEN,
          hint: "Lowercase words joined by hyphens — the storefront URL.",
        })}
        ${textField({
          label: "Name",
          name: "name",
          values,
          errors,
          required: true,
          maxlength: MAX_PRODUCT_NAME_LEN,
        })}
        <p>
          <label
            >Description
            <textarea
              name="description"
              rows="4"
              maxlength="${MAX_PRODUCT_DESCRIPTION_LEN}"
            >
${values.description}</textarea>
          </label>
        </p>
        ${textField({
          label: "Price (rappen)",
          name: "price_rappen",
          values,
          errors,
          type: "number",
          required: true,
          min: 0,
          hint: `100 rappen = CHF 1.00. Saved value: ${chf(product.price_rappen)}.`,
        })}
        ${textField({
          label: "Fit",
          name: "fit",
          values,
          errors,
          maxlength: MAX_FIT_LEN,
        })}
        ${textField({
          label: "Fit guide URL",
          name: "fit_url",
          values,
          errors,
          maxlength: MAX_FIT_URL_LEN,
        })}
        ${textField({
          label: "Order target",
          name: "min_orders",
          values,
          errors,
          type: "number",
          required: true,
          min: 1,
        })}
        <p>
          <label
            >Status
            <select name="status">
              ${PRODUCT_STATUSES.map(
                (s) =>
                  html`<option
                    value="${s}"
                    ${values.status === s ? html`selected` : html``}
                  >
                    ${s}
                  </option>`,
              )}
            </select></label
          >
        </p>
        ${textField({
          label: "Sort",
          name: "sort",
          values,
          errors,
          type: "number",
          min: 0,
        })}
        <button type="submit">Save</button>
      </form>

      ${sizesForm({
        productId: product.id,
        existing: opts.sizeState.existing,
        fresh: opts.sizeState.fresh,
        error: opts.sizesError,
      })}`,
  );
}
