import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_THEME, getTheme, type ThemeDef, type ThemeId } from "./themes";

const STORAGE_KEY = "recordflow.theme.v2";

interface ThemeContextValue {
  theme: ThemeDef;
  setTheme: (id: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function readStoredTheme(): ThemeId {
  try {
    return getTheme(window.localStorage.getItem(STORAGE_KEY)).id;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Apply a theme to the document root. Safe to call before React mounts. */
export function applyTheme(id: ThemeId) {
  const theme = getTheme(id);
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.style.colorScheme = theme.mode;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>(readStoredTheme);

  useEffect(() => {
    applyTheme(themeId);
    try {
      window.localStorage.setItem(STORAGE_KEY, themeId);
    } catch {
      /* storage unavailable */
    }
  }, [themeId]);

  // Keep secondary windows (teleprompter, picker) in sync when the theme changes elsewhere.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) setThemeId(getTheme(e.newValue).id);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = useCallback((id: ThemeId) => setThemeId(id), []);
  const value = useMemo(() => ({ theme: getTheme(themeId), setTheme }), [setTheme, themeId]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
