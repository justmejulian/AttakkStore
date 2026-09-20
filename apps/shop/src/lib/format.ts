import { derivativeWidths, type ProductImage } from "@attakk/types";

// Formatting the storefront does to the raw values the API hands it: prices in
// integer rappen, and the on-disk image derivatives a ProductImage row implies.

// A price for display, from integer rappen. Whole francs show as "95"; a
// remainder shows both places, "13.50" — the compact form the product card
// wants beside a "CHF" mark, never a float that could read a centime off.
export function formatFrancs(rappen: number): string {
  return rappen % 100 === 0 ? String(rappen / 100) : (rappen / 100).toFixed(2);
}

// Product images are served off the uploads volume, mounted read-only into the
// shop container at /uploads — files go straight off disk to the browser with no
// proxy hop (the API stays the only writer). Filenames are content-hashed, so a
// derivative is `{hash}-{width}.webp`; both the widths that exist and the markup
// that asks for them come from derivativeWidths, so they cannot disagree.
const UPLOADS_BASE = "/uploads";

function derivativeUrl(hash: string, width: number): string {
  return `${UPLOADS_BASE}/${hash}-${width}.webp`;
}

// The srcset for an image: one candidate per derivative width, so the browser
// picks the smallest file that fills the slot. Widths come from the stored
// intrinsic width without touching disk — a small original yields one candidate
// at its own width rather than an upscale.
export function imageSrcset(image: ProductImage): string {
  return derivativeWidths(image.width)
    .map((w) => `${derivativeUrl(image.hash, w)} ${w}w`)
    .join(", ");
}

// The plain `src`, for browsers that ignore srcset: the smallest derivative, so
// the fallback is the cheapest file rather than the largest.
export function imageSrc(image: ProductImage): string {
  return derivativeUrl(image.hash, derivativeWidths(image.width)[0]);
}
