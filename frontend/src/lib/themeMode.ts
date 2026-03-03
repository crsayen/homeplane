import { useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "homeplane-theme";

export function nextTheme(mode: ThemeMode): ThemeMode {
  if (mode === "system") {
    return "dark";
  }
  if (mode === "dark") {
    return "light";
  }
  return "system";
}

export function themeLabel(mode: ThemeMode): string {
  if (mode === "system") {
    return "System";
  }
  if (mode === "dark") {
    return "Dark";
  }
  return "Light";
}

export function useThemeMode(): [ThemeMode, (next: ThemeMode | ((prev: ThemeMode) => ThemeMode)) => void, "light" | "dark"] {
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      setThemeMode(stored);
    }
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const applyTheme = () => {
      const nextResolved = themeMode === "system" ? (media.matches ? "dark" : "light") : themeMode;
      document.documentElement.classList.toggle("dark", nextResolved === "dark");
      setResolvedTheme(nextResolved);
    };

    applyTheme();
    if (themeMode === "system") {
      media.addEventListener("change", applyTheme);
      return () => media.removeEventListener("change", applyTheme);
    }
    return;
  }, [themeMode]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, themeMode);
  }, [themeMode]);

  return [themeMode, setThemeMode, resolvedTheme];
}

