import type {
  DropWithProducts,
  OrderInput,
  OrderWithItems,
  ProductImage,
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
