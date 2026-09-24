import type {
  AdminProductRow,
  AdminUser,
  Drop,
  DropStatus,
  DropWithProducts,
  OrderListRow,
  OrderWithItems,
  ProductSize,
  ProductWithDrop,
  ProductWithSizes,
  Settings,
} from "@attakk/types";
import {
  adminUsers,
  allDrops,
  allOrders,
  settings as seedSettings,
} from "./fixtures.js";

// What the mock remembers between requests. The handlers used to answer every
// write with a canned row and keep reading from frozen fixtures, so a create
// never appeared in its list, a rename read back as the old name and a delete
// left the row in place — dev mode and the admin's tests could both look right
// while the flow they showed was not one the real API would produce.
//
// The fixtures stay exactly what they were: immutable seed data, replayed row
// for row by the API's contract test. This module deep-copies them into a store
// the handlers read and write, and hands back the same projections the API's
// repositories build — the list shapes are derived here the way fixtures.ts
// derives its own, so a stored change shows up in every read that should see it.

// Ids assigned to rows the mock creates. Deliberately far from any fixture's, so
// a synthetic row is recognisable on sight, and counted up from there so two
// creates in one session do not collide.
const FIRST_NEW_DROP_ID = 800;
const FIRST_NEW_PRODUCT_ID = 900;
const FIRST_NEW_SIZE_ID = 950;
const FIRST_NEW_IMAGE_ID = 1100;
const FIRST_NEW_ORDER_ID = 600;
const FIRST_NEW_ADMIN_USER_ID = 700;

// Timestamps the API takes from the clock. Fixed here so a mock response is the
// same on every run and a test can assert it.
export const MOCK_PAID_STAMP = "2026-01-05T00:00:00.000Z";
export const MOCK_CREATED_STAMP = "2026-01-05T00:00:00.000Z";

interface MockState {
  // Drops carry their products, the shape the catalogue reads embed and the one
  // the fixtures are written in; every other view is derived from it.
  drops: DropWithProducts[];
  orders: OrderWithItems[];
  settings: Settings;
  adminUsers: AdminUser[];
  nextDropId: number;
  nextProductId: number;
  nextSizeId: number;
  nextImageId: number;
  nextOrderId: number;
  nextAdminUserId: number;
}

function seed(): MockState {
  return {
    drops: structuredClone(allDrops),
    orders: structuredClone(allOrders),
    settings: structuredClone(seedSettings),
    adminUsers: structuredClone(adminUsers),
    nextDropId: FIRST_NEW_DROP_ID,
    nextProductId: FIRST_NEW_PRODUCT_ID,
    nextSizeId: FIRST_NEW_SIZE_ID,
    nextImageId: FIRST_NEW_IMAGE_ID,
    nextOrderId: FIRST_NEW_ORDER_ID,
    nextAdminUserId: FIRST_NEW_ADMIN_USER_ID,
  };
}

let state = seed();

// Put every table back to the seeded fixtures. Call it between tests, the way a
// suite resets handler overrides — without it one test's writes are the next
// one's starting point.
export function resetMockState(): void {
  state = seed();
}

/* ------------------------------------------------------------------- drops */

// A drop without the products it carries — what the admin's list and detail
// return, and what a product read embeds.
function dropRow(drop: DropWithProducts): Drop {
  const { products, ...row } = drop;
  void products;
  return row;
}

export function dropsWithProducts(): DropWithProducts[] {
  return state.drops;
}

export function dropsByStatus(status: DropStatus): DropWithProducts[] {
  return state.drops.filter((d) => d.status === status);
}

export function dropRows(): Drop[] {
  return state.drops.map(dropRow);
}

export function dropBySlug(slug: string): DropWithProducts | undefined {
  return state.drops.find((d) => d.slug === slug);
}

export function dropRowById(id: number): Drop | undefined {
  const drop = state.drops.find((d) => d.id === id);
  return drop && dropRow(drop);
}

export function dropExists(id: number): boolean {
  return state.drops.some((d) => d.id === id);
}

// Whether a slug is already taken, optionally ignoring the drop being edited —
// re-saving a drop under its own slug is not a clash.
export function dropSlugTaken(slug: string, exceptId?: number): boolean {
  return state.drops.some((d) => d.slug === slug && d.id !== exceptId);
}

export function createDrop(input: Omit<Drop, "id">): Drop {
  const drop: DropWithProducts = {
    ...input,
    id: state.nextDropId++,
    products: [],
  };
  state.drops.push(drop);
  return dropRow(drop);
}

export function updateDrop(
  id: number,
  input: Omit<Drop, "id">,
): Drop | undefined {
  const drop = state.drops.find((d) => d.id === id);
  if (!drop) return undefined;
  Object.assign(drop, input);
  return dropRow(drop);
}

export function setDropStatus(
  id: number,
  status: DropStatus,
): Drop | undefined {
  const drop = state.drops.find((d) => d.id === id);
  if (!drop) return undefined;
  drop.status = status;
  return dropRow(drop);
}

/* ---------------------------------------------------------------- products */

function allProducts(): ProductWithSizes[] {
  return state.drops.flatMap((d) => d.products);
}

export function productById(id: number): ProductWithSizes | undefined {
  return allProducts().find((p) => p.id === id);
}

// The storefront's single-product read: the product with the bare drop it
// belongs to attached.
export function productWithDropBySlug(
  slug: string,
): ProductWithDrop | undefined {
  for (const drop of state.drops) {
    const product = drop.products.find((p) => p.slug === slug);
    if (product) return { ...product, drop: dropRow(drop) };
  }
  return undefined;
}

export function productSlugTaken(slug: string, exceptId?: number): boolean {
  return allProducts().some((p) => p.slug === slug && p.id !== exceptId);
}

// The admin's flat list: every product in drop-then-product order, without the
// sizes and images the list does not show, annotated with its drop and the units
// ordered across non-cancelled orders.
export function adminProductRows(): AdminProductRow[] {
  const ordered = new Map<number, number>();
  for (const order of state.orders) {
    if (order.status === "cancelled") continue;
    for (const item of order.items) {
      ordered.set(
        item.product_id,
        (ordered.get(item.product_id) ?? 0) + item.qty,
      );
    }
  }
  return state.drops.flatMap((drop) =>
    drop.products.map((product) => {
      const { sizes, images, ...row } = product;
      void sizes;
      void images;
      return {
        ...row,
        drop_name: drop.name,
        drop_status: drop.status,
        ordered_count: ordered.get(product.id) ?? 0,
      };
    }),
  );
}

export function createProduct(
  input: Omit<ProductWithSizes, "id" | "sizes" | "images">,
): ProductWithSizes | undefined {
  const drop = state.drops.find((d) => d.id === input.drop_id);
  if (!drop) return undefined;
  const product: ProductWithSizes = {
    ...input,
    id: state.nextProductId++,
    sizes: [],
    images: [],
  };
  drop.products.push(product);
  return product;
}

export function updateProduct(
  id: number,
  input: Omit<ProductWithSizes, "id" | "drop_id" | "sizes" | "images">,
): ProductWithSizes | undefined {
  const product = productById(id);
  if (!product) return undefined;
  Object.assign(product, input);
  return product;
}

// Replace a product's size list, keeping the ids of the rows that stay so an
// order line still points at the size it was bought in. New rows take a
// synthetic id.
export function setProductSizes(
  id: number,
  sizes: readonly { id?: number; label: string; sort: number }[],
): ProductWithSizes | undefined {
  const product = productById(id);
  if (!product) return undefined;
  product.sizes = sizes.map((s): ProductSize => ({
    id: s.id ?? state.nextSizeId++,
    label: s.label,
    sort: s.sort,
  }));
  return product;
}

export function deleteProduct(id: number): boolean {
  for (const drop of state.drops) {
    const i = drop.products.findIndex((p) => p.id === id);
    if (i !== -1) {
      drop.products.splice(i, 1);
      return true;
    }
  }
  return false;
}

// The purchasable products and each one's size ids: the pieces of a live drop,
// which is what the API prices a cart line against. A drop archived through the
// mock takes its products out of this, the way it does in the real API.
export function purchasableSizes(): Map<number, Set<number>> {
  return new Map(
    dropsByStatus("live").flatMap((d) =>
      d.products.map((p) => [p.id, new Set(p.sizes.map((s) => s.id))] as const),
    ),
  );
}

/* ------------------------------------------------------------------ orders */

export function orders(): OrderWithItems[] {
  return state.orders;
}

export function orderById(id: number): OrderWithItems | undefined {
  return state.orders.find((o) => o.id === id);
}

// The list projection: no line items, no receipt token.
export function orderListRows(): OrderListRow[] {
  return state.orders.map((order) => {
    const { items, token, ...row } = order;
    void items;
    void token;
    return row;
  });
}

// The (product, size) pairs an order line references, so a size still in use
// cannot be dropped — counted regardless of status, since a cancelled order
// still records what it was for.
export function sizesInUse(): Set<string> {
  return new Set(
    state.orders.flatMap((o) =>
      o.items.flatMap((i) =>
        i.size_id === null ? [] : [`${i.product_id}:${i.size_id}`],
      ),
    ),
  );
}

export function productHasOrders(productId: number): boolean {
  return state.orders.some((o) =>
    o.items.some((i) => i.product_id === productId),
  );
}

/* ---------------------------------------------------------------- settings */

export function currentSettings(): Settings {
  return state.settings;
}

export function saveSettings(value: Settings): Settings {
  state.settings = value;
  return state.settings;
}

/* ------------------------------------------------------------- admin users */

export function adminUserList(): AdminUser[] {
  return state.adminUsers;
}

export function adminUserById(id: number): AdminUser | undefined {
  return state.adminUsers.find((u) => u.id === id);
}

export function adminUsernameTaken(username: string): boolean {
  return state.adminUsers.some((u) => u.username === username);
}

export function activeAdminCount(): number {
  return state.adminUsers.filter((u) => u.active === 1).length;
}
