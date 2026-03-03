import { useEffect, useState } from "react";

export type UiDensity = "minimalist" | "compact" | "normal";

export function nextUiDensity(mode: UiDensity): UiDensity {
  if (mode === "normal") {
    return "compact";
  }
  if (mode === "compact") {
    return "minimalist";
  }
  return "normal";
}

export function uiDensityLabel(mode: UiDensity): string {
  if (mode === "minimalist") {
    return "Minimalist";
  }
  if (mode === "compact") {
    return "Compact";
  }
  return "Normal";
}

function storageKey(scope: string): string {
  return `homeplane-ui-density-${scope}`;
}

export function useUiDensity(scope: string): [UiDensity, (next: UiDensity | ((prev: UiDensity) => UiDensity)) => void] {
  const [density, setDensity] = useState<UiDensity>(() => {
    if (typeof window === "undefined") {
      return "normal";
    }

    const scoped = window.localStorage.getItem(storageKey(scope));
    if (scoped === "minimalist" || scoped === "compact" || scoped === "normal") {
      return scoped;
    }

    const legacy = window.localStorage.getItem("homeplane-ui-density");
    if (legacy === "minimalist" || legacy === "compact" || legacy === "normal") {
      return legacy;
    }

    return "normal";
  });

  useEffect(() => {
    window.localStorage.setItem(storageKey(scope), density);
  }, [density, scope]);

  return [density, setDensity];
}
