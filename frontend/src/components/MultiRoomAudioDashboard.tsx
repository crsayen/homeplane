import { useEffect, useMemo, useRef, useState } from "react";

import { EntityStateResponse, HomeplaneClient } from "../api/homeplaneClient";

export interface RoomAudioConfig {
  name: string;
  switch: string;
  number: string;
}

export interface MultiRoomAudioConfig {
  rooms: RoomAudioConfig[];
}

type RoomState = {
  loading: boolean;
  switchState?: EntityStateResponse;
  numberState?: EntityStateResponse;
  error?: string;
};

type RoomStateMap = Record<string, RoomState>;
type StreamState = "connecting" | "live" | "reconnecting";
type ThemeMode = "system" | "light" | "dark";

const DEFAULT_CONFIG_URL = "/multi-room-audio.config.json";

function toWebSocketUrl(apiBaseUrl: string): string {
  const parsed = new URL(apiBaseUrl);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = "/api/ws/entities";
  parsed.search = "";
  return parsed.toString();
}

function toDisplayVolume(value: unknown): string {
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber)) {
    return "--";
  }
  return `${Math.round(asNumber * 100)}%`;
}

function nextTheme(mode: ThemeMode): ThemeMode {
  if (mode === "system") {
    return "dark";
  }
  if (mode === "dark") {
    return "light";
  }
  return "system";
}

function themeLabel(mode: ThemeMode): string {
  if (mode === "system") {
    return "System";
  }
  if (mode === "dark") {
    return "Dark";
  }
  return "Light";
}

export function MultiRoomAudioDashboard({
  apiBaseUrl,
  apiKey,
  configUrl = DEFAULT_CONFIG_URL,
}: {
  apiBaseUrl: string;
  apiKey: string;
  configUrl?: string;
}) {
  const client = useMemo(() => new HomeplaneClient(apiBaseUrl, apiKey), [apiBaseUrl, apiKey]);
  const [config, setConfig] = useState<MultiRoomAudioConfig | null>(null);
  const [roomStates, setRoomStates] = useState<RoomStateMap>({});
  const [configError, setConfigError] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<StreamState>("connecting");
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");
  const [masterVolume, setMasterVolume] = useState(0.5);
  const [bulkBusy, setBulkBusy] = useState(false);
  const webSocketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("homeplane-theme");
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
    window.localStorage.setItem("homeplane-theme", themeMode);
  }, [themeMode]);

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      setConfigError(null);
      try {
        const response = await fetch(configUrl);
        if (!response.ok) {
          throw new Error(`Failed to load config (${response.status})`);
        }
        const payload = (await response.json()) as MultiRoomAudioConfig;
        if (!payload.rooms || !Array.isArray(payload.rooms)) {
          throw new Error("Config must include a rooms array");
        }

        if (!cancelled) {
          setConfig(payload);
        }
      } catch (error) {
        if (!cancelled) {
          setConfigError(error instanceof Error ? error.message : "Unknown config error");
        }
      }
    }

    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, [configUrl]);

  useEffect(() => {
    if (!config) {
      return;
    }

    const initialState: RoomStateMap = {};
    for (const room of config.rooms) {
      initialState[room.name] = { loading: true };
    }
    setRoomStates(initialState);

    void Promise.all(config.rooms.map(async (room) => refreshRoom(room)));
  }, [config]);

  useEffect(() => {
    if (!config) {
      return;
    }

    let reconnectTimer: number | null = null;
    let stopped = false;

    const roomByEntity = new Map<string, { roomName: string; field: "switchState" | "numberState" }>();
    for (const room of config.rooms) {
      roomByEntity.set(room.switch, { roomName: room.name, field: "switchState" });
      roomByEntity.set(room.number, { roomName: room.name, field: "numberState" });
    }

    const connect = () => {
      setStreamState("connecting");

      const wsUrl = new URL(toWebSocketUrl(apiBaseUrl));
      wsUrl.searchParams.set("api_key", apiKey);
      wsUrl.searchParams.set("entity_ids", Array.from(roomByEntity.keys()).join(","));

      const socket = new WebSocket(wsUrl.toString());
      webSocketRef.current = socket;

      socket.onopen = () => setStreamState("live");

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as { type: string; state: EntityStateResponse };
          if (payload.type !== "state_changed") {
            return;
          }

          const mapped = roomByEntity.get(payload.state.entity_id);
          if (!mapped) {
            return;
          }

          setRoomStates((previous) => ({
            ...previous,
            [mapped.roomName]: {
              ...(previous[mapped.roomName] ?? { loading: false }),
              loading: false,
              [mapped.field]: payload.state,
            },
          }));
        } catch {
          return;
        }
      };

      socket.onerror = () => {
        setStreamState("reconnecting");
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

  async function refreshRoom(room: RoomAudioConfig): Promise<void> {
    setRoomStates((previous) => ({
      ...previous,
      [room.name]: {
        ...(previous[room.name] ?? {}),
        loading: true,
        error: undefined,
      },
    }));

    try {
      const [switchState, numberState] = await Promise.all([
        client.getEntityState(room.switch),
        client.getEntityState(room.number),
      ]);

      setRoomStates((previous) => ({
        ...previous,
        [room.name]: {
          ...(previous[room.name] ?? {}),
          loading: false,
          switchState,
          numberState,
          error: undefined,
        },
      }));
    } catch (error) {
      setRoomStates((previous) => ({
        ...previous,
        [room.name]: {
          ...(previous[room.name] ?? {}),
          loading: false,
          error: error instanceof Error ? error.message : "Failed to refresh room",
        },
      }));
    }
  }

  async function setSwitch(room: RoomAudioConfig, isOn: boolean): Promise<void> {
    await client.setSwitchState(room.switch, { is_on: isOn });
    await refreshRoom(room);
  }

  async function setVolume(room: RoomAudioConfig, value: number): Promise<void> {
    await client.setNumberValue(room.number, { value });
    await refreshRoom(room);
  }

  const onRooms = useMemo(() => {
    if (!config) {
      return [];
    }
    return config.rooms.filter((room) => roomStates[room.name]?.switchState?.state === "on");
  }, [config, roomStates]);

  useEffect(() => {
    if (onRooms.length === 0) {
      return;
    }
    const currentVolumes = onRooms
      .map((room) => Number(roomStates[room.name]?.numberState?.state))
      .filter((value) => Number.isFinite(value));
    if (currentVolumes.length === 0) {
      return;
    }
    const average = currentVolumes.reduce((sum, value) => sum + value, 0) / currentVolumes.length;
    setMasterVolume(Math.max(0, Math.min(1, average)));
  }, [onRooms, roomStates]);

  async function applyMasterVolume(value: number): Promise<void> {
    if (onRooms.length === 0) {
      return;
    }
    setBulkBusy(true);
    try {
      await Promise.all(onRooms.map((room) => client.setNumberValue(room.number, { value })));
      await Promise.all(onRooms.map(async (room) => refreshRoom(room)));
    } finally {
      setBulkBusy(false);
    }
  }

  async function turnAllOff(): Promise<void> {
    if (onRooms.length === 0) {
      return;
    }
    setBulkBusy(true);
    try {
      await Promise.all(onRooms.map((room) => client.setSwitchState(room.switch, { is_on: false })));
      await Promise.all(onRooms.map(async (room) => refreshRoom(room)));
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-x-clip px-2.5 pb-6 pt-2.5 sm:px-6 sm:pb-10 sm:pt-4 lg:px-10">
      <div className="ambient-bg" />

      <header className="sticky top-2 z-20 mx-auto mb-3 flex w-full max-w-6xl items-center justify-between gap-2 rounded-xl border border-white/40 bg-white/75 p-2 shadow-lg shadow-cyan-900/10 backdrop-blur-xl dark:border-white/10 dark:bg-black/80 sm:top-3 sm:mb-6 sm:gap-3 sm:rounded-2xl sm:p-3">
        <div className="min-w-0 flex items-center gap-2 sm:gap-3">
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 sm:text-base">Homeplane</span>
          <span
            className={`inline-flex shrink-0 items-center rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] sm:px-2.5 sm:tracking-[0.16em] ${
              streamState === "live"
                ? "bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-300"
                : "bg-amber-500/20 text-amber-700 ring-1 ring-amber-500/25 dark:text-amber-300"
            }`}
          >
            Stream {streamState}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setThemeMode((previous) => nextTheme(previous))}
          title={`Theme ${themeLabel(themeMode)} (${resolvedTheme})`}
          className="shrink-0 whitespace-nowrap rounded-lg border border-slate-300/80 bg-white/90 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-700 transition hover:border-cyan-400 hover:text-cyan-700 dark:border-white/15 dark:bg-black dark:text-slate-200 dark:hover:border-cyan-400 dark:hover:text-cyan-200 sm:rounded-xl sm:px-3 sm:py-2 sm:text-xs sm:tracking-[0.18em]"
        >
          {themeLabel(themeMode)}
        </button>
      </header>

      <section className="mx-auto mb-3 w-full max-w-6xl rounded-xl border border-white/40 bg-white/75 p-3 shadow-lg shadow-cyan-900/10 backdrop-blur-xl dark:border-white/10 dark:bg-black/80 sm:mb-5 sm:rounded-2xl sm:p-4">
        <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
          <span>Global Controls</span>
          <span>{onRooms.length} On</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:gap-3">
          <div className="rounded-xl border border-slate-200/80 bg-white/70 p-2.5 dark:border-white/10 dark:bg-black/55">
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
                Master Volume
              </label>
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {Math.round(masterVolume * 100)}%
              </span>
            </div>
            <input
              className="volume-slider"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={masterVolume}
              disabled={bulkBusy || onRooms.length === 0}
              onChange={(event) => setMasterVolume(Number(event.target.value))}
              onPointerUp={(event) => void applyMasterVolume(Number((event.target as HTMLInputElement).value))}
            />
          </div>
          <button
            type="button"
            onClick={() => void turnAllOff()}
            disabled={bulkBusy || onRooms.length === 0}
            className="rounded-xl border border-slate-300/80 bg-white/90 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700 transition hover:border-rose-400 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/15 dark:bg-black dark:text-slate-200 dark:hover:border-rose-500 dark:hover:text-rose-300"
          >
            All Off
          </button>
        </div>
      </section>

      {configError ? (
        <div className="mx-auto w-full max-w-6xl rounded-2xl border border-red-300/70 bg-red-50/80 p-4 text-sm text-red-800 backdrop-blur dark:border-red-700/60 dark:bg-red-950/40 dark:text-red-200">
          Config error: {configError}
        </div>
      ) : null}

      {!config ? (
        <div className="mx-auto w-full max-w-6xl rounded-2xl border border-slate-200/80 bg-white/75 p-6 text-sm text-slate-600 backdrop-blur dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300">
          Loading multi-room audio configuration...
        </div>
      ) : (
        <div className="mx-auto grid w-full max-w-6xl gap-2.5 sm:gap-5 xl:grid-cols-2">
          {config.rooms.map((room, index) => {
            const roomState = roomStates[room.name];
            const switchOn = roomState?.switchState?.state === "on";
            const currentVolume = Number(roomState?.numberState?.state ?? 0);

            if (!switchOn) {
              return (
                <button
                  key={room.name}
                  type="button"
                  onClick={() => void setSwitch(room, true)}
                  className="animate-fade-up flex w-full flex-col rounded-2xl border border-slate-300/80 bg-slate-200/65 p-4 text-left shadow-lg shadow-slate-900/10 backdrop-blur-sm transition hover:-translate-y-0.5 hover:border-cyan-300 hover:bg-slate-100/80 hover:shadow-glow dark:border-white/10 dark:bg-[#0a0a0a]/90 dark:shadow-black/70 dark:hover:border-cyan-900 dark:hover:bg-[#0d0d0d] sm:rounded-3xl sm:p-6"
                  style={{ animationDelay: `${index * 70}ms` }}
                >
                  <div>
                    <h2 className="text-[2rem] font-semibold leading-none text-slate-900 dark:text-slate-100 sm:text-3xl">{room.name}</h2>
                    <p className="mt-1.5 text-[11px] uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400 sm:text-xs sm:tracking-[0.16em]">
                      {roomState?.loading ? "syncing" : "off"} · tap to turn on
                    </p>
                  </div>

                  <div className="mt-4 text-[11px] uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
                    <span className="block max-w-full truncate" title={room.switch}>
                      {room.switch}
                    </span>
                  </div>

                  {roomState?.error ? (
                    <p className="mt-3 rounded-lg border border-red-300/70 bg-red-50/70 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
                      {roomState.error}
                    </p>
                  ) : null}
                </button>
              );
            }

            return (
              <section
                key={room.name}
                className="animate-fade-up flex flex-col rounded-2xl border border-slate-900/20 bg-white/92 p-4 shadow-lg shadow-slate-900/15 ring-1 ring-slate-900/5 backdrop-blur-sm dark:border-white/20 dark:bg-black/88 dark:shadow-black/70 dark:ring-white/10 sm:rounded-3xl sm:p-5"
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <div className="mb-3 flex items-start justify-between gap-3 sm:mb-4">
                  <div>
                    <h2 className="text-[2rem] font-semibold leading-none text-slate-900 dark:text-slate-100 sm:text-3xl">{room.name}</h2>
                    <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400 sm:tracking-[0.16em]">
                      {roomState?.loading ? "syncing" : "ready"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void setSwitch(room, false)}
                    className="rounded-lg border border-slate-300/80 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700 transition hover:border-rose-400 hover:text-rose-700 dark:border-white/15 dark:bg-black/70 dark:text-slate-200 dark:hover:border-rose-500 dark:hover:text-rose-300 sm:rounded-xl sm:px-3 sm:py-2 sm:text-xs sm:tracking-[0.16em]"
                  >
                    Turn Off
                  </button>
                </div>

                {roomState?.error ? (
                  <p className="mb-3 rounded-lg border border-red-300/70 bg-red-50/70 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
                    {roomState.error}
                  </p>
                ) : null}

                <div className="rounded-xl border border-slate-200/80 bg-white/70 p-3 dark:border-white/10 dark:bg-black/55 sm:rounded-2xl sm:p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <label htmlFor={`volume-${room.name}`} className="text-[11px] uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400 sm:text-xs sm:tracking-[0.14em]">
                      Volume
                    </label>
                    <span className="text-lg font-semibold text-slate-900 dark:text-slate-100 sm:text-2xl">{toDisplayVolume(roomState?.numberState?.state)}</span>
                  </div>

                  <input
                    id={`volume-${room.name}`}
                    className="volume-slider"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={Number.isFinite(currentVolume) ? currentVolume : 0}
                    onChange={(event) => {
                      const nextValue = Number(event.target.value);
                      setRoomStates((previous) => ({
                        ...previous,
                        [room.name]: {
                          ...(previous[room.name] ?? { loading: false }),
                          numberState: {
                            ...(previous[room.name]?.numberState ?? {
                              entity_id: room.number,
                              attributes: {},
                              last_changed: null,
                              last_updated: null,
                            }),
                            state: String(nextValue),
                            entity_id: room.number,
                          },
                        },
                      }));
                    }}
                    onPointerUp={(event) => void setVolume(room, Number((event.target as HTMLInputElement).value))}
                  />
                </div>

                <div className="mt-3 flex min-w-0 items-center justify-between gap-2 text-[11px] uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400 sm:mt-4 sm:tracking-[0.14em]">
                  <span className="min-w-0 max-w-[62%] truncate" title={room.switch}>
                    {room.switch}
                  </span>
                  <button
                    type="button"
                    onClick={() => void refreshRoom(room)}
                    className="rounded-xl border border-slate-300/80 px-3 py-1.5 font-semibold text-slate-600 transition hover:border-cyan-400 hover:text-cyan-700 dark:border-white/15 dark:bg-black/70 dark:text-slate-300 dark:hover:border-cyan-400 dark:hover:text-cyan-300"
                  >
                    Refresh
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
