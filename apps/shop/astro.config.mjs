// @ts-check
import { createReadStream, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, fontProviders } from "astro/config";
import node from "@astrojs/node";
import sitemap from "@astrojs/sitemap";
import { SITE_URL } from "./src/consts.ts";
import { isNoindexRoute } from "./src/utils/seo.ts";

/**
 * Vite DevTools with the Oxc integration, dev-only. The dock and its
 * integration are heavy dev-server modules, so they are dynamically imported
 * and injected only for `astro dev` — never loaded during build or preview,
 * and never shipped in the production image.
 * https://devtools.vite.dev/oxc/
 *
 * @returns {import("astro").AstroIntegration}
 */
function viteDevtools() {
  return {
    name: "attakk:vite-devtools",
    hooks: {
      "astro:config:setup": async ({ command, updateConfig }) => {
        if (command !== "dev") return;
        const [{ DevTools }, { DevToolsOxc }] = await Promise.all([
          import("@vitejs/devtools"),
          import("@vitejs/devtools-oxc/vite"),
        ]);
        updateConfig({
          vite: { plugins: [...(await DevTools()), DevToolsOxc()] },
        });
      },
    },
  };
}

/**
 * Serves the mock product images at `/uploads` — dev-and-mock only. The shop's
 * `<img>` requests are made by the browser to the dev server, so MSW (which
 * only intercepts the shop's server-side fetches to the API) never sees them;
 * without this the redline photos 404 in mock mode. The webp derivatives live
 * with the mocks (`packages/mocks/uploads`) and are streamed straight off disk.
 *
 * Gated on `astro dev` AND `MOCK_API=1`, so it never loads during build,
 * preview, or real-API dev. The production image prunes `@attakk/mocks` (a
 * devDependency) via `pnpm deploy --prod`, so neither this nor the images ship.
 *
 * @returns {import("astro").AstroIntegration}
 */
function mockUploads() {
  return {
    name: "attakk:mock-uploads",
    hooks: {
      "astro:config:setup": ({ command, updateConfig }) => {
        if (command !== "dev" || process.env.MOCK_API !== "1") return;
        updateConfig({ vite: { plugins: [mockUploadsPlugin()] } });
      },
    },
  };
}

// A minimal Vite plugin. Typed loosely because `vite` isn't a direct dependency
// here (it comes in through astro), so its `Plugin`/`ViteDevServer` types can't
// be named from this package; the request/response are given real node types.
/** @returns {{ name: string, configureServer: (server: any) => void }} */
function mockUploadsPlugin() {
  const uploadsDir = fileURLToPath(
    new URL("../../packages/mocks/uploads/", import.meta.url),
  );
  return {
    name: "attakk:mock-uploads-serve",
    /** @param {any} server The Vite dev server (its connect app is untyped here). */
    configureServer(server) {
      server.middlewares.use(
        /**
         * @param {import("node:http").IncomingMessage} req
         * @param {import("node:http").ServerResponse} res
         * @param {(err?: unknown) => void} next
         */
        (req, res, next) => {
          const path = (req.url ?? "").split("?")[0];
          if (!path.startsWith("/uploads/")) return next();
          // basename strips traversal; only real .webp derivatives are served.
          const name = basename(path);
          const file = join(uploadsDir, name);
          if (!name.endsWith(".webp") || !existsSync(file)) return next();
          res.setHeader("Content-Type", "image/webp");
          createReadStream(file).on("error", next).pipe(res);
        },
      );
    },
  };
}

export default defineConfig({
  site: SITE_URL,
  // Server-rendered on the Node adapter: an edit in the admin shows up on the
  // next page load with no rebuild, and every API call happens server-side over
  // the internal network. Standalone mode ships its own HTTP server for Docker.
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [
    viteDevtools(),
    mockUploads(),
    sitemap({
      filter: (page) => !isNoindexRoute(new URL(page).pathname),
    }),
  ],
  // The four faces the storefront ships, all self-hosted: Astro downloads them
  // from Google at build time and serves them off our own origin, so the browser
  // never talks to fonts.gstatic.com. The set mirrors DISPLAY_FONTS in
  // packages/types, the fixed list a drop's display font is picked from.
  fonts: [
    {
      // Body and UI text.
      name: "Urbanist",
      cssVariable: "--font-urbanist",
      provider: fontProviders.google(),
      weights: [400, 500, 600, 700],
      styles: ["normal"],
      subsets: ["latin"],
    },
    {
      // Display type — headings and the site default drop font.
      name: "Antonio",
      cssVariable: "--font-antonio",
      provider: fontProviders.google(),
      weights: [400, 500, 600, 700],
      styles: ["normal"],
      subsets: ["latin"],
    },
    {
      // Labels, eyebrows, prices, size pills.
      name: "JetBrains Mono",
      cssVariable: "--font-jetbrains-mono",
      provider: fontProviders.google(),
      weights: [400, 500, 700],
      styles: ["normal"],
      subsets: ["latin"],
    },
    {
      // Collection names only.
      name: "Permanent Marker",
      cssVariable: "--font-permanent-marker",
      provider: fontProviders.google(),
      weights: [400],
      styles: ["normal"],
      subsets: ["latin"],
    },
  ],
  vite: { build: { cssTarget: "safari15.4" } },
});
