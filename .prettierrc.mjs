/** @type {import("prettier").Config} */
export default {
  // Matches the conventions Lumos scaffolds with, so the shop is not reformatted
  // and future Lumos upgrades merge cleanly.
  plugins: ["prettier-plugin-astro"],
  overrides: [
    { files: "*.astro", options: { parser: "astro" } },
    // Lumos keeps CSS one rule per line on purpose.
    { files: "*.css", options: { printWidth: 1000 } },
  ],
};
