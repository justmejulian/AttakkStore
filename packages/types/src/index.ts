/**
 * @attakk/types — TypeScript types and (later) zod schemas shared by the shop,
 * API and admin, so there is one definition of what a drop, product and order
 * is rather than three that drift apart.
 *
 * These are types only: no runtime values live here, so `import type` from any
 * app erases at compile time and the package never has to be bundled or built.
 * Field names mirror the SQLite columns the API selects, so a response is the
 * row shape with nothing translated in between.
 */

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
