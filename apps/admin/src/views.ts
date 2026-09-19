import {
  ORDER_STATUSES,
  type OrderListRow,
  type OrderStatus,
  type OrderWithItems,
} from "@attakk/types";
import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { formatChf, formatTimestamp } from "./format.js";
import type { Session } from "./session.js";

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
        <nav><a href="/orders">Orders</a></nav>
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
