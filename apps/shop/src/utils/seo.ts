import type { ProductWithDrop } from "@attakk/types";
import { NOINDEX_ROUTES, SITE_NAME } from "../consts.ts";

const normalize = (path: string) => `/${path.replace(/^\/+|\/+$/g, "")}`;

const excluded = new Set(NOINDEX_ROUTES.map(normalize));

export function isNoindexRoute(pathname: string): boolean {
  return excluded.has(normalize(pathname));
}

// Structured data for a product page: schema.org Product + Offer, so a search
// result can carry price and availability without a visit. The store takes no
// accounts and no card payment — every live piece is made on demand, so a live
// drop's product reads as PreOrder rather than InStock; an archived drop keeps
// its page but reads OutOfStock, since ordering there has closed. Returned as a
// JSON string ready for a `<script type="application/ld+json">`'s `set:html`.
export function productJsonLd(
  product: ProductWithDrop,
  url: URL,
  imageUrl?: URL,
): string {
  const availability =
    product.drop.status === "archived"
      ? "https://schema.org/OutOfStock"
      : "https://schema.org/PreOrder";

  const json = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description || product.fit || undefined,
    sku: product.slug,
    image: imageUrl ? [imageUrl.href] : undefined,
    brand: { "@type": "Brand", name: SITE_NAME },
    offers: {
      "@type": "Offer",
      url: url.href,
      priceCurrency: "CHF",
      price: (product.price_rappen / 100).toFixed(2),
      availability,
    },
  });

  // JSON.stringify never escapes `<`, so a product name or description holding
  // `</script>` — both are free text entered in the admin — would close the tag
  // early and let the rest run as HTML on a public page. `set:html` inserts this
  // verbatim, so the escaping has to happen here, not at the call site.
  return json.replace(/</g, "\\u003c");
}
