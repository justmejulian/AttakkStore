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

// The three states a product moves through. One tuple so the type, the DB check
// constraint's mirror, and the admin's write zod all read from a single list
// rather than three that could drift (the same shape ORDER_STATUSES gives orders).
export const PRODUCT_STATUSES = ["draft", "live", "hidden"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

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

// A processed product photo. `hash` is the content hash of the original and the
// stem of every file on disk: the original is `{hash}.{ext}`, each derivative is
// `{hash}-{width}.webp`. The shop builds a srcset by filtering IMAGE_WIDTHS to
// those no wider than `width` (never upscaling) — so the produced widths are
// derivable from this row without a per-width column. `placeholder` is a tiny
// blurred webp as a data URI, painted while the real image loads.
export interface ProductImage {
  id: number;
  hash: string;
  ext: string;
  alt: string;
  placeholder: string;
  width: number;
  height: number;
  sort: number;
}

// The widths the shop renders and the API generates a webp derivative for. A
// derivative is only produced when the source is at least that wide, so a small
// original is never upscaled. Shared so the shop's srcset and the API's output
// come from one list rather than two that drift.
export const IMAGE_WIDTHS = [400, 800, 1200, 1600] as const;

// The exact derivative widths for a source of the given intrinsic width. Both
// the API (deciding what to generate) and the shop (building a srcset from a
// stored width, without touching disk) call this, so the file that exists and
// the file the markup asks for are guaranteed to agree. A source narrower than
// the smallest width still gets one derivative at its own width rather than
// being upscaled.
export function derivativeWidths(intrinsic: number): number[] {
  const widths = IMAGE_WIDTHS.filter((w) => w <= intrinsic);
  return widths.length > 0 ? widths : [intrinsic];
}

// Upload size ceiling. A phone photo is a few MB; this leaves headroom without
// letting a decode balloon memory. Which formats are accepted is decided by the
// API from the decoded file, not the extension (see storedExt in images.ts).
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Longest an image's alt text may be. Generous for a real description but a
// bound all the same, since alt is free text that ends up in public responses.
// Shared so the admin's form and the API enforce the same ceiling.
export const MAX_ALT_LEN = 500;

export interface ProductWithSizes extends Product {
  sizes: ProductSize[];
  // Ordered by the admin (sort, then id). The first is the card and gallery
  // lead; an empty array is a product with no photo yet, which the shop renders
  // with its silhouette fallback.
  images: ProductImage[];
}

export interface DropWithProducts extends Drop {
  products: ProductWithSizes[];
}

// A product as the admin's products list shows it: the row itself, plus the drop
// it belongs to (name and status — enough to group the flat list and hint which
// pieces are live) and ordered_count, the number of units ordered across
// non-cancelled orders. That tally is what the list shows against min_orders, the
// pre-order target: a cancelled order is not a piece to produce, so its units do
// not count toward it.
export interface AdminProductRow extends Product {
  drop_name: string;
  drop_status: DropStatus;
  ordered_count: number;
}

/* ----------------------------------------------------------- product writes */

// Field bounds for the admin's product create/edit form, shared so the form's
// HTML5 hints and the API's validation agree on one definition. Generous — these
// are integrity caps on free text, not the real content check — but present, so a
// runaway paste can't bloat a row. Slugs are the storefront URL, so they are
// stored (they must survive a rename) and constrained to a lowercase, hyphenated
// form rather than derived from the name.
export const MAX_SLUG_LEN = 100;
export const MAX_PRODUCT_NAME_LEN = 200;
export const MAX_PRODUCT_DESCRIPTION_LEN = 5000;
export const MAX_FIT_LEN = 100;
export const MAX_FIT_URL_LEN = 500;
// A lowercase, hyphen-separated slug: runs of [a-z0-9] joined by single hyphens,
// no leading/trailing/double hyphen. The admin form prefills it from the name,
// but it is a real stored field the admin can override, not a derived one.
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// The editable fields of a product, validated with the same zod the API enforces
// so the admin form and the endpoint agree on what is allowed. drop_id is absent:
// a product is created into a drop and stays there — moving one between drops is
// not an edit this form makes. Prices are integer rappen, entered and stored the
// same way they reach the QR bill, so nothing is ever converted.
export const productInput = z.object({
  slug: z.string().trim().min(1).max(MAX_SLUG_LEN).regex(SLUG_PATTERN),
  name: z.string().trim().min(1).max(MAX_PRODUCT_NAME_LEN),
  description: z.string().max(MAX_PRODUCT_DESCRIPTION_LEN).default(""),
  price_rappen: z.number().int().min(0),
  fit: z.string().max(MAX_FIT_LEN).default(""),
  fit_url: z.string().max(MAX_FIT_URL_LEN).default(""),
  // The pre-order target: at least one, so a drop can never need zero to produce.
  min_orders: z.number().int().positive(),
  status: z.enum(PRODUCT_STATUSES),
  sort: z.number().int().min(0).default(0),
});
export type ProductInput = z.infer<typeof productInput>;

// Creating a product also names the drop it belongs to; the API checks the drop
// exists before inserting. Everything else is the shared editable shape.
export const productCreateInput = productInput.extend({
  drop_id: z.number().int().positive(),
});
export type ProductCreateInput = z.infer<typeof productCreateInput>;

/* ------------------------------------------------------------------ orders */

// The three states an order moves through. Declared as one tuple so the type,
// the DB check constraint's mirror, and the admin's status-update zod all read
// from a single list rather than three that could drift.
export const ORDER_STATUSES = ["pending", "paid", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// Caps on how much one order can carry. These are server-side integrity, not
// abuse defence — the honeypot and per-IP rate limiting the plan calls for
// guard the shop's public checkout, which is the surface a stranger can reach.
// This endpoint is internal and only ever sees the shop process. Because each
// (product, size) variant may appear at most once (see orderInput), MAX_LINE_QTY
// is a real per-variant ceiling, not one a repeated line could multiply past.
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

// A variant is a product and, if it has sizes, its chosen size. The cart is
// keyed by variant, so a well-formed one never repeats one; a payload that does
// is rejected rather than summed, which is what keeps MAX_LINE_QTY a real
// per-variant ceiling instead of one N duplicate lines could multiply past.
function variantKey(line: OrderLineInput): string {
  return `${line.product_id}:${line.size_id ?? "none"}`;
}

// The whole order the checkout posts. No phone (everything is pickup-only) and
// no note (that is the admin's field, not the customer's).
export const orderInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  items: z
    .array(orderLineInput)
    .min(1)
    .max(MAX_ORDER_LINES)
    .refine((items) => new Set(items.map(variantKey)).size === items.length, {
      error: "each product and size may appear at most once",
    }),
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

// The order as the admin list shows it: every field but the receipt token. The
// token guards the public receipt URL, so it is the shop's business (the order
// creation response and the detail view carry it), never the list's — a list
// that flows into a CSV export must not scatter receipt secrets across a file.
export type OrderListRow = Omit<Order, "token">;

// The most an admin note can hold. Generous — it is an internal free-text field
// (a payment chased by hand, a pickup arranged) rather than structured data —
// but capped so a runaway paste can't bloat the row.
export const MAX_NOTE_LEN = 2000;

// The admin's two writes to an existing order, validated with the same zod the
// API enforces so the form and the endpoint agree on what is allowed. Setting
// the status to paid stamps paid_at and any other status clears it; the note is
// free text the customer never sees.
export const orderStatusInput = z.object({
  status: z.enum(ORDER_STATUSES),
});
export type OrderStatusInput = z.infer<typeof orderStatusInput>;

export const orderNoteInput = z.object({
  note: z.string().max(MAX_NOTE_LEN),
});
export type OrderNoteInput = z.infer<typeof orderNoteInput>;

/* ------------------------------------------------------------------- admin */

// Length bounds on admin credentials, shared so the login schema and the
// seed-user CLI agree: a password the CLI accepts must be one the login schema
// will let through, or an admin could be created and then never able to sign in.
// Generous — the real check is the scrypt hash, not the length — but present,
// since a password caps how much a login pays to scrypt and username is free
// text. MIN_PASSWORD_LEN is the floor the CLI enforces when setting a password;
// login itself accepts any non-empty length, since it must verify whatever was
// already set.
export const MIN_PASSWORD_LEN = 8;
export const MAX_PASSWORD_LEN = 200;
export const MAX_USERNAME_LEN = 100;

// What the admin posts to the API's login route. The admin holds no database,
// so the API is the only place a password is checked; this is the one shape both
// sides agree on.
export const loginInput = z.object({
  username: z.string().trim().min(1).max(MAX_USERNAME_LEN),
  password: z.string().min(1).max(MAX_PASSWORD_LEN),
});
export type LoginInput = z.infer<typeof loginInput>;

// The public shape of an admin user: everything but the password hash, which
// never leaves the API. Field names mirror the admin_users columns, so the login
// response is the row with the hash removed and nothing else translated. `active`
// is the stored 0/1 integer; a login only ever succeeds for an active user.
export interface AdminUser {
  id: number;
  username: string;
  active: number;
  created_at: string;
  // The login *before* this one — the route returns the row as it read it and
  // then stamps the new time — so it is null for a user who has never logged in.
  last_login_at: string | null;
}
