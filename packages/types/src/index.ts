/**
 * @attakk/types — TypeScript types and zod schemas shared by the shop, API and
 * admin, so there is one definition of what a drop, product and order is rather
 * than three that drift apart. Field names mirror the SQLite columns the API
 * selects, so a response is the row shape with nothing translated in between.
 *
 * Most exports are types, which erase where they are imported with `import
 * type`. The zod schemas here are runtime values, though — the moment an app
 * imports one, this package ships real code, so it builds to `dist` and is a
 * runtime dependency (not just dev) of whoever imports a schema.
 */

import { z } from "zod";

export type DropStatus = "draft" | "live" | "archived";
export type ProductStatus = "draft" | "live" | "hidden";
export type ThemeBase = "light" | "dark";

// The fixed set of faces the site ships — an arbitrary name would mean loading
// a webfont at runtime, so the admin picks from these.
export type DisplayFont =
  "Antonio" | "Permanent Marker" | "JetBrains Mono" | "Urbanist";

export interface Drop {
  id: number;
  slug: string;
  name: string;
  year: number;
  no: number;
  status: DropStatus;
  sort: number;
  tagline: string;
  body: string;
  note: string;
  color_primary: string;
  color_secondary: string;
  color_accent: string;
  color_text: string;
  display_font: DisplayFont;
  theme_base: ThemeBase;
}

export interface Product {
  id: number;
  drop_id: number;
  slug: string;
  name: string;
  description: string;
  // Integer rappen, never a float — the same unit the QR bill is built from.
  price_rappen: number;
  fit: string;
  fit_url: string;
  min_orders: number;
  status: ProductStatus;
  sort: number;
}

export interface ProductSize {
  id: number;
  label: string;
  sort: number;
}

export interface ProductWithSizes extends Product {
  sizes: ProductSize[];
}

export interface DropWithProducts extends Drop {
  products: ProductWithSizes[];
}

/* ------------------------------------------------------------------ orders */

export type OrderStatus = "pending" | "paid" | "cancelled";

// Caps on how much one order can carry. These are server-side integrity, not
// abuse defence — the honeypot and per-IP rate limiting the plan calls for
// guard the shop's public checkout, which is the surface a stranger can reach.
// This endpoint is internal and only ever sees the shop process.
export const MAX_ORDER_LINES = 20;
export const MAX_LINE_QTY = 10;

// One cart line as the browser submits it. Prices are deliberately absent: the
// API recalculates every line from its own products table, so a tampered cart
// cannot change what the bill says. Products and sizes are referenced by the
// ids the catalogue responses already carry.
export const orderLineInput = z.object({
  product_id: z.number().int().positive(),
  // null for a product with no size options; a real size id otherwise. The API
  // checks the size belongs to the product and rejects a mismatch.
  size_id: z.number().int().positive().nullable().default(null),
  qty: z.number().int().min(1).max(MAX_LINE_QTY),
});
export type OrderLineInput = z.infer<typeof orderLineInput>;

// The whole order the checkout posts. No phone (everything is pickup-only) and
// no note (that is the admin's field, not the customer's).
export const orderInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  items: z.array(orderLineInput).min(1).max(MAX_ORDER_LINES),
});
export type OrderInput = z.infer<typeof orderInput>;

// Price and title are copied onto the line at order time, not looked up later,
// so repricing or renaming a product never rewrites an existing order.
export interface OrderItem {
  id: number;
  product_id: number;
  size_id: number | null;
  qty: number;
  unit_price_rappen: number;
  title: string;
}

export interface Order {
  id: number;
  // The RF creditor reference: shown on the bill, matched by eye against the
  // bank export, and the slug of the receipt URL.
  reference: string;
  // A random token guarding the receipt URL against a guessed neighbour.
  token: string;
  email: string;
  phone: string;
  total_rappen: number;
  status: OrderStatus;
  created_at: string;
  paid_at: string | null;
  note: string;
}

export interface OrderWithItems extends Order {
  items: OrderItem[];
}
