import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { APIRoute } from "astro";

// Product photos, served off the uploads volume. The API writes the webp
// derivatives; the volume is mounted read-only into this container at /uploads,
// so files go straight from disk to the browser with no hop through the API.
// Filenames are content-hashed (`<hash>-<width>.webp`), so a file never changes
// under its name and can be cached for a year.
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? "/uploads";

// Only a hashed derivative name gets through: no separators, no traversal.
const DERIVATIVE = /^[0-9a-f]+-\d+\.webp$/;

export const GET: APIRoute = async ({ params }) => {
  const name = params.file ?? "";
  if (!DERIVATIVE.test(name)) return new Response(null, { status: 404 });
  try {
    const file = await readFile(join(UPLOADS_DIR, name));
    return new Response(file, {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(file.length),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
};
