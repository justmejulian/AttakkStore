// @ts-check
import { defineConfig, fontProviders } from "astro/config";
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
  integrations: [
    viteDevtools(),
    sitemap({
      filter: (page) => !isNoindexRoute(new URL(page).pathname),
    }),
  ],
  fonts: [
    {
      name: "Inter",
      cssVariable: "--font-inter",
      provider: fontProviders.local(),
      options: {
        variants: [
          {
            weight: 400,
            style: "normal",
            src: ["./src/assets/fonts/inter-regular.woff2"],
          },
        ],
      },
    },
  ],
  vite: { build: { cssTarget: "safari15.4" } },
});
