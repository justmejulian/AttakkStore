import type { APIRoute } from "astro";
import { orderInput } from "@attakk/types";
import { apiFetch } from "../../lib/api.js";

// The throttle exists for one reason: a created order emails a QR bill to
// whatever address the form carried, so an uncapped endpoint can be used to mail
// PDFs to strangers. Only orders the API actually creates are counted — a cart
// the API rejects (a piece from a closed drop, a size that has gone) sends no
// mail, and locking someone out for correcting it would be the wrong trade.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ORDERS_PER_WINDOW = 5;

// Sweeping only happens past this many tracked clients, which no real shop
// reaches inside one window — a busy drop day is dozens of orders, not hundreds.
const MAX_TRACKED_CLIENTS = 1000;

const created = new Map<string, number[]>();

/**
 * The address to throttle on. Astro's `clientAddress` is the socket's remote
 * address unless `security.allowedDomains` is configured, and behind Dokku's
 * nginx that is the proxy — every customer in the shop would share one bucket.
 * Setting `allowedDomains` would not fix it either: Astro then takes the
 * *first* `X-Forwarded-For` entry, which is whatever the caller sent and can be
 * rotated at will.
 *
 * So read the header here and take the *last* entry. nginx appends the address
 * it saw the connection come from (`$proxy_add_x_forwarded_for`), so with our
 * single proxy hop that entry is the real client and anything a caller prepends
 * ahead of it is ignored. A request with no header — dev, or a direct hit on the
 * container — falls back to the socket address.
 *
 * Revisit the "last entry" if a CDN is ever put in front of Dokku: each extra
 * trusted hop moves the client one position further left.
 */
function clientKey(context: Parameters<APIRoute>[0]): string {
  const hops = (context.request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  const forwarded = hops.at(-1);
  if (forwarded) return forwarded;
  try {
    return context.clientAddress;
  } catch {
    return "unknown";
  }
}

function overLimit(key: string, now = Date.now()): boolean {
  const recent = (created.get(key) ?? []).filter(
    (stamp) => now - stamp < WINDOW_MS,
  );
  if (recent.length === 0) created.delete(key);
  else created.set(key, recent);
  return recent.length >= MAX_ORDERS_PER_WINDOW;
}

function recordOrder(key: string, now = Date.now()): void {
  // A key is otherwise pruned only when that same client comes back, so a
  // long-lived process would hold every address that ever ordered. Drop the
  // ones whose window has passed whenever the map grows past the cap.
  if (created.size >= MAX_TRACKED_CLIENTS) {
    for (const [tracked, stamps] of created) {
      if (stamps.every((stamp) => now - stamp >= WINDOW_MS)) {
        created.delete(tracked);
      }
    }
  }
  created.set(key, [...(created.get(key) ?? []), now]);
}

export function resetOrderRateLimits(): void {
  created.clear();
}

export const POST: APIRoute = async (context) => {
  const headers = { "Cache-Control": "no-store" };
  const body = (await context.request.json().catch(() => null)) as unknown;

  // The field is hidden from people but attractive to generic form bots. A
  // filled trap gets a quiet success and never reaches the API or sends mail.
  if (
    body &&
    typeof body === "object" &&
    "website" in body &&
    typeof body.website === "string" &&
    body.website.trim()
  ) {
    return new Response(null, { status: 204, headers });
  }

  const parsed = orderInput.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid" }, { status: 400, headers });
  }
  const key = clientKey(context);
  if (overLimit(key)) {
    return Response.json({ error: "rate_limited" }, { status: 429, headers });
  }

  try {
    const response = await apiFetch("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
    });
    if (![201, 400, 422].includes(response.status)) {
      throw new Error(`Order creation failed: ${response.status}`);
    }
    const result = await response.json();
    if (response.status === 201) recordOrder(key);
    return Response.json(result, { status: response.status, headers });
  } catch (error) {
    // An unreachable API, a 500 from it, and a body that would not parse all
    // read the same to the customer, so the trace is the only way to tell them
    // apart afterwards — and a 201 whose body failed to parse means an order
    // was created and billed while the customer was told to try again.
    console.error("order route: creation failed", error);
    return Response.json({ error: "unavailable" }, { status: 503, headers });
  }
};
