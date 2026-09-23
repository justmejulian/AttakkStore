import { cartInput, orderInput } from "@attakk/types";
import { Hono } from "hono";
import { sendOrderConfirmation } from "../email.js";
import {
  OrderError,
  createOrder,
  getReceiptOrder,
  quoteCart,
} from "../repositories/orders.js";

// The one write the shop makes: it posts the cart here, the API prices it from
// its own products table, creates the order with its RF reference, mails the
// customer their QR bill, and returns the stored order so the shop can send
// them to the receipt page. No SQL here — the repository owns it.
export const orders = new Hono();

orders.get("/orders/:reference", (c) => {
  c.header("Cache-Control", "no-store");
  const token = c.req.query("token");
  if (!token) return c.json({ error: "not_found" }, 404);
  const order = getReceiptOrder(c.req.param("reference"), token);
  return order ? c.json(order) : c.json({ error: "not_found" }, 404);
});

orders.post("/cart/quote", async (c) => {
  c.header("Cache-Control", "no-store");
  const parsed = cartInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  }
  try {
    return c.json(quoteCart(parsed.data));
  } catch (err) {
    if (err instanceof OrderError) return c.json({ error: err.code }, 422);
    throw err;
  }
});

orders.post("/orders", async (c) => {
  const body = (await c.req.json().catch(() => null)) as unknown;
  const parsed = orderInput.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  }

  try {
    const order = createOrder(parsed.data);
    // Dispatch the QR bill and shop notification in the background — never
    // awaited, so a slow or hung SMTP server can't stall the checkout response.
    // sendOrderConfirmation catches everything internally and never rejects, so
    // this is safe to leave un-awaited; the receipt page reads the order back
    // from the database regardless of whether the mail has gone out yet.
    void sendOrderConfirmation(order);
    return c.json(order, 201);
  } catch (err) {
    // A refused line (unknown product, wrong size) is the request's fault, not
    // a server error, so it comes back as 422 with the machine-readable reason.
    if (err instanceof OrderError) return c.json({ error: err.code }, 422);
    throw err;
  }
});
