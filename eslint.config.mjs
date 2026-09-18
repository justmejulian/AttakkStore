// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintPluginAstro from "eslint-plugin-astro";
import prettier from "eslint-config-prettier/flat";
import globals from "globals";

// One flat config for the whole workspace — shop, packages/types and the API
// and admin apps as they land. Astro's recommended setup (typescript-eslint +
// eslint-plugin-astro with jsx-a11y), eslint-config-prettier last so formatting
// is left to Prettier. https://docs.astro.build/en/editor-setup/#eslint
export default tseslint.config(
  // build output is generated; dot-folders are generated (.astro) or vendored
  // tooling (.claude, .vscode) — none of them are ours to lint.
  { ignores: ["**/dist/**", "**/.*/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...eslintPluginAstro.configs["flat/recommended"],
  ...eslintPluginAstro.configs["flat/jsx-a11y-recommended"],
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    // TypeScript already checks these, and the core rules mis-fire on TS-only
    // constructs (type/value sharing a name, global Astro types like
    // ImageMetadata). Disabling them is typescript-eslint's own guidance.
    files: ["**/*.{ts,tsx,astro}"],
    rules: {
      "no-undef": "off",
      "no-redeclare": "off",
    },
  },
  prettier,
);
