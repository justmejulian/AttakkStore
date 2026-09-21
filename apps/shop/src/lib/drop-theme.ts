import type { DisplayFont, Drop } from "@attakk/types";

// A drop's identity is data: its four colours and display font map onto the
// Lumos custom properties that carry them, emitted as an inline style on the
// drop's own element so the eyebrow, marker, buttons and cards inside all read
// the collection's palette without a per-drop stylesheet. Extracted here so the
// home rail, a drop's page and the archive grid theme a drop the one same way.

// The self-hosted face each display-font choice maps to (astro.config.mjs's
// cssVariables). The marker family becomes this for the collection name.
const FONT_VARS: Record<DisplayFont, string> = {
  Antonio: "var(--font-antonio)",
  "Permanent Marker": "var(--font-permanent-marker)",
  "JetBrains Mono": "var(--font-jetbrains-mono)",
  Urbanist: "var(--font-urbanist)",
};

// The inline `style` a drop paints itself with. color_primary is the signature
// colour buttons take; color_accent is the marker and heading pop;
// color_secondary tints the raised card surface; color_text is the ink. Each is
// emitted only when the drop actually set one — a blank value leaves the theme
// default in place, so a drop can inherit the site palette and override just a
// colour or two.
export function dropThemeStyle(drop: Drop): string {
  const vars: Record<string, string> = {
    "--marker-family": FONT_VARS[drop.display_font],
  };
  if (drop.color_primary) vars["--brand-500"] = drop.color_primary;
  if (drop.color_accent) vars["--heading-accent"] = drop.color_accent;
  if (drop.color_secondary) vars["--background-2"] = drop.color_secondary;
  if (drop.color_text) vars["--text"] = drop.color_text;
  return Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}

// The silhouette fill for pieces with no photo yet: the drop's own signature
// colour, or the ink when it set none.
export function dropSwatch(drop: Drop): string {
  return drop.color_primary || "var(--text)";
}
