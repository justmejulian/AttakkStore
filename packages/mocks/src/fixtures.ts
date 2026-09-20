import type {
  AdminProductRow,
  AdminUser,
  Drop,
  DropWithProducts,
  OrderInput,
  OrderListRow,
  OrderWithItems,
  ProductImage,
  Settings,
} from "@attakk/types";

// The canned API responses the shop and admin are built against, and the rows
// the API's contract test seeds so its real routes reproduce these exact bytes.
// Everything here is typed against @attakk/types, so a field the API renames or
// drops fails to compile before it can drift; the contract test is what pins the
// values and status codes the types cannot see.
//
// Ids are fixed and disjoint per table (drops 1–2, products 10–12, sizes 100+,
// images 1000+) so the contract test can INSERT them verbatim and read them
// back unchanged. All products here are live: visibility filtering is the
// repository's own tests, not this fixture's job — what this pins is the shape
// and values a live catalogue hands the shop.

const jerseyImages: ProductImage[] = [
  {
    id: 1000,
    hash: "a1b2c3d4e5f60718",
    ext: "webp",
    alt: "Redline jersey, front",
    placeholder: "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQ",
    width: 1600,
    height: 2000,
    sort: 0,
  },
  {
    id: 1001,
    hash: "0f9e8d7c6b5a4938",
    ext: "avif",
    alt: "Redline jersey, back",
    placeholder: "data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAEBcQ",
    width: 1600,
    height: 2000,
    sort: 1,
  },
];

// A live drop with two products: the jersey has sizes and photos, the cap has
// neither — the empty-arrays case the shop renders with its size-less buy button
// and silhouette fallback.
export const redlineDrop: DropWithProducts = {
  id: 1,
  slug: "redline",
  name: "Redline",
  year: 2026,
  no: 1,
  status: "live",
  sort: 0,
  tagline: "Cut from the fast lane.",
  body: "The first drop of the season.",
  note: "",
  color_primary: "#e11d2a",
  color_secondary: "#111111",
  color_accent: "#f5f5f5",
  color_text: "#f5f5f5",
  display_font: "Antonio",
  theme_base: "dark",
  products: [
    {
      id: 10,
      drop_id: 1,
      slug: "redline-jersey",
      name: "Redline Jersey",
      description: "Heavyweight jersey in the drop colourway.",
      price_rappen: 9500,
      fit: "Boxy",
      fit_url: "",
      min_orders: 1,
      status: "live",
      sort: 0,
      sizes: [
        { id: 100, label: "S", sort: 0 },
        { id: 101, label: "M", sort: 1 },
        { id: 102, label: "L", sort: 2 },
      ],
      images: jerseyImages,
    },
    {
      id: 11,
      drop_id: 1,
      slug: "redline-cap",
      name: "Redline Cap",
      description: "One-size cap.",
      price_rappen: 3500,
      fit: "",
      fit_url: "",
      min_orders: 1,
      status: "live",
      sort: 1,
      sizes: [],
      images: [],
    },
  ],
};

// An archived drop: it still serves its page (live-or-archived by slug) but
// never appears in the live collections and its pieces cannot be bought.
export const originsDrop: DropWithProducts = {
  id: 2,
  slug: "origins",
  name: "Origins",
  year: 2025,
  no: 0,
  status: "archived",
  sort: 1,
  tagline: "Where it started.",
  body: "",
  note: "",
  color_primary: "#1d4ed8",
  color_secondary: "#0a0a0a",
  color_accent: "#e5e7eb",
  color_text: "#0a0a0a",
  display_font: "Urbanist",
  theme_base: "light",
  products: [
    {
      id: 12,
      drop_id: 2,
      slug: "origins-tee",
      name: "Origins Tee",
      description: "The tee that opened the archive.",
      price_rappen: 6500,
      fit: "Regular",
      fit_url: "",
      min_orders: 1,
      status: "live",
      sort: 0,
      sizes: [{ id: 120, label: "One Size", sort: 0 }],
      images: [],
    },
  ],
};

// GET /drops — the live collections only, so the archived drop is absent.
export const liveDrops: DropWithProducts[] = [redlineDrop];

// GET /products/:slug — the single-product read, the same shape carried inside a
// drop's `products`.
export const jerseyProduct = redlineDrop.products[0];

/* ------------------------------------------------------------------ orders */

// The cart the shop posts. Prices are absent by design — the API reprices every
// line from its own table — so only ids and quantities travel.
export const orderRequest: OrderInput = {
  email: "buyer@example.com",
  items: [{ product_id: 10, size_id: 101, qty: 2 }],
};

// The order the API returns on a clean checkout: the first order on a fresh
// database, so id 1 and the RF reference derived from it, RF74000001. `token`
// and `created_at` are generated per order — the contract test overrides them
// from the live response before comparing, since they cannot be fixed.
export const createdOrder: OrderWithItems = {
  id: 1,
  reference: "RF74000001",
  token: "00000000000000000000000000000000",
  email: "buyer@example.com",
  phone: "",
  total_rappen: 19000,
  status: "pending",
  created_at: "2026-01-01T00:00:00.000Z",
  paid_at: null,
  note: "",
  items: [
    {
      id: 1,
      product_id: 10,
      size_id: 101,
      qty: 2,
      unit_price_rappen: 9500,
      title: "Redline Jersey",
    },
  ],
};

// The two checkout rejections worth having on hand, since they are the branches
// a consumer writes once and never exercises. The `error` code and `status` are
// the contract the shop reads; the API also returns zod `issues` on a 400, but
// those are diagnostic detail, not part of what either side agrees on.
export interface OrderRejection {
  request: OrderInput;
  status: number;
  error: string;
}

// A cart that repeats one (product, size) variant instead of summing it: the
// zod schema refuses it, so it is a 400, not a silently doubled line.
export const duplicateVariantRejection: OrderRejection = {
  request: {
    email: "buyer@example.com",
    items: [
      { product_id: 10, size_id: 101, qty: 1 },
      { product_id: 10, size_id: 101, qty: 1 },
    ],
  },
  status: 400,
  error: "invalid",
};

// A product that cannot be bought — here an id no live drop carries. Pricing
// refuses the line, which is the request's fault, so it is a 422.
export const unavailableProductRejection: OrderRejection = {
  request: {
    email: "buyer@example.com",
    items: [{ product_id: 999, size_id: null, qty: 1 }],
  },
  status: 422,
  error: "product_unavailable",
};

// Two more stored orders beyond createdOrder, so the admin's list, its status
// filter and its detail view each have a pending, a paid and a cancelled order to
// show. Unlike createdOrder these are never posted, so their ids, tokens and
// timestamps are fixed — they are rows the admin reads, not orders it creates.
export const paidOrder: OrderWithItems = {
  id: 2,
  reference: "RF74000002",
  token: "11111111111111111111111111111111",
  email: "paid@example.com",
  phone: "",
  total_rappen: 3500,
  status: "paid",
  created_at: "2026-01-02T00:00:00.000Z",
  paid_at: "2026-01-03T00:00:00.000Z",
  note: "Paid in person at the shop.",
  items: [
    {
      id: 2,
      product_id: 11,
      size_id: null,
      qty: 1,
      unit_price_rappen: 3500,
      title: "Redline Cap",
    },
  ],
};

export const cancelledOrder: OrderWithItems = {
  id: 3,
  reference: "RF74000003",
  token: "22222222222222222222222222222222",
  email: "cancelled@example.com",
  phone: "",
  total_rappen: 9500,
  status: "cancelled",
  created_at: "2026-01-04T00:00:00.000Z",
  paid_at: null,
  note: "",
  items: [
    {
      id: 3,
      product_id: 10,
      size_id: 100,
      qty: 1,
      unit_price_rappen: 9500,
      title: "Redline Jersey",
    },
  ],
};

// Every stored order the admin can open, newest first — the order id descending
// gives, which is what GET /admin/orders returns.
export const allOrders: OrderWithItems[] = [
  cancelledOrder,
  paidOrder,
  createdOrder,
];

// GET /admin/orders — the list without line items or the receipt token. Items
// load in the detail view (GET /admin/orders/:id) and the token stays out of the
// list entirely, mirroring the API's narrower list projection.
function toListRow(order: OrderWithItems): OrderListRow {
  const { items, token, ...row } = order;
  void items; // the list carries the bare row; the detail view carries the items
  void token; // the receipt token is the shop's, never the list's
  return row;
}
export const orderListRows: OrderListRow[] = allOrders.map(toListRow);

/* ------------------------------------------------------------------ images */

// The row POST /products/:id/images returns once a photo is processed and
// stored — a fresh upload landing at the end of a product's gallery.
export const uploadedImage: ProductImage = {
  id: 1002,
  hash: "c0ffee00c0ffee11",
  ext: "webp",
  alt: "",
  placeholder: "data:image/webp;base64,UklGRiIAAABXRUJQVlA4TBUAAAAvAAAAEDcQ",
  width: 1200,
  height: 1500,
  sort: 0,
};

// Every drop the contract test seeds, live and archived, so its GET routes have
// rows to read. The live subset (liveDrops) is derived from this by the API's
// own status filter, not duplicated here.
export const allDrops: DropWithProducts[] = [redlineDrop, originsDrop];

// GET /admin/drops — every drop, any status, ordered as they sort; the drop
// picker the product create form reads. Just the drop rows, without the products
// each carries (allDrops is already in sort order).
export const adminDrops: Drop[] = allDrops.map((drop) => {
  const { products, ...row } = drop;
  void products; // the admin drops list is the bare rows; products load elsewhere
  return row;
});

/* ---------------------------------------------------------- admin products */

// Units ordered per product, tallied the way the API's list query does — summing
// quantities on every non-cancelled order — so cancelledOrder's line does not
// count. This is what the products list compares against min_orders.
const orderedUnits = new Map<number, number>();
for (const order of allOrders) {
  if (order.status === "cancelled") continue;
  for (const item of order.items) {
    orderedUnits.set(
      item.product_id,
      (orderedUnits.get(item.product_id) ?? 0) + item.qty,
    );
  }
}

// GET /admin/products — every product across every drop the admin can edit, in
// the drop-then-product sort order the API returns (allDrops is already in that
// order, and each drop's products with it). Each row drops the sizes and images
// the list does not show and gains its drop's name and status plus the ordered
// tally. The detail read (GET /admin/products/:id) is the full ProductWithSizes,
// served from the drops fixture by id.
export const adminProducts: AdminProductRow[] = allDrops.flatMap((drop) =>
  drop.products.map((product) => {
    const { sizes, images, ...row } = product;
    void sizes; // the list is the bare row; sizes and images load in the detail
    void images;
    return {
      ...row,
      drop_name: drop.name,
      drop_status: drop.status,
      ordered_count: orderedUnits.get(product.id) ?? 0,
    };
  }),
);

/* ------------------------------------------------------------------- admin */

// The admin user the login mock accepts. The API's contract test seeds this row
// (hashing adminCredentials.password) and replays a login through the real
// route, so the mock's 200 and 401 match the API's. `last_login_at` is null: the
// route returns the row as it read it, reflecting the login before this one,
// which for a never-logged-in user is none.
export const adminUser: AdminUser = {
  id: 1,
  username: "admin",
  active: 1,
  created_at: "2026-01-01T00:00:00.000Z",
  last_login_at: null,
};

// The credentials that unlock adminUser. Only ever a fixture — the real first
// admin is created by the seed-user CLI with a password of its own.
export const adminCredentials = {
  username: "admin",
  password: "correct-horse-battery-staple",
};

// A second, deactivated admin, so the Users list has a switched-off row to show
// and the deactivate/restore control something other than the sole active admin
// to act on. The API's contract test seeds this alongside adminUser, so the
// mock's list matches the real GET /admin/users byte for byte.
export const adminUserDeactivated: AdminUser = {
  id: 2,
  username: "editor",
  active: 0,
  created_at: "2026-02-01T00:00:00.000Z",
  last_login_at: "2026-03-01T09:00:00.000Z",
};

// The Users list, ordered by username the way listAdminUsers orders it
// ("admin" before "editor"), so the mock's GET /admin/users matches the API's.
export const adminUsers: AdminUser[] = [adminUser, adminUserDeactivated];

// The settings the admin's Settings screen reads: shop open, a fully configured
// creditor and a notification address. The IBAN is a checksum-valid standard CH
// account, so a round-trip through the real settingsInput leaves it unchanged.
export const settings: Settings = {
  shop_open: true,
  creditor_name: "ATTAKK Collective",
  creditor_address: "Musterstrasse",
  creditor_building_number: "1",
  creditor_zip: "8000",
  creditor_city: "Zürich",
  creditor_country: "CH",
  creditor_account: "CH5604835012345678009",
  notify_email: "shop@attakk.example",
};
