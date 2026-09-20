// @ts-check
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

export default defineConfig({
  site: SITE_URL,
  // Server-rendered on the Node adapter: an edit in the admin shows up on the
  // next page load with no rebuild, and every API call happens server-side over
  // the internal network. Standalone mode ships its own HTTP server for Docker.
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [
    viteDevtools(),
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
