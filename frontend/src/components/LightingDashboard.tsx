import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";

import {
  EntityStateResponse,
  HomeplaneClient,
  LightingConfig,
  LightingEntityConfig,
  RoomLightingConfig,
} from "../api/homeplaneClient";
import { UiDensity } from "../lib/uiDensity";
import { ThemeMode } from "../lib/themeMode";
import { DashboardTopBar } from "./DashboardTopBar";

type LightStateMap = Record<string, EntityStateResponse | undefined>;
type StreamState = "connecting" | "live" | "reconnecting";
type PendingTransition = {
  targetState: "on" | "off";
  timeoutMs: number;
};
type PendingTransitionMap = Record<string, PendingTransition | undefined>;

type NormalizedLight = {
  entity_id: string;
  display_name?: string;
  icon?: string;
  update_timeout_seconds?: number;
};

function toWebSocketUrl(apiBaseUrl: string): string {
  const parsed = new URL(apiBaseUrl);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = "/api/ws/entities";
  parsed.search = "";
  return parsed.toString();
}

function normalizePath(pathname: string): string {
  if (pathname === "/") {
    return pathname;
  }
  return pathname.replace(/\/+$/, "");
}

function normalizeLightConfig(light: string | LightingEntityConfig): NormalizedLight {
  if (typeof light === "string") {
    return { entity_id: light };
  }
  return {
    entity_id: light.entity_id,
    display_name: light.display_name,
    icon: light.icon,
    update_timeout_seconds: light.update_timeout_seconds,
  };
}

function prettifyEntityName(entityId: string): string {
  const raw = entityId.includes(".") ? entityId.split(".", 2)[1] : entityId;
  return raw
    .split("_")
    .filter(Boolean)
    .map((segment) => segment[0].toUpperCase() + segment.slice(1))
    .join(" ");
}

function lightLabel(light: NormalizedLight, state?: EntityStateResponse): string {
  if (light.display_name) {
    return light.display_name;
  }

  const friendlyName = state?.attributes?.friendly_name;
  if (typeof friendlyName === "string" && friendlyName.trim().length > 0) {
    return friendlyName;
  }

  return prettifyEntityName(light.entity_id);
}

function IconBulb({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 3a6.5 6.5 0 0 0-4.2 11.45c.8.7 1.2 1.3 1.35 2.05h5.7c.15-.75.55-1.35 1.35-2.05A6.5 6.5 0 0 0 12 3Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9.6 18.5h4.8M10.2 21h3.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconFloorLamp({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M8 4h8l-1 3H9L8 4Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 7v10M9 20h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconLamp({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M7 8h10l-1.6 3.8H8.6L7 8Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 11.8V18M9 20h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconChandelier({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 3v4M6 11c1.5 1 3.5 1.5 6 1.5s4.5-.5 6-1.5M5 11h14M8 11v3M12 11v3M16 11v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconTube({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="10" width="16" height="4" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M6 9V8M18 16v-1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconStringLights({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M4 8c3 0 3 4 6 4s3-4 6-4 3 4 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M7 12v2M13 12v2M19 12v2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function LightIcon({ icon, className }: { icon?: string; className?: string }) {
  switch (icon) {
    case "mdi:floor-lamp":
      return <IconFloorLamp className={className} />;
    case "mdi:lamp":
      return <IconLamp className={className} />;
    case "mdi:chandelier":
      return <IconChandelier className={className} />;
    case "mdi:lightbulb-fluorescent-tube":
      return <IconTube className={className} />;
    case "mdi:string-lights":
      return <IconStringLights className={className} />;
    default:
      return <IconBulb className={className} />;
  }
}

function ScrollingLightName({ name }: { name: string }) {
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [overflowPx, setOverflowPx] = useState(0);
  const [textWidthPx, setTextWidthPx] = useState(0);

  useEffect(() => {
    function measure() {
      const container = containerRef.current;
      const text = textRef.current;
      if (!container || !text) {
        return;
      }
      const measuredTextWidth = Math.ceil(text.scrollWidth);
      const nextOverflow = Math.max(0, measuredTextWidth - container.clientWidth);
      setOverflowPx(nextOverflow);
      setTextWidthPx(measuredTextWidth);
    }

    measure();
    const observer = new ResizeObserver(measure);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    if (textRef.current) {
      observer.observe(textRef.current);
    }
    return () => observer.disconnect();
  }, [name]);

  const isTruncated = overflowPx > 0;
  const style = (
    isTruncated
      ? {
          ["--light-name-shift" as string]: `${Math.max(1, textWidthPx)}px`,
          ["--light-name-duration" as string]: `${Math.max(2.2, textWidthPx / 52)}s`,
        }
      : {}
  ) as CSSProperties;

  return (
    <span ref={containerRef} className={isTruncated ? "light-name-fade light-name-fade-both" : "light-name-fade"}>
      {isTruncated ? (
        <span style={style} className="light-name-scroll-track">
          <span ref={textRef} className="light-name-copy">
            {name}
            {"\u00a0\u00a0"}
          </span>
          <span className="light-name-copy" aria-hidden="true">
            {name}
            {"\u00a0\u00a0"}
          </span>
        </span>
      ) : (
        <span ref={textRef} className="light-name-static">
          {name}
        </span>
      )}
    </span>
  );
}

export function LightingDashboard({
  apiBaseUrl,
  apiKey,
  themeMode,
  setThemeMode,
  resolvedTheme,
  densityMode,
  setDensityMode,
}: {
  apiBaseUrl: string;
  apiKey: string;
  themeMode: ThemeMode;
  setThemeMode: (next: ThemeMode | ((prev: ThemeMode) => ThemeMode)) => void;
  resolvedTheme: "light" | "dark";
  densityMode: UiDensity;
  setDensityMode: (next: UiDensity | ((prev: UiDensity) => UiDensity)) => void;
}) {
  const client = useMemo(() => new HomeplaneClient(apiBaseUrl, apiKey), [apiBaseUrl, apiKey]);
  const [config, setConfig] = useState<LightingConfig | null>(null);
  const [lightStates, setLightStates] = useState<LightStateMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<StreamState>("connecting");
  const [busyEntityId, setBusyEntityId] = useState<string | null>(null);
  const [pendingTransitions, setPendingTransitions] = useState<PendingTransitionMap>({});
  const [editorOpen, setEditorOpen] = useState(false);
  const [configDraft, setConfigDraft] = useState('{\n  "rooms": []\n}');
  const [configSaveError, setConfigSaveError] = useState<string | null>(null);
  const [configSaving, setConfigSaving] = useState(false);
  const webSocketRef = useRef<WebSocket | null>(null);
  const pendingTimeoutsRef = useRef<Record<string, number>>({});

  const lightConfigByEntity = useMemo(() => {
    const mapping: Record<string, NormalizedLight> = {};
    if (!config) {
      return mapping;
    }
    for (const room of config.rooms) {
      for (const light of room.lights) {
        const normalized = normalizeLightConfig(light);
        mapping[normalized.entity_id] = normalized;
      }
    }
    return mapping;
  }, [config]);

  function clearPendingTransition(entityId: string): void {
    const timeoutId = pendingTimeoutsRef.current[entityId];
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
      delete pendingTimeoutsRef.current[entityId];
    }
    setPendingTransitions((previous) => {
      if (!previous[entityId]) {
        return previous;
      }
      const next = { ...previous };
      delete next[entityId];
      return next;
    });
  }

  async function refreshLightState(entityId: string): Promise<void> {
    try {
      const state = await client.getEntityState(entityId);
      setLightStates((prev) => ({ ...prev, [entityId]: state }));
    } catch {
      setLightStates((prev) => ({ ...prev, [entityId]: undefined }));
    }
  }

  async function refreshAllStates(currentConfig: LightingConfig): Promise<void> {
    const lights = currentConfig.rooms.flatMap((room) => room.lights.map((light) => normalizeLightConfig(light).entity_id));
    await Promise.all(lights.map(async (lightId) => refreshLightState(lightId)));
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const payload = await client.getLightingConfig();
        if (cancelled) {
          return;
        }
        setConfig(payload);
        setConfigDraft(JSON.stringify(payload, null, 2));
        await refreshAllStates(payload);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load lighting dashboard");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    const toClear = Object.entries(pendingTransitions)
      .filter(([entityId, pending]) => pending && lightStates[entityId]?.state === pending.targetState)
      .map(([entityId]) => entityId);

    if (toClear.length === 0) {
      return;
    }

    for (const entityId of toClear) {
      clearPendingTransition(entityId);
    }
  }, [lightStates, pendingTransitions]);

  useEffect(() => {
    return () => {
      for (const timeoutId of Object.values(pendingTimeoutsRef.current)) {
        window.clearTimeout(timeoutId);
      }
      pendingTimeoutsRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!config) {
      return;
    }

    const entityIds = config.rooms.flatMap((room) => room.lights.map((light) => normalizeLightConfig(light).entity_id));
    if (entityIds.length === 0) {
      return;
    }

    let reconnectTimer: number | null = null;
    let stopped = false;

    const connect = () => {
      setStreamState("connecting");
      const wsUrl = new URL(toWebSocketUrl(apiBaseUrl));
      wsUrl.searchParams.set("api_key", apiKey);
      wsUrl.searchParams.set("entity_ids", entityIds.join(","));

      const socket = new WebSocket(wsUrl.toString());
      webSocketRef.current = socket;
      socket.onopen = () => setStreamState("live");

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as { type: string; state: EntityStateResponse };
          if (payload.type !== "state_changed") {
            return;
          }
          setLightStates((previous) => ({
            ...previous,
            [payload.state.entity_id]: payload.state,
          }));
        } catch {
          return;
        }
      };

      socket.onclose = () => {
        if (stopped) {
          return;
        }
        setStreamState("reconnecting");
        reconnectTimer = window.setTimeout(() => connect(), 2000);
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      if (webSocketRef.current) {
        webSocketRef.current.close();
        webSocketRef.current = null;
      }
    };
  }, [apiBaseUrl, apiKey, config]);

  async function toggleLight(lightId: string, isOn: boolean, timeoutSeconds?: number): Promise<void> {
    const targetState: "on" | "off" = isOn ? "off" : "on";
    const timeoutMs = Math.max(0, Math.round((timeoutSeconds ?? 0) * 1000));

    if (timeoutMs > 0) {
      clearPendingTransition(lightId);
      setPendingTransitions((previous) => ({
        ...previous,
        [lightId]: { targetState, timeoutMs },
      }));
      pendingTimeoutsRef.current[lightId] = window.setTimeout(() => {
        clearPendingTransition(lightId);
        void refreshLightState(lightId);
      }, timeoutMs);
    }

    setBusyEntityId(lightId);
    try {
      await client.setLightState(lightId, { is_on: targetState === "on" });
      if (timeoutMs === 0) {
        await refreshLightState(lightId);
      }
    } catch {
      clearPendingTransition(lightId);
    } finally {
      setBusyEntityId(null);
    }
  }

  async function saveConfigFromEditor(): Promise<void> {
    setConfigSaveError(null);
    let parsed: LightingConfig;
    try {
      parsed = JSON.parse(configDraft) as LightingConfig;
    } catch {
      setConfigSaveError("Config is not valid JSON.");
      return;
    }

    setConfigSaving(true);
    try {
      const saved = await client.updateLightingConfig(parsed);
      setConfig(saved);
      setConfigDraft(JSON.stringify(saved, null, 2));
      setEditorOpen(false);
      await refreshAllStates(saved);
    } catch (err) {
      setConfigSaveError(err instanceof Error ? err.message : "Failed to save lighting config.");
    } finally {
      setConfigSaving(false);
    }
  }

  function roomOnCount(room: RoomLightingConfig): number {
    return room.lights.filter((light) => {
      const entityId = normalizeLightConfig(light).entity_id;
      return lightStates[entityId]?.state === "on";
    }).length;
  }

  if (loading) {
    return <div className="p-6 text-sm text-slate-700 dark:text-slate-300">Loading lighting dashboard...</div>;
  }

  return (
    <div className="hp-shell relative min-h-screen overflow-x-clip px-2.5 pb-6 pt-2.5 sm:px-6 sm:pb-10 sm:pt-4 lg:px-10">
      <div className="ambient-bg hp-nonfunctional" />

      <DashboardTopBar
        currentDashboard="lighting"
        onOpenConfig={() => {
          if (config) {
            setConfigDraft(JSON.stringify(config, null, 2));
          }
          setConfigSaveError(null);
          setEditorOpen(true);
        }}
        streamState={streamState}
        themeMode={themeMode}
        setThemeMode={setThemeMode}
        resolvedTheme={resolvedTheme}
        densityMode={densityMode}
        setDensityMode={setDensityMode}
      />

      {editorOpen ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/55 p-3">
          <div className="w-full max-w-3xl rounded-2xl border border-white/15 bg-[#0a0a0a] p-4 shadow-2xl shadow-black/60">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-100">Lighting Config Editor</h3>
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="rounded-lg border border-white/15 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-slate-300 hover:border-slate-300 hover:text-slate-100"
              >
                Close
              </button>
            </div>
            <p className="mb-2 text-xs text-slate-400">
              Lights can be strings or objects: {" "}
              {
                '{"entity_id":"light.kitchen","display_name":"Kitchen Main","icon":"mdi:chandelier","update_timeout_seconds":8}'
              }
            </p>
            <textarea
              value={configDraft}
              onChange={(event) => setConfigDraft(event.target.value)}
              spellCheck={false}
              className="h-72 w-full rounded-xl border border-white/10 bg-black/70 p-3 font-mono text-xs text-slate-100 outline-none ring-0 focus:border-cyan-500"
            />
            {configSaveError ? <p className="mt-2 text-xs text-red-300">{configSaveError}</p> : null}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-300 hover:border-slate-300 hover:text-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveConfigFromEditor()}
                disabled={configSaving}
                className="rounded-lg border border-cyan-500/50 bg-cyan-500/15 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-cyan-200 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {configSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mx-auto w-full max-w-6xl rounded-2xl border border-red-300/70 bg-red-50/80 p-4 text-sm text-red-800 backdrop-blur dark:border-red-700/60 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      ) : null}

      {!config ? (
        <div className="mx-auto w-full max-w-6xl rounded-2xl border border-slate-200/80 bg-white/75 p-6 text-sm text-slate-600 backdrop-blur dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300">
          Loading lighting configuration...
        </div>
      ) : config.rooms.length === 0 ? (
        <div className="mx-auto w-full max-w-6xl rounded-2xl border border-slate-200/80 bg-white/75 p-6 text-sm text-slate-600 backdrop-blur dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300">
          No lighting rooms configured yet. Open <span className="font-semibold">Config</span> to add rooms.
        </div>
      ) : (
        <div className="hp-room-grid mx-auto grid w-full max-w-6xl gap-2.5 sm:gap-5 xl:grid-cols-2">
          {config.rooms.map((room) => (
            <section
              key={room.name}
              className="hp-room-card rounded-2xl border border-slate-900/20 bg-white/92 p-3.5 shadow-lg shadow-slate-900/15 ring-1 ring-slate-900/5 backdrop-blur-sm dark:border-white/20 dark:bg-black/88 dark:shadow-black/70 dark:ring-white/10 sm:rounded-3xl sm:p-4"
            >
              <div className="mb-2.5 flex items-center justify-between">
                <h2 className="text-[1.15rem] font-semibold leading-none text-slate-900 dark:text-slate-100 sm:text-2xl">{room.name}</h2>
                <span className="hp-nonfunctional rounded-full bg-slate-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-700 dark:text-slate-300">
                  {roomOnCount(room)}/{room.lights.length} on
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
                {room.lights.map((rawLight) => {
                  const light = normalizeLightConfig(rawLight);
                  const state = lightStates[light.entity_id];
                  const isOn = state?.state === "on";
                  const isBusy = busyEntityId === light.entity_id;
                  const pending = pendingTransitions[light.entity_id];
                  const isPending = Boolean(pending);

                  return (
                    <button
                      key={light.entity_id}
                      type="button"
                      disabled={isBusy || isPending}
                      onClick={() =>
                        void toggleLight(
                          light.entity_id,
                          isOn,
                          lightConfigByEntity[light.entity_id]?.update_timeout_seconds,
                        )
                      }
                      className={`hp-light-row group flex h-14 w-full items-center gap-1.5 rounded-xl border px-3 text-left transition disabled:cursor-not-allowed disabled:opacity-55 ${
                        isOn
                          ? "border-amber-300/75 bg-amber-100/85 text-slate-900 ring-1 ring-amber-300/55 shadow-[0_0_20px_rgba(251,191,36,0.22)] dark:border-amber-400/45 dark:bg-amber-300/12 dark:text-slate-900 dark:ring-amber-500/30"
                          : "border-slate-300/80 bg-slate-200/75 text-slate-700 hover:border-amber-300 hover:bg-amber-50/60 dark:border-white/10 dark:bg-[#0a0a0a]/95 dark:text-slate-300 dark:hover:border-amber-900 dark:hover:bg-[#0d0d0d]"
                      }`}
                      title={light.entity_id}
                    >
                      <LightIcon
                        icon={light.icon}
                        className={`hp-light-icon h-5 w-5 shrink-0 transition sm:h-6 sm:w-6 ${
                          isOn
                            ? "text-slate-900 dark:text-slate-900"
                            : "text-slate-400/70 dark:text-slate-600/80"
                        }`}
                      />
                      <span className="block min-w-0 flex-1 text-sm font-medium leading-tight sm:text-[0.93rem]">
                        <ScrollingLightName name={lightLabel(light, state)} />
                      </span>
                      {isPending ? (
                        <span className="inline-flex shrink-0 items-center">
                          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-500/45 border-t-slate-900 dark:border-slate-400/30 dark:border-t-slate-100" />
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <footer className="mx-auto mt-5 w-full max-w-6xl text-right text-xs text-slate-500 dark:text-slate-400">
        <a href={normalizePath("/")} className="hover:underline">
          Back to dashboards
        </a>
      </footer>
    </div>
  );
}
