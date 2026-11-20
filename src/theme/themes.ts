/**
 * Theme registry. Every theme is a complete set of CSS custom properties that is
 * applied to <html data-theme="..."> (see styles/themes.css). The canvas editor
 * also reads `stage` colors from here so the editor backdrop follows the theme.
 */
export type ThemeId =
  | "graphite"
  | "ember"
  | "paper"
  | "daylight"
  | "midnight"
  | "nord"
  | "rose"
  | "forest";

export interface ThemeDef {
  id: ThemeId;
  name: string;
  description: string;
  mode: "dark" | "light";
  /** Preview swatches: [background, surface, accent, text] */
  swatch: [string, string, string, string];
}

export const THEMES: ThemeDef[] = [
  {
    id: "graphite",
    name: "Graphite",
    description: "Calm neutral dark",
    mode: "dark",
    swatch: ["#111214", "#1b1c20", "#8ea2ff", "#ececef"],
  },
  {
    id: "ember",
    name: "Ember",
    description: "Warm dark, coral accent",
    mode: "dark",
    swatch: ["#16110e", "#211915", "#ff7a59", "#f4ebe6"],
  },
  {
    id: "paper",
    name: "Paper",
    description: "Warm light",
    mode: "light",
    swatch: ["#f4f0e8", "#fffdf8", "#c4572f", "#2a251f"],
  },
  {
    id: "daylight",
    name: "Daylight",
    description: "Crisp cool light",
    mode: "light",
    swatch: ["#eef1f6", "#ffffff", "#2563eb", "#0f172a"],
  },
  {
    id: "midnight",
    name: "Midnight",
    description: "Deep navy, sky accent",
    mode: "dark",
    swatch: ["#080d1a", "#0f172a", "#38bdf8", "#e2e8f0"],
  },
  {
    id: "nord",
    name: "Nord",
    description: "Arctic blue-grey",
    mode: "dark",
    swatch: ["#2a2f3a", "#353c4a", "#88c0d0", "#eceff4"],
  },
  {
    id: "rose",
    name: "Rosé",
    description: "Muted violet, rose accent",
    mode: "dark",
    swatch: ["#1b1822", "#26212f", "#f2789f", "#efe7f3"],
  },
  {
    id: "forest",
    name: "Forest",
    description: "Deep green, mint accent",
    mode: "dark",
    swatch: ["#0f1512", "#17201b", "#5ee0a8", "#e5efe9"],
  },
];

export const DEFAULT_THEME: ThemeId = "graphite";

export function getTheme(id: string | null | undefined): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
