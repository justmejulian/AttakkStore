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

// The three states a drop moves through, as one tuple so the type, the DB check
// constraint's mirror, and the admin's write zod read from a single list rather
// than three that could drift (the same shape PRODUCT_STATUSES gives products).
export const DROP_STATUSES = ["draft", "live", "archived"] as const;
export type DropStatus = (typeof DROP_STATUSES)[number];

// The three states a product moves through. One tuple so the type, the DB check
// constraint's mirror, and the admin's write zod all read from a single list
// rather than three that could drift (the same shape ORDER_STATUSES gives orders).
export const PRODUCT_STATUSES = ["draft", "live", "hidden"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

// Whether a drop's collection sits on a light or dark base, mirrored by the DB
// check constraint and the admin's write zod from this one tuple.
export const THEME_BASES = ["light", "dark"] as const;
export type ThemeBase = (typeof THEME_BASES)[number];

// The fixed set of faces the site ships — an arbitrary name would mean loading
// a webfont at runtime, so the admin picks from this list, which the write zod
// enforces (the DB column has no check constraint of its own).
export const DISPLAY_FONTS = [
  "Antonio",
  "Permanent Marker",
  "JetBrains Mono",
  "Urbanist",
] as const;
export type DisplayFont = (typeof DISPLAY_FONTS)[number];

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

// One product read for its storefront page: the full product plus the bare drop
// it belongs to (a Drop, not a DropWithProducts, so there is no cycle). The page
// needs the drop the product row alone does not carry — its colours and font for
// the collection theme, its status (an archived drop keeps its pieces visible but
// they cannot be bought) and its name and slug for a link back to the collection.
// The list reads embed products inside a drop; this single read embeds the drop
// inside the product, the inverse.
export interface ProductWithDrop extends ProductWithSizes {
  drop: Drop;
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

// Size labels are free text ('S', 'S–M', 'One Size'), bounded and non-empty, and
// unique within a product so a duplicate 'M' can't make two indistinguishable
// pills. A product may have none (the size-less cap). Capped in count so a
// runaway submission can't insert thousands of rows.
export const MAX_SIZE_LABEL_LEN = 50;
export const MAX_PRODUCT_SIZES = 50;

// One size in the desired list a product-sizes edit submits. An existing size
// carries its id (so a size an order already references keeps that id and its
// order history); a new size omits it and the API assigns one.
export const sizeInput = z.object({
  id: z.number().int().positive().optional(),
  label: z.string().trim().min(1).max(MAX_SIZE_LABEL_LEN),
  sort: z.number().int().min(0).default(0),
});
export type SizeInput = z.infer<typeof sizeInput>;

// The whole desired size set for a product — a full replace, matching how the
// edit form submits: the API reconciles current rows to this (insert new, update
// kept, delete removed), refusing to delete a size an order references. Labels
// must be unique and provided ids must not repeat, so the reconcile has one
// unambiguous target state.
export const productSizesInput = z.object({
  sizes: z
    .array(sizeInput)
    .max(MAX_PRODUCT_SIZES)
    .refine((list) => new Set(list.map((s) => s.label)).size === list.length, {
      error: "size labels must be unique within a product",
    })
    .refine(
      (list) => {
        const ids = list.flatMap((s) => (s.id === undefined ? [] : [s.id]));
        return new Set(ids).size === ids.length;
      },
      { error: "a size id may not repeat" },
    ),
});
export type ProductSizesInput = z.infer<typeof productSizesInput>;

/* -------------------------------------------------------------- drop writes */

// Field bounds for the admin's drop create/edit form, shared so the form's HTML5
// hints and the API's validation agree. Generous integrity caps on free text, not
// the real content check. The slug bound and pattern are the shared ones products
// use — a drop's URL is a slug on the same terms.
export const MAX_DROP_NAME_LEN = 200;
export const MAX_DROP_TAGLINE_LEN = 500;
export const MAX_DROP_BODY_LEN = 5000;
export const MAX_DROP_NOTE_LEN = 2000;
// A collection's year and number are small positive integers; the year is bounded
// to a sane window so a typo can't store 20260 or a negative.
export const MIN_DROP_YEAR = 2000;
export const MAX_DROP_YEAR = 2100;

// A six-digit hex colour like #e11d2a. Case-insensitive; the shop emits it as a
// CSS custom property verbatim. MAX_HEX_COLOR_LEN is the length of a "#rrggbb"
// value, shared so the admin's colour inputs cap at the same width the pattern
// allows rather than a bare literal.
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
export const MAX_HEX_COLOR_LEN = 7;

// A drop's colour override: a valid hex, or empty to fall back to the site
// palette. Not required — a collection that sets no colours simply inherits the
// site defaults — so an empty string is valid, anything non-empty must be hex.
const hexColor = z
  .string()
  .trim()
  .refine((v) => v === "" || HEX_COLOR_PATTERN.test(v), {
    message: "must be a six-digit hex colour like #e11d2a, or empty",
  })
  .default("");

// The editable fields of a drop, validated with the same zod the API enforces so
// the admin form and the endpoint agree. A drop has no parent, so create and edit
// share one shape (unlike products, whose create names a drop). Colours and the
// display font are the theming the shop reads off the drop row; theme_base and
// display_font come from fixed lists so the shop never loads an arbitrary webfont
// or an unknown base.
export const dropInput = z.object({
  slug: z.string().trim().min(1).max(MAX_SLUG_LEN).regex(SLUG_PATTERN),
  name: z.string().trim().min(1).max(MAX_DROP_NAME_LEN),
  year: z.number().int().min(MIN_DROP_YEAR).max(MAX_DROP_YEAR),
  no: z.number().int().min(0),
  status: z.enum(DROP_STATUSES),
  sort: z.number().int().min(0).default(0),
  tagline: z.string().max(MAX_DROP_TAGLINE_LEN).default(""),
  body: z.string().max(MAX_DROP_BODY_LEN).default(""),
  note: z.string().max(MAX_DROP_NOTE_LEN).default(""),
  color_primary: hexColor,
  color_secondary: hexColor,
  color_accent: hexColor,
  color_text: hexColor,
  display_font: z.enum(DISPLAY_FONTS),
  theme_base: z.enum(THEME_BASES),
});
export type DropInput = z.infer<typeof dropInput>;

// The archive control: the drops list has a status dropdown that saves on change,
// so a single-field write moves a drop between draft, live and archived without
// opening the edit form. Archiving is reversible — nothing else about the drop or
// its orders changes — which is why it is just a status flip (same shape
// orderStatusInput gives orders).
export const dropStatusInput = z.object({
  status: z.enum(DROP_STATUSES),
});
export type DropStatusInput = z.infer<typeof dropStatusInput>;

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
export const cartInput = z.object({
  items: z
    .array(orderLineInput)
    .min(1)
    .max(MAX_ORDER_LINES)
    .refine((items) => new Set(items.map(variantKey)).size === items.length, {
      error: "each product and size may appear at most once",
    }),
});
export type CartInput = z.infer<typeof cartInput>;
export const orderInput = cartInput.extend({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
});
export type OrderInput = z.infer<typeof orderInput>;

export interface CartQuote {
  items: (Omit<OrderItem, "id"> & { line_total_rappen: number })[];
  total_rappen: number;
}

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

// What an admin posts to create another admin user. Unlike loginInput, the
// password holds to MIN_PASSWORD_LEN, not just a non-empty length: login must
// verify whatever hash was already stored, but here a new password is being set,
// so it takes the same floor the seed CLI enforces — a user created this way is
// one that login will later accept. The API hashes the password; it never reaches
// the database in the clear and never leaves in a response.
export const adminUserCreateInput = z.object({
  username: z.string().trim().min(1).max(MAX_USERNAME_LEN),
  password: z.string().min(MIN_PASSWORD_LEN).max(MAX_PASSWORD_LEN),
});
export type AdminUserCreateInput = z.infer<typeof adminUserCreateInput>;

// The active flag an admin flips to deactivate or restore another user. `active`
// is a flag rather than a delete, so a deactivated admin's past actions stay
// attributable; the flip is reversible, so both directions share this one shape.
export const adminActiveInput = z.object({ active: z.boolean() });
export type AdminActiveInput = z.infer<typeof adminActiveInput>;

/* ------------------------------------------------------------- settings */

// The settings table is a flat key/value store the admin's Settings screen
// writes: whether the shop takes orders, the creditor the QR bill is paid to,
// and the address a new-order notification goes to. One shape here so the API,
// the admin form and the storefront agree on the keys and what a valid value is.
// The keys are the storage keys, so a Settings object maps one-to-one onto rows.
export interface Settings {
  shop_open: boolean;
  creditor_name: string;
  creditor_address: string;
  creditor_building_number: string;
  creditor_zip: string;
  creditor_city: string;
  creditor_country: string;
  creditor_account: string;
  notify_email: string;
}

// The creditor block's caps mirror the Swiss QR-bill's own limits, so a value
// the form accepts is one swissqrbill will also accept rather than reject at bill
// time.
export const MAX_CREDITOR_NAME_LEN = 70;
export const MAX_CREDITOR_ADDRESS_LEN = 70;
export const MAX_CREDITOR_BUILDING_NUMBER_LEN = 16;
export const MAX_CREDITOR_ZIP_LEN = 16;
export const MAX_CREDITOR_CITY_LEN = 35;

// A Swiss QR bill is paid to a CH or LI account, so a stored IBAN must carry one
// of those country codes, be the right length (21 characters) and pass the ISO
// 7064 mod-97-10 checksum. A typo here prints bills nobody can pay and you would
// only hear about it from a customer, so it is checked before it is ever saved.
// Blank is allowed and means "not configured" — the API falls back to a
// placeholder creditor so a bill can still be generated in dev; this rejects
// only a non-blank value that is wrong. Pass a normalised value (no spaces,
// upper case); it normalises internally too so a raw form value is fine.
//
// A QR-IBAN — one whose bank IID (positions 5–9) falls in 30000–31999 — is
// rejected too, even with a valid checksum. Our bills carry an RF creditor
// reference, and swissqrbill forces a QR-IBAN to use a QR reference instead: a
// QR-IBAN would throw at every bill generation, silently dropping the customer's
// confirmation. Since Swiss businesses very often *have* a QR-IBAN, pasting the
// real one is the likeliest mistake, so it is caught here rather than at send.
export function isValidIban(value: string): boolean {
  const iban = value.replace(/\s+/g, "").toUpperCase();
  if (!/^(CH|LI)[0-9]{2}[0-9A-Z]{17}$/.test(iban)) return false;
  const iid = Number(iban.slice(4, 9));
  if (iid >= 30000 && iid <= 31999) return false;
  // Move the four leading characters to the end, expand letters to numbers
  // (A=10 … Z=35), then reduce mod 97 one character at a time so the running
  // value never overflows a JS number. A valid IBAN leaves a remainder of 1.
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const digits = ch >= "0" && ch <= "9" ? ch : String(ch.charCodeAt(0) - 55);
    remainder = Number(String(remainder) + digits) % 97;
  }
  return remainder === 1;
}

// What the admin posts to the API's settings route, validated with the same zod
// the admin form uses so the two agree on what is valid. Every creditor field
// may be blank — an unconfigured shop falls back to a placeholder creditor — but
// a non-blank IBAN, country and notification email are checked. The IBAN is
// normalised (spaces stripped, upper-cased) as it is validated so what lands in
// the settings row is what swissqrbill wants.
export const settingsInput = z.object({
  shop_open: z.boolean(),
  creditor_name: z.string().trim().max(MAX_CREDITOR_NAME_LEN).default(""),
  creditor_address: z.string().trim().max(MAX_CREDITOR_ADDRESS_LEN).default(""),
  creditor_building_number: z
    .string()
    .trim()
    .max(MAX_CREDITOR_BUILDING_NUMBER_LEN)
    .default(""),
  creditor_zip: z.string().trim().max(MAX_CREDITOR_ZIP_LEN).default(""),
  creditor_city: z.string().trim().max(MAX_CREDITOR_CITY_LEN).default(""),
  // The creditor is the shop, which is in Switzerland, so the country is CH (or
  // blank, meaning fall back to the placeholder). A free two-letter field would
  // let a typo like "ZZ" through the checksum-valid IBAN check only to have
  // swissqrbill reject the non-ISO country at bill time, silently dropping the
  // confirmation — the same failure the QR-IBAN guard closes.
  creditor_country: z
    .string()
    .trim()
    .toUpperCase()
    .refine((s) => s === "" || s === "CH", "invalid_country")
    .default(""),
  creditor_account: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s+/g, "").toUpperCase())
    .refine((s) => s === "" || isValidIban(s), "invalid_iban")
    .default(""),
  notify_email: z
    .string()
    .trim()
    .toLowerCase()
    .refine(
      (s) => s === "" || z.email().max(254).safeParse(s).success,
      "invalid_email",
    )
    .default(""),
});
export type SettingsInput = z.infer<typeof settingsInput>;
