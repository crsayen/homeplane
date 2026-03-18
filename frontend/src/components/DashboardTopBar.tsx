import { useEffect, useRef, useState } from "react";

import { nextTheme, themeLabel, ThemeMode } from "../lib/themeMode";
import { nextUiDensity, uiDensityLabel, UiDensity } from "../lib/uiDensity";

type DashboardId = "audio" | "lighting";
type StreamState = "connecting" | "live" | "reconnecting";

function navClass(active: boolean): string {
  if (active) {
    return "rounded-lg border border-cyan-400/65 bg-cyan-500/10 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-cyan-700 dark:border-cyan-500/55 dark:bg-cyan-500/10 dark:text-cyan-200 sm:rounded-xl sm:px-3 sm:py-2 sm:text-xs sm:tracking-[0.18em]";
  }
  return "rounded-lg border border-slate-300/80 bg-white/90 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-700 transition hover:border-cyan-400 hover:text-cyan-700 dark:border-white/15 dark:bg-black dark:text-slate-200 dark:hover:border-cyan-400 dark:hover:text-cyan-200 sm:rounded-xl sm:px-3 sm:py-2 sm:text-xs sm:tracking-[0.18em]";
}

export function DashboardTopBar({
  currentDashboard,
  onOpenConfig,
  streamState,
  themeMode,
  setThemeMode,
  resolvedTheme,
  densityMode,
  setDensityMode,
}: {
  currentDashboard: DashboardId;
  onOpenConfig: () => void;
  streamState?: StreamState;
  themeMode: ThemeMode;
  setThemeMode: (next: ThemeMode | ((prev: ThemeMode) => ThemeMode)) => void;
  resolvedTheme: "light" | "dark";
  densityMode: UiDensity;
  setDensityMode: (next: UiDensity | ((prev: UiDensity) => UiDensity)) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDown(event: MouseEvent) {
      if (!menuRef.current) {
        return;
      }
      if (!menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEscape);
    };
  }, []);

  return (
    <header className="hp-header sticky top-2 z-20 mx-auto mb-3 flex w-full max-w-6xl items-center justify-between gap-2 rounded-xl border border-white/40 bg-white/75 p-2 shadow-lg shadow-cyan-900/10 backdrop-blur-xl dark:border-white/10 dark:bg-black/80 sm:top-3 sm:mb-6 sm:gap-3 sm:rounded-2xl sm:p-3">
      <nav className="flex min-w-0 items-center gap-1.5 sm:gap-2">
        <a href="/dashboards/audio" onClick={(e) => { e.preventDefault(); history.pushState(null, "", "/dashboards/audio"); dispatchEvent(new PopStateEvent("popstate")); }} className={navClass(currentDashboard === "audio")}>
          Audio
        </a>
        <a href="/dashboards/lighting" onClick={(e) => { e.preventDefault(); history.pushState(null, "", "/dashboards/lighting"); dispatchEvent(new PopStateEvent("popstate")); }} className={navClass(currentDashboard === "lighting")}>
          Lighting
        </a>
      </nav>

      <div className="relative flex shrink-0 items-center gap-2 sm:gap-3" ref={menuRef}>
        {streamState ? (
          <span
            className={`hp-nonfunctional whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.11em] sm:text-[11px] sm:tracking-[0.13em] ${
              streamState === "live"
                ? "text-emerald-600 dark:text-emerald-300"
                : "text-amber-600 dark:text-amber-300"
            }`}
          >
            Stream {streamState}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setMenuOpen((previous) => !previous)}
          className="rounded-lg border border-slate-300/80 bg-white/90 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-700 transition hover:border-cyan-400 hover:text-cyan-700 dark:border-white/15 dark:bg-black dark:text-slate-200 dark:hover:border-cyan-400 dark:hover:text-cyan-200 sm:rounded-xl sm:px-3 sm:py-2 sm:text-xs sm:tracking-[0.18em]"
        >
          Menu
        </button>
        {menuOpen ? (
          <div
            className={`absolute right-0 top-[calc(100%+0.35rem)] z-30 w-48 rounded-xl p-1.5 shadow-xl ${
              resolvedTheme === "dark"
                ? "border border-white/20 bg-[#060606] shadow-black/55"
                : "border border-slate-300/75 bg-white shadow-slate-900/20"
            }`}
          >
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onOpenConfig();
              }}
              className={`block w-full rounded-lg px-2.5 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] transition ${
                resolvedTheme === "dark"
                  ? "text-slate-200 hover:bg-white/10"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              Config
            </button>
            <button
              type="button"
              onClick={() => setThemeMode((previous) => nextTheme(previous))}
              title={`Theme ${themeLabel(themeMode)} (${resolvedTheme})`}
              className={`mt-1 block w-full rounded-lg px-2.5 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] transition ${
                resolvedTheme === "dark"
                  ? "text-slate-200 hover:bg-white/10"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              Theme {themeLabel(themeMode)}
            </button>
            <button
              type="button"
              onClick={() => setDensityMode((previous) => nextUiDensity(previous))}
              className={`mt-1 block w-full rounded-lg px-2.5 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] transition ${
                resolvedTheme === "dark"
                  ? "text-slate-200 hover:bg-white/10"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              Density {uiDensityLabel(densityMode)}
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
