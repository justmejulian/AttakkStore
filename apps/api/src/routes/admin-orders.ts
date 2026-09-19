import {
  ORDER_STATUSES,
  type OrderStatus,
  orderNoteInput,
  orderStatusInput,
} from "@attakk/types";
import { Hono } from "hono";
import { sendOrderConfirmation } from "../email.js";
import {
  getOrder,
  listOrders,
  setOrderNote,
  setOrderStatus,
} from "../repositories/orders.js";
import { parseId } from "./params.js";

// The admin's order screens, reached over the internal network: list orders,
// open one, mark it paid or cancelled, edit its note, or resend the QR bill. The
// admin holds no database, so every read and write it makes goes through here.
// Like the other admin-facing routes it carries no auth of its own — the session
// gate lives in the admin app, and the private network is the boundary. No SQL
// here; the repository owns it.
export const adminOrders = new Hono();

function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

// The list, newest first, optionally narrowed to one status. An unknown status
// in the query is the caller's mistake, so it is a 400 rather than a silently
// empty list that looks like "no orders".
adminOrders.get("/admin/orders", (c) => {
  const raw = c.req.query("status");
  let status: OrderStatus | undefined;
  if (raw !== undefined) {
    if (!isOrderStatus(raw)) return c.json({ error: "invalid_status" }, 400);
    status = raw;
  }
  return c.json(listOrders(status));
});

adminOrders.get("/admin/orders/:id", (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);
  const order = getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);
  return c.json(order);
});

// Mark paid or cancelled (or back to pending to undo). setOrderStatus stamps or
// clears paid_at; a missing order is a 404, a bad body a 400.
adminOrders.patch("/admin/orders/:id/status", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);
  const parsed = orderStatusInput.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) return c.json({ error: "invalid" }, 400);

  const order = setOrderStatus(id, parsed.data.status);
  if (!order) return c.json({ error: "not_found" }, 404);
  return c.json(order);
});

adminOrders.patch("/admin/orders/:id/note", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);
  const parsed = orderNoteInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid" }, 400);

  const order = setOrderNote(id, parsed.data.note);
  if (!order) return c.json({ error: "not_found" }, 404);
  return c.json(order);
});

// Resend the confirmation with its QR bill — for when the customer lost the
// first one. sendOrderConfirmation catches everything internally and never
// rejects, so it is left un-awaited and the caller gets a 202 the moment the
// send is queued rather than waiting on SMTP.
adminOrders.post("/admin/orders/:id/resend", (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "not_found" }, 404);
  const order = getOrder(id);
  if (!order) return c.json({ error: "not_found" }, 404);

  void sendOrderConfirmation(order);
  return c.json({ status: "queued" }, 202);
});
