import { createHash } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MAX_UPLOAD_BYTES, derivativeWidths } from "@attakk/types";
import sharp, { type Metadata } from "sharp";

// Raised when an upload is not a usable image. The route maps every code to a
// 400 — the difference is only for logging, since the customer never sees this
// endpoint and the admin only ever sends a file it just picked.
export class ImageError extends Error {
  constructor(public code: "too_large" | "unreadable" | "unsupported_format") {
    super(code);
    this.name = "ImageError";
  }
}

export interface ImageDerivative {
  width: number;
  webp: Buffer;
}

export interface ProcessedImage {
  // sha256 of the original bytes, first 16 hex chars: the filename stem shared
  // by the original and every derivative, and content-addressed so the same
  // upload twice reuses the same files and the shop can cache them forever.
  hash: string;
  ext: string;
  // Intrinsic dimensions with EXIF orientation already applied, so a portrait
  // shot from a phone reports the size the browser will actually see.
  width: number;
  height: number;
  // A tiny blurred webp inlined as a data URI, painted while the real image
  // loads. Small enough to travel in the database row.
  placeholder: string;
  // The untouched upload, EXIF and all — kept for regenerating derivatives
  // later, never served to the browser (see ORIGINALS_DIR).
  original: Buffer;
  derivatives: ImageDerivative[];
}

// The extension an upload is stored under, decided from sharp's decode result
// rather than the filename. sharp decodes AVIF and HEIC alike with the HEIF
// decoder and reports format "heif" for both, so the accepted one — AVIF — is
// the AV1-compressed variant; HEIC is HEVC and stays rejected. Anything not on
// the list returns null and is refused as unsupported.
function storedExt(meta: Metadata): string | null {
  switch (meta.format) {
    case "jpeg":
      return "jpg";
    case "png":
      return "png";
    case "webp":
      return "webp";
    case "heif":
      return meta.compression === "av1" ? "avif" : null;
    default:
      return null;
  }
}

// Decode, validate and derive from an uploaded image, touching no disk. The
// original is trusted only after sharp has read it: the format check is against
// the decoded pixels, not the filename, so a .jpg full of anything else is
// rejected here rather than stored. `.rotate()` bakes in EXIF orientation
// before anything is resized, and sharp drops all other metadata by default —
// so the GPS a phone writes into a photo never survives into a derivative.
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  if (input.length > MAX_UPLOAD_BYTES) throw new ImageError("too_large");

  try {
    const meta = await sharp(input, { failOn: "error" }).metadata();

    const ext = storedExt(meta);
    if (!ext) throw new ImageError("unsupported_format");
    if (meta.width === undefined || meta.height === undefined) {
      throw new ImageError("unreadable");
    }

    // Orientation 5–8 rotate the image a quarter turn, so the upright
    // dimensions are the stored ones swapped. Everything downstream calls
    // .rotate(), which produces exactly these dimensions.
    const swap = meta.orientation !== undefined && meta.orientation >= 5;
    const width = swap ? meta.height : meta.width;
    const height = swap ? meta.width : meta.height;

    const hash = createHash("sha256").update(input).digest("hex").slice(0, 16);

    // The derivatives and the placeholder are independent re-encodes of the
    // same decoded pixels, so run them together and let sharp's threadpool do
    // them at once rather than one after another. Promise.all preserves the
    // ascending width order the map produces.
    const [derivatives, placeholderWebp] = await Promise.all([
      Promise.all(
        derivativeWidths(width).map(async (w): Promise<ImageDerivative> => ({
          width: w,
          webp: await sharp(input, { failOn: "error" })
            .rotate()
            .resize({ width: w, withoutEnlargement: true })
            .webp()
            .toBuffer(),
        })),
      ),
      sharp(input, { failOn: "error" })
        .rotate()
        .resize({ width: 20, withoutEnlargement: true })
        .blur()
        .webp({ quality: 40 })
        .toBuffer(),
    ]);

    const placeholder = `data:image/webp;base64,${placeholderWebp.toString("base64")}`;

    return {
      hash,
      ext,
      width,
      height,
      placeholder,
      original: input,
      derivatives,
    };
  } catch (err) {
    // A validation failure already carries its own code; anything else is sharp
    // failing to decode or encode the bytes — still the client's bad upload, so
    // a 400 (unreadable), never a 500. This catches the middle case a
    // header-only metadata read misses: bytes that parse but do not decode.
    if (err instanceof ImageError) throw err;
    throw new ImageError("unreadable");
  }
}

// Where a processed image's files land: the browser-served webp derivatives
// under uploadsDir, the pristine original under originalsDir. Passed in rather
// than read from ./db so processing and persistence stay decoupled from the
// connection and are trivially testable against a throwaway directory.
export interface ImageDirs {
  uploadsDir: string;
  originalsDir: string;
}

export async function writeImageFiles(
  dirs: ImageDirs,
  img: ProcessedImage,
): Promise<void> {
  await Promise.all([
    writeFile(join(dirs.originalsDir, `${img.hash}.${img.ext}`), img.original),
    ...img.derivatives.map((d) =>
      writeFile(join(dirs.uploadsDir, `${img.hash}-${d.width}.webp`), d.webp),
    ),
  ]);
}

// Remove every file a stored image left on disk. `width` is the intrinsic width
// from the row, which reproduces the exact derivative set writeImageFiles wrote
// via the shared derivativeWidths. Missing files are ignored so a delete stays
// idempotent — a half-written upload or a repeated delete does not throw. This
// is a primitive: the caller decides whether the files are still referenced by
// another row (see the delete route) before calling it.
export async function removeImageFiles(
  dirs: ImageDirs,
  img: { hash: string; ext: string; width: number },
): Promise<void> {
  const paths = [
    join(dirs.originalsDir, `${img.hash}.${img.ext}`),
    ...derivativeWidths(img.width).map((w) =>
      join(dirs.uploadsDir, `${img.hash}-${w}.webp`),
    ),
  ];
  await Promise.all(paths.map((p) => unlink(p).catch(() => undefined)));
}
