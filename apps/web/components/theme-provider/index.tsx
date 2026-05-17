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
