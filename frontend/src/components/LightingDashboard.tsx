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
type DragState = {
  entityId: string;
  pointerId: number;
  startY: number;
  startX: number;
  startBrightnessPct: number;
  currentBrightnessPct: number;
  holdReady: boolean;
  isDragging: boolean;
  meterSide: "left" | "right";
};

type NormalizedLight = {
  entity_id: string;
  display_name?: string;
  icon?: string;
  update_timeout_seconds?: number;
  dimmable?: boolean;
};

const DRAG_HOLD_DELAY_MS = 280;
const DRAG_CANCEL_DISTANCE_PX = 8;
const DRAG_PIXELS_PER_PERCENT = 1.6;

function toWebSocketUrl(apiBaseUrl: string): string {
  const parsed = new URL(apiBaseUrl);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = "/api/ws/entities";
  parsed.search = "";
  return parsed.toString();
}

function clampPercent(value: number): number {
  return Math.max(1, Math.min(100, Math.round(value)));
}

function brightnessPercentFromState(state?: EntityStateResponse): number {
  const brightnessPct = Number(state?.attributes?.brightness_pct);
  if (Number.isFinite(brightnessPct)) {
    return clampPercent(brightnessPct);
  }
  const brightnessRaw = Number(state?.attributes?.brightness);
  if (Number.isFinite(brightnessRaw)) {
    return clampPercent((brightnessRaw / 255) * 100);
  }
  if (state?.state === "on") {
    return 100;
  }
  return 50;
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
    dimmable: light.dimmable,
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
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragBrightness, setDragBrightness] = useState<Record<string, number | undefined>>({});
  const [editorOpen, setEditorOpen] = useState(false);
  const [configDraft, setConfigDraft] = useState('{\n  "rooms": []\n}');
  const [configSaveError, setConfigSaveError] = useState<string | null>(null);
  const [configSaving, setConfigSaving] = useState(false);
  const webSocketRef = useRef<WebSocket | null>(null);
  const pendingTimeoutsRef = useRef<Record<string, number>>({});
  const suppressClickRef = useRef<Set<string>>(new Set());
  const suppressClickTimeoutsRef = useRef<Record<string, number>>({});
  const dragThrottleRef = useRef<Record<string, number>>({});
  const dragHoldTimerRef = useRef<number | null>(null);

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

  function clearClickSuppression(entityId: string): void {
    const timeoutId = suppressClickTimeoutsRef.current[entityId];
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
      delete suppressClickTimeoutsRef.current[entityId];
    }
    suppressClickRef.current.delete(entityId);
  }

  function queueClickSuppression(entityId: string, ttlMs = 450): void {
    clearClickSuppression(entityId);
    suppressClickRef.current.add(entityId);
    suppressClickTimeoutsRef.current[entityId] = window.setTimeout(() => {
      clearClickSuppression(entityId);
    }, ttlMs);
  }

  async function sendBrightnessUpdate(entityId: string, brightnessPct: number): Promise<void> {
    const now = Date.now();
    const last = dragThrottleRef.current[entityId] ?? 0;
    if (now - last < 120) {
      return;
    }
    dragThrottleRef.current[entityId] = now;
    await client.setLightState(entityId, { is_on: true, brightness_pct: brightnessPct });
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
      if (dragHoldTimerRef.current !== null) {
        window.clearTimeout(dragHoldTimerRef.current);
        dragHoldTimerRef.current = null;
      }
      for (const timeoutId of Object.values(pendingTimeoutsRef.current)) {
        window.clearTimeout(timeoutId);
      }
      pendingTimeoutsRef.current = {};
      for (const timeoutId of Object.values(suppressClickTimeoutsRef.current)) {
        window.clearTimeout(timeoutId);
      }
      suppressClickTimeoutsRef.current = {};
      suppressClickRef.current.clear();
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

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      setDragState((previous) => {
        if (!previous) {
          return previous;
        }
        if (event.pointerId !== previous.pointerId) {
          return previous;
        }

        const deltaY = previous.startY - event.clientY;
        const deltaX = Math.abs(event.clientX - previous.startX);
        const hasMovedEnough = Math.abs(deltaY) > DRAG_CANCEL_DISTANCE_PX || deltaX > DRAG_CANCEL_DISTANCE_PX;
        const verticalIntent = Math.abs(deltaY) >= deltaX;

        if (!previous.holdReady) {
          if (hasMovedEnough) {
            if (dragHoldTimerRef.current !== null) {
              window.clearTimeout(dragHoldTimerRef.current);
              dragHoldTimerRef.current = null;
            }
            queueClickSuppression(previous.entityId);
            return null;
          }
          return previous;
        }

        const shouldDrag = previous.isDragging || (hasMovedEnough && verticalIntent);

        if (!shouldDrag) {
          return previous;
        }

        if (event.cancelable) {
          event.preventDefault();
        }

        const nextPct = clampPercent(previous.startBrightnessPct + deltaY / DRAG_PIXELS_PER_PERCENT);
        if (!previous.isDragging) {
          suppressClickRef.current.add(previous.entityId);
        }

        setDragBrightness((old) => ({ ...old, [previous.entityId]: nextPct }));
        void sendBrightnessUpdate(previous.entityId, nextPct);
        return { ...previous, isDragging: true, currentBrightnessPct: nextPct };
      });
    }

    function finishDrag(event: PointerEvent) {
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }
      if (dragHoldTimerRef.current !== null) {
        window.clearTimeout(dragHoldTimerRef.current);
        dragHoldTimerRef.current = null;
      }
      if (dragState.holdReady) {
        queueClickSuppression(dragState.entityId);
      }
      if (dragState.holdReady && dragState.isDragging) {
        const finalPct = dragState.currentBrightnessPct;
        const entityId = dragState.entityId;
        void client.setLightState(entityId, { is_on: true, brightness_pct: finalPct });
        setLightStates((previous) => ({
          ...previous,
          [entityId]: {
            ...(previous[entityId] ?? {
              entity_id: entityId,
              state: "on",
              attributes: {},
              last_changed: null,
              last_updated: null,
            }),
            state: "on",
            attributes: {
              ...(previous[entityId]?.attributes ?? {}),
              brightness_pct: finalPct,
              brightness: Math.round((finalPct / 100) * 255),
            },
          },
        }));
      }
      setDragState(null);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, [client, dragState]);

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

  async function setRoomLights(room: RoomLightingConfig, isOn: boolean): Promise<void> {
    const lights = room.lights.map((light) => normalizeLightConfig(light));

    for (const light of lights) {
      const timeoutMs = Math.max(0, Math.round(((light.update_timeout_seconds ?? 0) as number) * 1000));
      if (timeoutMs > 0) {
        clearPendingTransition(light.entity_id);
        setPendingTransitions((previous) => ({
          ...previous,
          [light.entity_id]: { targetState: isOn ? "on" : "off", timeoutMs },
        }));
        pendingTimeoutsRef.current[light.entity_id] = window.setTimeout(() => {
          clearPendingTransition(light.entity_id);
          void refreshLightState(light.entity_id);
        }, timeoutMs);
      }
    }

    try {
      await Promise.all(lights.map(async (light) => client.setLightState(light.entity_id, { is_on: isOn })));

      const immediate = lights.filter((light) => !light.update_timeout_seconds).map((light) => light.entity_id);
      await Promise.all(immediate.map(async (entityId) => refreshLightState(entityId)));
    } catch {
      for (const light of lights) {
        clearPendingTransition(light.entity_id);
      }
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
                '{"entity_id":"light.kitchen","display_name":"Kitchen Main","icon":"mdi:chandelier","update_timeout_seconds":8,"dimmable":true}'
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
              {(() => {
                const onCount = roomOnCount(room);
                const anyOn = onCount > 0;
                const roomHasPending = room.lights.some((light) => {
                  const entityId = normalizeLightConfig(light).entity_id;
                  return Boolean(pendingTransitions[entityId]);
                });

                return (
              <div className="mb-2.5 flex items-center justify-between">
                <h2 className="text-[1.15rem] font-semibold leading-none text-slate-900 dark:text-slate-100 sm:text-2xl">{room.name}</h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={roomHasPending}
                    onClick={() => void setRoomLights(room, !anyOn)}
                    className="rounded-md border border-slate-300/80 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-700 transition hover:border-amber-400 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/15 dark:text-slate-300 dark:hover:border-amber-500 dark:hover:text-amber-300"
                  >
                    {anyOn ? "All Off" : "All On"}
                  </button>
                  <span className="hp-nonfunctional rounded-full bg-slate-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-700 dark:text-slate-300">
                    {onCount}/{room.lights.length} on
                  </span>
                </div>
              </div>
                );
              })()}

              <div className="hp-light-grid grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
                {room.lights.map((rawLight) => {
                  const light = normalizeLightConfig(rawLight);
                  const state = lightStates[light.entity_id];
                  const isOn = state?.state === "on";
                  const isBusy = busyEntityId === light.entity_id;
                  const pending = pendingTransitions[light.entity_id];
                  const isPending = Boolean(pending);
                  const isDimmable = lightConfigByEntity[light.entity_id]?.dimmable === true;

                  return (
                    <button
                      key={light.entity_id}
                      type="button"
                      disabled={isBusy || isPending}
                      onPointerDown={(event) => {
                        if (isBusy || isPending || !isDimmable || !event.isPrimary || dragState !== null) {
                          return;
                        }
                        if (dragHoldTimerRef.current !== null) {
                          window.clearTimeout(dragHoldTimerRef.current);
                          dragHoldTimerRef.current = null;
                        }
                        const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
                        const meterSide: "left" | "right" = rect.right + 96 < window.innerWidth ? "right" : "left";
                        const currentPct = dragBrightness[light.entity_id] ?? brightnessPercentFromState(state);
                        setDragState({
                          entityId: light.entity_id,
                          pointerId: event.pointerId,
                          startY: event.clientY,
                          startX: event.clientX,
                          startBrightnessPct: currentPct,
                          currentBrightnessPct: currentPct,
                          holdReady: false,
                          isDragging: false,
                          meterSide,
                        });
                        dragHoldTimerRef.current = window.setTimeout(() => {
                          setDragState((previous) => {
                            if (!previous || previous.entityId !== light.entity_id) {
                              return previous;
                            }
                            suppressClickRef.current.add(previous.entityId);
                            return { ...previous, holdReady: true };
                          });
                          dragHoldTimerRef.current = null;
                        }, DRAG_HOLD_DELAY_MS);
                      }}
                      onClick={() =>
                        {
                          if (suppressClickRef.current.has(light.entity_id)) {
                            clearClickSuppression(light.entity_id);
                            return;
                          }
                          void toggleLight(
                            light.entity_id,
                            isOn,
                            lightConfigByEntity[light.entity_id]?.update_timeout_seconds,
                          );
                        }
                      }
                      className={`hp-light-row group relative flex h-14 w-full items-center gap-1.5 rounded-xl border px-3 text-left transition disabled:cursor-not-allowed disabled:opacity-55 ${
                        isOn
                          ? "border-amber-300/75 bg-amber-100/85 text-slate-900 ring-1 ring-amber-300/55 shadow-[0_0_20px_rgba(251,191,36,0.22)] dark:border-amber-500/55 dark:bg-amber-900/45 dark:text-amber-100 dark:ring-amber-500/25"
                          : "border-slate-300/80 bg-slate-200/75 text-slate-700 hover:border-amber-300 hover:bg-amber-50/60 dark:border-white/10 dark:bg-[#0a0a0a]/95 dark:text-slate-300 dark:hover:border-amber-900 dark:hover:bg-[#0d0d0d]"
                      }`}
                      title={light.entity_id}
                    >
                      <LightIcon
                        icon={light.icon}
                        className={`hp-light-icon h-5 w-5 shrink-0 transition sm:h-6 sm:w-6 ${
                          isOn
                            ? "text-slate-900 dark:text-amber-100"
                            : "text-slate-400/70 dark:text-slate-600/80"
                        }`}
                      />
                      <span className="block min-w-0 flex-1 text-sm font-medium leading-tight sm:text-[0.93rem]">
                        <ScrollingLightName name={lightLabel(light, state)} />
                      </span>
                      {isDimmable ? (
                        <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center" title="Dimmable">
                          <svg
                            viewBox="0 0 16 16"
                            className="h-3 w-3 text-cyan-600 dark:text-cyan-300 dark:drop-shadow-[0_0_6px_rgba(103,232,249,0.7)]"
                            aria-hidden="true"
                          >
                            <circle
                              cx="8"
                              cy="8"
                              r="5.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              pathLength="100"
                              strokeDasharray="60 40"
                              transform="rotate(95 8 8)"
                            />
                          </svg>
                        </span>
                      ) : null}
                      {isPending ? (
                        <span className="inline-flex shrink-0 items-center">
                          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-500/45 border-t-slate-900 dark:border-slate-400/30 dark:border-t-slate-100" />
                        </span>
                      ) : null}
                      {dragState?.entityId === light.entity_id && dragState.holdReady ? (
                        <div
                          className={`absolute top-1/2 z-20 h-28 w-10 -translate-y-1/2 rounded-xl border border-slate-300/80 bg-white p-1 shadow-lg dark:border-white/15 dark:bg-[#090909] ${
                            dragState.meterSide === "right" ? "left-[calc(100%+0.35rem)]" : "right-[calc(100%+0.35rem)]"
                          }`}
                        >
                          <div className="relative h-full w-full rounded-md bg-slate-200/80 dark:bg-slate-700/70">
                            <div
                              className="absolute bottom-0 left-0 right-0 rounded-md bg-amber-400/90"
                              style={{ height: `${dragState.currentBrightnessPct}%` }}
                            />
                          </div>
                          <div className="mt-1 text-center text-[9px] font-semibold text-slate-700 dark:text-slate-200">
                            {dragState.currentBrightnessPct}%
                          </div>
                        </div>
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
