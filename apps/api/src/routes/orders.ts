import { orderInput } from "@attakk/types";
import { Hono } from "hono";
import { sendOrderConfirmation } from "../email.js";
import { OrderError, createOrder } from "../repositories/orders.js";

// The one write the shop makes: it posts the cart here, the API prices it from
// its own products table, creates the order with its RF reference, mails the
// customer their QR bill, and returns the stored order so the shop can send
// them to the receipt page. No SQL here — the repository owns it.
export const orders = new Hono();

orders.post("/orders", async (c) => {
  const body = (await c.req.json().catch(() => null)) as unknown;
  const parsed = orderInput.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  }

  try {
    const order = createOrder(parsed.data);
    // Mail the QR bill and notify the shop. Best-effort inside — a mail failure
    // is logged, never undoes the committed order or fails the shop's request,
    // since the receipt page reads the order back from the database regardless.
    await sendOrderConfirmation(order);
    return c.json(order, 201);
  } catch (err) {
    // A refused line (unknown product, wrong size) is the request's fault, not
    // a server error, so it comes back as 422 with the machine-readable reason.
    if (err instanceof OrderError) return c.json({ error: err.code }, 422);
    throw err;
  }
});
