/**
 * Theme registry. Every theme is a complete set of warm, zero-blue, zero-green
 * CSS custom properties applied to <html data-theme="..."> (see styles/themes.css).
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
    name: "Obsidian Flame",
    description: "Warm carbon dark, sunset coral accent",
    mode: "dark",
    swatch: ["#120f0f", "#1e1919", "#ff6b4a", "#f7f1ee"],
  },
  {
    id: "ember",
    name: "Molten Ember",
    description: "Roasted espresso, amber-flame accent",
    mode: "dark",
    swatch: ["#150f0b", "#231913", "#ff7e47", "#f9efe8"],
  },
  {
    id: "midnight",
    name: "Crimson Noir",
    description: "Deep burgundy-noir, ruby-rose accent",
    mode: "dark",
    swatch: ["#130b0e", "#22151a", "#fb5678", "#f9ecf0"],
  },
  {
    id: "nord",
    name: "Burnished Copper",
    description: "Warm bronze charcoal, liquid gold accent",
    mode: "dark",
    swatch: ["#191512", "#28221d", "#f59e0b", "#f7f0e8"],
  },
  {
    id: "rose",
    name: "Velvet Rosé",
    description: "Plum-wine dark, silk rose accent",
    mode: "dark",
    swatch: ["#18121a", "#281e2c", "#f4729b", "#f7edf5"],
  },
  {
    id: "forest",
    name: "Royal Amethyst",
    description: "Warm aubergine, orchid-magenta accent",
    mode: "dark",
    swatch: ["#17111c", "#261c2f", "#e879f9", "#f6ecf9"],
  },
  {
    id: "paper",
    name: "Editorial Ivory",
    description: "Warm parchment light, terracotta accent",
    mode: "light",
    swatch: ["#f5efe6", "#fffdf9", "#c84b28", "#281f1a"],
  },
  {
    id: "daylight",
    name: "Alabaster Sun",
    description: "Crisp warm alabaster, vermilion accent",
    mode: "light",
    swatch: ["#faf5ef", "#ffffff", "#e0482d", "#221814"],
  },
];

export const DEFAULT_THEME: ThemeId = "graphite";

export function getTheme(id: string | null | undefined): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
