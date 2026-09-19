import { orderInput } from "@attakk/types";
import { Hono } from "hono";
import { OrderError, createOrder } from "../repositories/orders.js";

// The one write the shop makes: it posts the cart here, the API prices it from
// its own products table, creates the order with its RF reference, and returns
// the stored order so the shop can send the customer to the receipt page. No
// SQL here — the repository owns it.
export const orders = new Hono();

orders.post("/orders", async (c) => {
  const body = (await c.req.json().catch(() => null)) as unknown;
  const parsed = orderInput.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  }

  try {
    return c.json(createOrder(parsed.data), 201);
  } catch (err) {
    // A refused line (unknown product, wrong size) is the request's fault, not
    // a server error, so it comes back as 422 with the machine-readable reason.
    if (err instanceof OrderError) return c.json({ error: err.code }, 422);
    throw err;
  }
});
