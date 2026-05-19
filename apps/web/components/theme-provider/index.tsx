"use client";

import * as React from "react";
import {
  SpacemanThemeProvider,
  ThemeAnimationType,
  useSpacemanTheme,
} from "@space-man/react-theme-animation";

type Theme = "light" | "dark";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
};

/**
 * Mirror the `<html class="dark|light">` Spaceman writes to a
 * matching `data-theme="dark|light"` attribute. The Trade Island CSS
 * (apps/web/css/trade-island/*.css) declares its var swaps under
 * `[data-theme="dark"]`, while Tailwind reads `.dark` for `dark:`
 * modifiers. Without the mirror, only one half of the surface
 * actually flips — Tailwind components go dark but the .island,
 * .lo-action, .hub-pip, etc. stay on the light palette.
 *
 * MutationObserver on `<html>` so this stays in sync no matter how
 * the class changes (Spaceman's switchTheme animation + direct
 * setTheme + system-preference media queries all converge here).
 */
function ThemeAttributeSync() {
  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const sync = () => {
      const isDark = root.classList.contains("dark");
      const next = isDark ? "dark" : "light";
      if (root.getAttribute("data-theme") !== next) {
        root.setAttribute("data-theme", next);
      }
    };
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return null;
}

export function ThemeProvider({
  children,
  defaultTheme = "light",
}: ThemeProviderProps) {
  return (
    <SpacemanThemeProvider
      themes={["light", "dark"]}
      defaultTheme={defaultTheme}
      animationType={ThemeAnimationType.CIRCLE}
      duration={600}
    >
      <ThemeAttributeSync />
      {children}
    </SpacemanThemeProvider>
  );
}

// Back-compat: existing consumers calling useTheme() get { theme, setTheme }
// like before. setTheme here is non-animated — for the animated circle reveal,
// pull `switchTheme` + `ref` from useSpacemanTheme directly.
export function useTheme() {
  const ctx = useSpacemanTheme();
  return {
    theme: ctx.resolvedTheme as Theme,
    setTheme: (next: Theme) => ctx.setTheme(next),
  };
}

export { useSpacemanTheme };
