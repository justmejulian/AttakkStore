import { readFileSync } from "node:fs";
import type { DropStatus } from "@attakk/types";
import { db } from "../db.js";
import { IMAGE_DIRS } from "../image-lifecycle.js";
import { ImageError, processImage, writeImageFiles } from "../images.js";
import {
  createDrop,
  DropError,
  listDropsForAdmin,
} from "../repositories/admin-drops.js";
import {
  createProduct,
  setProductSizes,
} from "../repositories/admin-products.js";
import { addProductImage } from "../repositories/images.js";

// One-off: loads the real catalogue out of the old site's last Stripe export
// and writes it into this API's database through the same repositories the
// admin panel uses. Run once against the production volume, then the admin
// reviews and publishes from the panel (plan doc step 29); kept for reference.
// No Stripe API call is made; the old export already carries everything (name,
// price in rappen, sizes, images).
//
// The data is not committed: stripe-import-data.json (a plain dump of
// attakk-store-old/src/content/importedProducts.ts, itself generated from the
// live Stripe account) is gitignored and has to be put next to this script by
// hand before running — in src/cli/ for dev, in dist/cli/ in the container.
//
//   pnpm --filter @attakk/api exec tsx --conditions=source src/cli/import-stripe-products.ts
//   node dist/cli/import-stripe-products.js   (in the container)

interface RawEntry {
  id: string;
  title: string;
  description: string;
  imageUrls: string[];
  price: number;
  sex: "Male" | "Female" | "Unisex";
  fitUrl?: string;
  drop?: string;
  sizes: Record<string, { stripeProductId: string }>;
}

// The old export has no drop for four 2025 pieces (they predate the `drop`
// metadata field) — they belong with the one 2025 product that does carry
// `invincible-2025`, so that's the fallback for anything untagged. Everything
// else names its drop explicitly. Colours are left blank (the shop falls back
// to the site palette) since Stripe never carried a colourway — a human picks
// real drop colours in the admin before launch.
const FALLBACK_DROP_SLUG = "invincible-2025";

const DROP_CONFIG: Record<
  string,
  { name: string; year: number; no: number; status: DropStatus }
> = {
  "redline-2026": { name: "Redline", year: 2026, no: 1, status: "draft" },
  "core-2026": { name: "Core", year: 2026, no: 2, status: "draft" },
  "viper-2026": { name: "Viper", year: 2026, no: 3, status: "draft" },
  "invincible-2025": {
    name: "Invincible",
    year: 2025,
    no: 0,
    status: "archived",
  },
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const dropIds = new Map<string, number>();
const dropSort = new Map<string, number>();

function getOrCreateDrop(slug: string): number {
  const existing = dropIds.get(slug);
  if (existing !== undefined) return existing;

  const cfg = DROP_CONFIG[slug];
  if (!cfg) throw new Error(`no DROP_CONFIG entry for drop "${slug}"`);

  try {
    const drop = createDrop({
      slug,
      name: cfg.name,
      year: cfg.year,
      no: cfg.no,
      status: cfg.status,
      sort: dropIds.size,
      tagline: "",
      body: "",
      note: "",
      color_primary: "",
      color_secondary: "",
      color_accent: "",
      color_text: "",
      display_font: "Antonio",
      theme_base: "dark",
    });
    dropIds.set(slug, drop.id);
    console.log(`created drop ${slug} (#${drop.id})`);
    return drop.id;
  } catch (err) {
    if (err instanceof DropError && err.code === "slug_taken") {
      const found = listDropsForAdmin().find((d) => d.slug === slug);
      if (!found) throw err;
      dropIds.set(slug, found.id);
      console.log(`drop ${slug} already exists (#${found.id}), reusing`);
      return found.id;
    }
    throw err;
  }
}

function nextDropSort(slug: string): number {
  const n = dropSort.get(slug) ?? 0;
  dropSort.set(slug, n + 1);
  return n;
}

// Product slugs are derived deterministically from title + sex, so a slug
// already in the table means this exact entry was imported by an earlier,
// interrupted run of this same script — not a genuine name clash with some
// other product. Checking first lets a rerun resume past whatever already
// landed instead of creating a duplicate row under a numbered-suffix slug.
const productBySlugStmt = db.prepare(`SELECT id FROM products WHERE slug = ?`);

function findExistingProduct(slug: string): { id: number } | undefined {
  return productBySlugStmt.get(slug) as { id: number } | undefined;
}

async function importImages(
  productId: number,
  productName: string,
  urls: string[],
): Promise<{ failed: number }> {
  let failed = 0;
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const processed = await processImage(buffer);
      await writeImageFiles(IMAGE_DIRS, processed);
      addProductImage({
        product_id: productId,
        hash: processed.hash,
        ext: processed.ext,
        alt: productName,
        placeholder: processed.placeholder,
        width: processed.width,
        height: processed.height,
      });
    } catch (err) {
      failed++;
      const reason = err instanceof ImageError ? err.code : String(err);
      console.warn(`  image failed for ${productName} (${url}): ${reason}`);
    }
  }
  return { failed };
}

async function main() {
  const dataPath = new URL("./stripe-import-data.json", import.meta.url);
  const entries: RawEntry[] = JSON.parse(readFileSync(dataPath, "utf8"));

  let created = 0;
  let skipped = 0;
  let failed = 0;
  let imagesFailed = 0;
  const productsWithImageIssues: string[] = [];

  for (const entry of entries) {
    const dropSlug = entry.drop ?? FALLBACK_DROP_SLUG;
    const dropId = getOrCreateDrop(dropSlug);

    const genderSuffix =
      entry.sex === "Female"
        ? " (Women)"
        : entry.sex === "Male"
          ? " (Men)"
          : "";
    const name = `${entry.title}${genderSuffix}`;
    const slug = slugify(name);

    const existing = findExistingProduct(slug);
    if (existing) {
      console.log(`already imported: ${name} (#${existing.id}) — skipping`);
      skipped++;
      continue;
    }

    try {
      const product = createProduct({
        drop_id: dropId,
        slug,
        name,
        description: entry.description ?? "",
        price_rappen: entry.price,
        fit: "",
        fit_url: entry.fitUrl ?? "",
        min_orders: 1,
        status: "draft",
        sort: nextDropSort(dropSlug),
      });

      const sizes = Object.keys(entry.sizes).map((label, i) => ({
        label,
        sort: i,
      }));
      if (sizes.length > 0) setProductSizes(product.id, sizes);

      const images = await importImages(
        product.id,
        name,
        entry.imageUrls ?? [],
      );
      if (images.failed > 0) {
        imagesFailed += images.failed;
        productsWithImageIssues.push(name);
      }

      console.log(
        `imported ${name} -> ${dropSlug}/${product.slug} (#${product.id})`,
      );
      created++;
    } catch (err) {
      console.error(`failed to import ${name}:`, err);
      failed++;
    }
  }

  console.log(
    `\ndone: ${created} imported, ${skipped} already imported, ${failed} failed`,
  );
  if (productsWithImageIssues.length > 0) {
    console.log(
      `${imagesFailed} image(s) failed across ${productsWithImageIssues.length} product(s), re-run to retry: ${productsWithImageIssues.join(", ")}`,
    );
  }
  if (failed > 0 || imagesFailed > 0) process.exitCode = 1;
}

await main();
