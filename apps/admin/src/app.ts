import {
  loginInput,
  MAX_NOTE_LEN,
  ORDER_STATUSES,
  orderNoteInput,
  orderStatusInput,
  type AdminUser,
  type OrderListRow,
  type OrderStatus,
  type OrderWithItems,
} from "@attakk/types";
import { type Context, Hono } from "hono";
import { apiFetch, jsonBody } from "./api.js";
import { type AdminEnv, requireAuth } from "./auth.js";
import { ordersToCsv } from "./csv.js";
import { clearSession, getSession, setSession } from "./session.js";
import {
  homePage,
  loginPage,
  notFoundPage,
  orderDetailPage,
  ordersPage,
  serviceErrorPage,
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
