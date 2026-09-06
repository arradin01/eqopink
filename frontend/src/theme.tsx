// Pink / girly theme palettes + provider hook. Any screen calls
// `useAppTheme()` to get the palette (C) + memoized styles.
// Soft light pink is the default; a pink-accented dark palette is also offered.
import { createContext, ReactNode, useContext, useMemo, useState, useEffect } from "react";
import { StatusBar } from "expo-status-bar";

import { storage } from "@/src/utils/storage";
import { makeStyles } from "@/src/styles";

export type Theme = "dark" | "light";

export type Palette = {
  bg: string;
  card: string;
  raised: string;
  text: string;
  muted: string;
  ember: string; // primary accent (rose / magenta)
  green: string;
  blue: string;
  purple: string;
  red: string;
  border: string;
  amber: string;
  overlay: string;
  waveMuted: string;
  bubbleAlpha: string;
};

export const PALETTES: Record<Theme, Palette> = {
  light: {
    bg: "#FFF0F6",
    card: "#FFFFFF",
    raised: "#FCE1EE",
    text: "#3D1F2E",
    muted: "#A8768F",
    ember: "#EC4899",
    green: "#10B981",
    blue: "#3B82F6",
    purple: "#A855F7",
    red: "#EF4444",
    border: "#F7D4E5",
    amber: "#F59E0B",
    overlay: "rgba(61,31,46,0.45)",
    waveMuted: "rgba(236,72,153,0.08)",
    bubbleAlpha: "rgba(61,31,46,0.55)",
  },
  dark: {
    bg: "#1B0E15",
    card: "#2A1622",
    raised: "#3A1E2E",
    text: "#FCE7F0",
    muted: "#C99BB4",
    ember: "#F472B6",
    green: "#34D399",
    blue: "#60A5FA",
    purple: "#C084FC",
    red: "#F87171",
    border: "#43263599",
    amber: "#FBBF24",
    overlay: "rgba(0,0,0,0.6)",
    waveMuted: "rgba(255,255,255,0.06)",
    bubbleAlpha: "rgba(252,231,240,0.55)",
  },
};

type Ctx = {
  theme: Theme;
  C: Palette;
  styles: ReturnType<typeof makeStyles>;
  setTheme: (t: Theme) => void;
  ready: boolean;
};

const ThemeCtx = createContext<Ctx>({
  theme: "light",
  C: PALETTES.light,
  styles: makeStyles(PALETTES.light),
  setTheme: () => {},
  ready: false,
});

const K_THEME = "sasha:theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const saved = await storage.getItem<string>(K_THEME, "light");
      if (saved === "dark" || saved === "light") setThemeState(saved);
      setReady(true);
    })();
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    storage.setItem(K_THEME, t);
  };

  const value = useMemo(() => {
    const C = PALETTES[theme];
    return { theme, C, styles: makeStyles(C), setTheme, ready };
  }, [theme, ready]);

  return (
    <ThemeCtx.Provider value={value}>
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      {children}
    </ThemeCtx.Provider>
  );
}

export const useAppTheme = () => useContext(ThemeCtx);
