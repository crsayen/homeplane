import { useEffect, useState } from "react";

import { KioskDashboard } from "./components/KioskDashboard";
import { LightingDashboard } from "./components/LightingDashboard";
import { MultiRoomAudioDashboard } from "./components/MultiRoomAudioDashboard";
import { nextUiDensity, uiDensityLabel, UiDensity, useUiDensity } from "./lib/uiDensity";
import { useThemeMode } from "./lib/themeMode";

function normalizePath(pathname: string): string {
  if (pathname === "/") {
    return pathname;
  }
  return pathname.replace(/\/+$/, "");
}

function DashboardIndex({
  densityMode,
  setDensityMode,
}: {
  densityMode: UiDensity;
  setDensityMode: (next: UiDensity | ((prev: UiDensity) => UiDensity)) => void;
}) {
  return (
    <div className="hp-shell min-h-screen p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={() => setDensityMode((previous) => nextUiDensity(previous))}
            className="whitespace-nowrap rounded-lg border border-slate-300/80 bg-white/90 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-700 transition hover:border-cyan-400 hover:text-cyan-700 dark:border-white/15 dark:bg-black dark:text-slate-200 dark:hover:border-cyan-400 dark:hover:text-cyan-200 sm:rounded-xl sm:px-3 sm:py-2 sm:text-xs sm:tracking-[0.18em]"
          >
            Density {uiDensityLabel(densityMode)}
          </button>
        </div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Dashboards</h1>
        <p className="hp-nonfunctional mt-2 text-sm text-slate-600 dark:text-slate-300">
          Select a dashboard.
        </p>
        <div className="hp-index-grid mt-6 grid gap-3 sm:grid-cols-2">
          <a
            href="/dashboards/audio"
            className="rounded-xl border border-slate-300/70 bg-white/80 p-4 text-sm font-semibold text-slate-900 transition hover:border-cyan-400 dark:border-white/15 dark:bg-black/60 dark:text-slate-100"
          >
            Multi-Room Audio
          </a>
          <a
            href="/dashboards/lighting"
            className="rounded-xl border border-slate-300/70 bg-white/80 p-4 text-sm font-semibold text-slate-900 transition hover:border-cyan-400 dark:border-white/15 dark:bg-black/60 dark:text-slate-100"
          >
            Lighting
          </a>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const [path, setPath] = useState(() => normalizePath(window.location.pathname));
  const [audioDensityMode, setAudioDensityMode] = useUiDensity("audio");
  const [lightingDensityMode, setLightingDensityMode] = useUiDensity("lighting");
  const [homeDensityMode, setHomeDensityMode] = useUiDensity("home");
  const [themeMode, setThemeMode, resolvedTheme] = useThemeMode();
  const apiBaseUrl = import.meta.env.VITE_HOMEPLANE_API_URL || window.location.origin;
  const apiKey = import.meta.env.VITE_HOMEPLANE_API_KEY;

  useEffect(() => {
    const onPopState = () => setPath(normalizePath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    let density = homeDensityMode;
    if (path === "/dashboards/audio") {
      density = audioDensityMode;
    } else if (path === "/dashboards/lighting") {
      density = lightingDensityMode;
    }
    document.documentElement.setAttribute("data-ui-density", density);
  }, [path, homeDensityMode, audioDensityMode, lightingDensityMode]);

  if (!apiKey) {
    return (
      <div className="min-h-screen p-6">
        <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-amber-300/70 bg-amber-50/90 p-6 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          Missing `VITE_HOMEPLANE_API_KEY` in frontend environment.
        </div>
      </div>
    );
  }

  if (path === "/dashboards/audio") {
    return (
      <MultiRoomAudioDashboard
        apiBaseUrl={apiBaseUrl}
        apiKey={apiKey}
        themeMode={themeMode}
        setThemeMode={setThemeMode}
        resolvedTheme={resolvedTheme}
        densityMode={audioDensityMode}
        setDensityMode={setAudioDensityMode}
      />
    );
  }

  if (path === "/dashboards/lighting") {
    return (
      <LightingDashboard
        apiBaseUrl={apiBaseUrl}
        apiKey={apiKey}
        themeMode={themeMode}
        setThemeMode={setThemeMode}
        resolvedTheme={resolvedTheme}
        densityMode={lightingDensityMode}
        setDensityMode={setLightingDensityMode}
      />
    );
  }

  if (path === "/kiosk") {
    return <KioskDashboard apiBaseUrl={apiBaseUrl} apiKey={apiKey} />;
  }

  if (path === "/") {
    return <DashboardIndex densityMode={homeDensityMode} setDensityMode={setHomeDensityMode} />;
  }

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-xl rounded-2xl border border-red-300/70 bg-red-50/90 p-6 text-sm text-red-800 dark:border-red-700 dark:bg-red-950/40 dark:text-red-100">
        Unknown path: <span className="font-mono">{path}</span>
      </div>
    </div>
  );
}
