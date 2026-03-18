import { useEffect, useMemo, useRef, useState } from "react";

import { EntityStateResponse, HomeplaneClient, KioskConfig, MediaPlayerCommand, WeatherForecastItem } from "../api/homeplaneClient";

// ── Helpers ───────────────────────────────────────────────────────────────────

const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const DAYS_SHORT = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

function formatTime(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const display = h % 12 || 12;
  return `${display}:${String(m).padStart(2, "0")} ${ampm}`;
}

function formatDate(date: Date): string {
  return `${WEEKDAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

function weatherEmoji(condition: string): string {
  const map: Record<string, string> = {
    "sunny": "☀️",
    "clear-night": "🌙",
    "partlycloudy": "⛅",
    "cloudy": "☁️",
    "rainy": "🌧️",
    "pouring": "🌧️",
    "snowy": "❄️",
    "snowy-rainy": "🌨️",
    "fog": "🌫️",
    "hail": "🌨️",
    "lightning": "⚡",
    "lightning-rainy": "⛈️",
    "windy": "💨",
    "windy-variant": "💨",
    "exceptional": "❗",
    "tornado": "🌪️",
  };
  return map[condition.toLowerCase()] ?? "☁️";
}

function toWsUrl(apiBaseUrl: string): string {
  const parsed = new URL(apiBaseUrl);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = "/api/ws/entities";
  parsed.search = "";
  return parsed.toString();
}

// ── Sub-components ────────────────────────────────────────────────────────────

function WeatherPanel({ state, forecast }: { state: EntityStateResponse | null; forecast: WeatherForecastItem[] }) {
  if (!state) {
    return (
      <div className="h-full flex items-center justify-center text-white/20 text-sm">
        Loading weather…
      </div>
    );
  }

  const temp = state.attributes.temperature as number | undefined;
  const unit = (state.attributes.temperature_unit as string | undefined) ?? "°F";
  const daily = forecast.slice(0, 5);

  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      <div className="text-[10px] uppercase tracking-[0.3em] text-white/30 font-semibold">Weather</div>

      {/* Current */}
      <div className="flex items-center gap-3">
        <span className="text-[5vw] leading-none">{weatherEmoji(state.state)}</span>
        <div>
          <div className="text-[5.5vw] font-bold leading-none text-white tabular-nums">
            {temp !== undefined ? `${Math.round(temp)}${unit}` : "--"}
          </div>
          <div className="text-[1.2vw] text-white/40 capitalize mt-1">
            {state.state.replace(/-/g, " ")}
          </div>
        </div>
      </div>

      {/* Forecast */}
      {daily.length > 0 && (
        <div className="flex gap-1 mt-auto">
          {daily.map((item, i) => {
            const d = new Date(item.datetime);
            const label = i === 0 ? "Now" : DAYS_SHORT[d.getDay()];
            return (
              <div key={item.datetime} className="flex flex-col items-center gap-0.5 flex-1">
                <div className="text-[0.7vw] text-white/30 font-semibold uppercase tracking-wide">{label}</div>
                <div className="text-[1.3vw]">{weatherEmoji(item.condition)}</div>
                <div className="text-[0.85vw] text-white/70 font-semibold tabular-nums">
                  {Math.round(item.temperature)}°
                </div>
                {item.templow !== undefined && (
                  <div className="text-[0.75vw] text-white/30 tabular-nums">
                    {Math.round(item.templow)}°
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MusicPanel({
  state,
  onCommand,
  onVolumeCommit,
}: {
  state: EntityStateResponse | null;
  onCommand: (cmd: MediaPlayerCommand) => void;
  onVolumeCommit: (vol: number) => void;
}) {
  const [localVolume, setLocalVolume] = useState<number | null>(null);

  // Reset local volume when entity state updates
  const stateVolume = state?.attributes.volume_level as number | undefined;
  const prevVolumeRef = useRef(stateVolume);
  useEffect(() => {
    if (stateVolume !== prevVolumeRef.current) {
      prevVolumeRef.current = stateVolume;
      setLocalVolume(null);
    }
  }, [stateVolume]);

  const displayVolume = localVolume ?? stateVolume ?? 0;
  const isPlaying = state?.state === "playing";
  const isActive = state?.state === "playing" || state?.state === "paused";
  const title = state?.attributes.media_title as string | undefined;
  const artist = state?.attributes.media_artist as string | undefined;

  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      <div className="text-[10px] uppercase tracking-[0.3em] text-white/30 font-semibold">Music</div>

      {/* Track info */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {!state ? (
          <div className="text-[1vw] text-white/20">No player configured</div>
        ) : isActive && (title ?? artist) ? (
          <>
            {title && (
              <div className="text-[1.5vw] font-semibold text-white leading-tight line-clamp-2">{title}</div>
            )}
            {artist && (
              <div className="text-[1vw] text-white/40 mt-1 truncate">{artist}</div>
            )}
          </>
        ) : (
          <div className="text-[1vw] text-white/20 capitalize">{state.state}</div>
        )}
      </div>

      {/* Controls */}
      {state && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-center gap-5">
            <button
              type="button"
              onClick={() => onCommand("previous_track")}
              className="text-white/50 hover:text-white transition text-[1.8vw]"
            >
              ⏮
            </button>
            <button
              type="button"
              onClick={() => onCommand("play_pause")}
              className="text-white text-[2.2vw] transition hover:scale-110"
            >
              {isPlaying ? "⏸" : "▶"}
            </button>
            <button
              type="button"
              onClick={() => onCommand("next_track")}
              className="text-white/50 hover:text-white transition text-[1.8vw]"
            >
              ⏭
            </button>
          </div>

          {/* Volume */}
          <div className="flex items-center gap-2">
            <span className="text-[0.9vw] text-white/20">🔈</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={displayVolume}
              onChange={(e) => setLocalVolume(Number(e.target.value))}
              onPointerUp={(e) => {
                const vol = Number((e.target as HTMLInputElement).value);
                setLocalVolume(null);
                onVolumeCommit(vol);
              }}
              className="volume-slider flex-1"
            />
            <span className="text-[0.8vw] text-white/25 tabular-nums w-8 text-right">
              {Math.round(displayVolume * 100)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function CamerasPanel({
  config,
  camTimestamp,
  client,
}: {
  config: KioskConfig | null;
  camTimestamp: number;
  client: HomeplaneClient;
}) {
  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      <div className="text-[10px] uppercase tracking-[0.3em] text-white/30 font-semibold">Cameras</div>

      {/* Package camera (main) */}
      <div className="flex-1 min-h-0 rounded-xl bg-black/50 overflow-hidden flex items-center justify-center">
        {config?.package_camera_entity ? (
          <img
            key={camTimestamp}
            src={`${client.getCameraSnapshotUrl(config.package_camera_entity)}&t=${camTimestamp}`}
            alt="Package Camera"
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-white/15 text-[0.9vw]">Package camera not configured</span>
        )}
      </div>

      {/* Doorbell cam thumbnail */}
      <div className="h-[4.5vw] rounded-lg bg-black/50 overflow-hidden flex items-center justify-center">
        {config?.doorbell_camera_entity ? (
          <img
            key={`db-${camTimestamp}`}
            src={`${client.getCameraSnapshotUrl(config.doorbell_camera_entity)}&t=${camTimestamp}`}
            alt="Doorbell Camera"
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-white/15 text-[0.7vw]">Doorbell camera not configured</span>
        )}
      </div>
    </div>
  );
}

function DoorbellOverlay({
  config,
  client,
  autoCloseAt,
  onDismiss,
}: {
  config: KioskConfig;
  client: HomeplaneClient;
  autoCloseAt: Date;
  onDismiss: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(30);
  const [useSnapshot, setUseSnapshot] = useState(false);
  const [snapshotTs, setSnapshotTs] = useState(Date.now());

  // Countdown + auto-dismiss
  useEffect(() => {
    const id = setInterval(() => {
      const remaining = Math.max(0, Math.round((autoCloseAt.getTime() - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) onDismiss();
    }, 500);
    return () => clearInterval(id);
  }, [autoCloseAt, onDismiss]);

  // Fallback snapshot refresh (every 2s) when stream isn't supported
  useEffect(() => {
    if (!useSnapshot) return;
    const id = setInterval(() => setSnapshotTs(Date.now()), 2000);
    return () => clearInterval(id);
  }, [useSnapshot]);

  const camEntity = config.doorbell_camera_entity;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <span className="animate-pulse text-2xl">🔔</span>
          <span className="text-[1.8vw] font-bold text-white uppercase tracking-[0.3em]">Doorbell</span>
        </div>
        <div className="flex items-center gap-5">
          <span className="text-[1vw] text-white/30 tabular-nums">Auto-dismiss in {secondsLeft}s</span>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-xl border border-white/20 px-5 py-2 text-[1vw] font-semibold text-white/70 hover:border-white/60 hover:text-white transition"
          >
            Dismiss
          </button>
        </div>
      </div>

      {/* Camera feed */}
      <div className="flex-1 flex items-center justify-center overflow-hidden bg-black">
        {!camEntity ? (
          <div className="text-white/30 text-[2vw]">No doorbell camera configured</div>
        ) : useSnapshot ? (
          <img
            key={snapshotTs}
            src={`${client.getCameraSnapshotUrl(camEntity)}&t=${snapshotTs}`}
            alt="Doorbell"
            className="max-w-full max-h-full object-contain"
          />
        ) : (
          <img
            src={client.getCameraStreamUrl(camEntity)}
            alt="Doorbell Live"
            className="max-w-full max-h-full object-contain"
            onError={() => setUseSnapshot(true)}
          />
        )}
      </div>
    </div>
  );
}

function ConfigEditor({
  draft,
  onChange,
  onSave,
  onClose,
  saving,
  error,
}: {
  draft: KioskConfig;
  onChange: (updated: KioskConfig) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
  error: string | null;
}) {
  const fields: { key: keyof KioskConfig; label: string; placeholder: string }[] = [
    { key: "weather_entity", label: "Weather Entity", placeholder: "weather.home" },
    { key: "media_player_entity", label: "Media Player Entity", placeholder: "media_player.wiim_pro" },
    { key: "package_camera_entity", label: "Package Camera Entity", placeholder: "camera.g6_entry_package" },
    { key: "doorbell_camera_entity", label: "Doorbell Camera Entity", placeholder: "camera.g6_entry" },
    { key: "doorbell_sensor_entity", label: "Doorbell Sensor Entity", placeholder: "binary_sensor.g6_entry_doorbell" },
  ];

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75">
      <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-[#111] p-6 shadow-2xl">
        <h3 className="text-base font-semibold text-white mb-5">Kiosk Configuration</h3>
        <div className="flex flex-col gap-3">
          {fields.map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="block text-[10px] uppercase tracking-[0.2em] text-white/40 mb-1">{label}</label>
              <input
                type="text"
                value={draft[key]}
                onChange={(e) => onChange({ ...draft, [key]: e.target.value })}
                placeholder={placeholder}
                className="w-full rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-sm text-white placeholder-white/20 outline-none focus:border-cyan-500"
              />
            </div>
          ))}
        </div>
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/60 hover:text-white transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-lg border border-cyan-500/50 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50 transition"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

const EMPTY_CONFIG: KioskConfig = {
  weather_entity: "",
  media_player_entity: "",
  package_camera_entity: "",
  doorbell_camera_entity: "",
  doorbell_sensor_entity: "",
};

export function KioskDashboard({ apiBaseUrl, apiKey }: { apiBaseUrl: string; apiKey: string }) {
  const client = useMemo(() => new HomeplaneClient(apiBaseUrl, apiKey), [apiBaseUrl, apiKey]);

  const [now, setNow] = useState(new Date());
  const [config, setConfig] = useState<KioskConfig | null>(null);
  const [weatherState, setWeatherState] = useState<EntityStateResponse | null>(null);
  const [weatherForecast, setWeatherForecast] = useState<WeatherForecastItem[]>([]);
  const [mediaState, setMediaState] = useState<EntityStateResponse | null>(null);
  const [doorbellActive, setDoorbellActive] = useState(false);
  const [doorbellAutoCloseAt, setDoorbellAutoCloseAt] = useState(new Date());
  const [camTimestamp, setCamTimestamp] = useState(Date.now());
  const [editorOpen, setEditorOpen] = useState(false);
  const [configDraft, setConfigDraft] = useState<KioskConfig>(EMPTY_CONFIG);
  const [configSaving, setConfigSaving] = useState(false);
  const [configSaveError, setConfigSaveError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Force dark mode for the entire kiosk page
  useEffect(() => {
    document.documentElement.classList.add("dark");
    return () => document.documentElement.classList.remove("dark");
  }, []);

  // Clock tick
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Camera refresh (every 60s)
  useEffect(() => {
    const id = setInterval(() => setCamTimestamp(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Load kiosk config
  useEffect(() => {
    let cancelled = false;
    client.getKioskConfig().then((cfg) => {
      if (!cancelled) {
        setConfig(cfg);
        setConfigDraft(cfg);
      }
    }).catch(() => {/* non-fatal */});
    return () => { cancelled = true; };
  }, [client]);

  // Fetch weather (every 5 min)
  useEffect(() => {
    if (!config?.weather_entity) return;
    let cancelled = false;
    const fetch = () => {
      if (!config?.weather_entity) return;
      client.getEntityState(config.weather_entity)
        .then((s) => { if (!cancelled) setWeatherState(s); })
        .catch(() => {/* silently ignore */});
    };
    fetch();
    const id = setInterval(fetch, 5 * 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [client, config?.weather_entity]);

  // Fetch weather forecast (every 5 min)
  useEffect(() => {
    if (!config?.weather_entity) return;
    let cancelled = false;
    const fetchForecast = () => {
      if (!config?.weather_entity) return;
      client.getWeatherForecast(config.weather_entity)
        .then((f) => { if (!cancelled) setWeatherForecast(f); })
        .catch(() => {/* silently ignore */});
    };
    fetchForecast();
    const id = setInterval(fetchForecast, 5 * 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [client, config?.weather_entity]);

  // Fetch media player state (every 30s, also refreshed via WS)
  useEffect(() => {
    if (!config?.media_player_entity) return;
    let cancelled = false;
    const fetch = () => {
      if (!config?.media_player_entity) return;
      client.getEntityState(config.media_player_entity)
        .then((s) => { if (!cancelled) setMediaState(s); })
        .catch(() => {/* silently ignore */});
    };
    fetch();
    const id = setInterval(fetch, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [client, config?.media_player_entity]);

  // WebSocket: real-time media player + doorbell sensor updates
  useEffect(() => {
    if (!config) return;
    const ids = [config.media_player_entity, config.doorbell_sensor_entity].filter(Boolean);
    if (ids.length === 0) return;

    let stopped = false;
    let reconnectTimer: number | null = null;

    const connect = () => {
      const wsUrl = new URL(toWsUrl(apiBaseUrl));
      wsUrl.searchParams.set("api_key", apiKey);
      wsUrl.searchParams.set("entity_ids", ids.join(","));
      const ws = new WebSocket(wsUrl.toString());
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as { type: string; state: EntityStateResponse };
          if (payload.type !== "state_changed") return;
          const { state } = payload;

          if (state.entity_id === config.media_player_entity) {
            setMediaState(state);
          }
          if (state.entity_id === config.doorbell_sensor_entity) {
            if (state.state === "on") {
              setDoorbellAutoCloseAt(new Date(Date.now() + 30_000));
              setDoorbellActive(true);
            } else {
              setDoorbellActive(false);
            }
          }
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        if (!stopped) reconnectTimer = window.setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [apiBaseUrl, apiKey, config]);

  const handleCommand = (cmd: MediaPlayerCommand) => {
    if (!config?.media_player_entity) return;
    client.mediaPlayerCommand(config.media_player_entity, cmd)
      .then(() => client.getEntityState(config.media_player_entity!))
      .then(setMediaState)
      .catch(() => {/* ignore */});
  };

  const handleVolumeCommit = (vol: number) => {
    if (!config?.media_player_entity) return;
    client.setMediaPlayerVolume(config.media_player_entity, vol).catch(() => {/* ignore */});
  };

  const handleSaveConfig = () => {
    setConfigSaveError(null);
    setConfigSaving(true);
    client.updateKioskConfig(configDraft)
      .then((saved) => {
        setConfig(saved);
        setConfigDraft(saved);
        setEditorOpen(false);
      })
      .catch((err) => {
        setConfigSaveError(err instanceof Error ? err.message : "Failed to save");
      })
      .finally(() => setConfigSaving(false));
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#0a0a0a] text-white">
      {/* Doorbell takeover */}
      {doorbellActive && config && (
        <DoorbellOverlay
          config={config}
          client={client}
          autoCloseAt={doorbellAutoCloseAt}
          onDismiss={() => setDoorbellActive(false)}
        />
      )}

      {/* Config editor */}
      {editorOpen && (
        <ConfigEditor
          draft={configDraft}
          onChange={setConfigDraft}
          onSave={handleSaveConfig}
          onClose={() => setEditorOpen(false)}
          saving={configSaving}
          error={configSaveError}
        />
      )}

      {/* Gear button (always visible, unobtrusive) */}
      <button
        type="button"
        onClick={() => setEditorOpen(true)}
        title="Configure kiosk"
        className="absolute top-3 right-3 z-30 text-white/10 hover:text-white/50 transition text-xl leading-none"
      >
        ⚙
      </button>

      {/* Top half: three panels */}
      <div className="h-[45vh] grid grid-cols-3 divide-x divide-white/10 min-h-0">
        <div className="p-5 overflow-hidden min-w-0">
          <WeatherPanel state={weatherState} forecast={weatherForecast} />
        </div>
        <div className="p-5 overflow-hidden min-w-0">
          <MusicPanel
            state={mediaState}
            onCommand={handleCommand}
            onVolumeCommit={handleVolumeCommit}
          />
        </div>
        <div className="p-5 overflow-hidden min-w-0">
          <CamerasPanel config={config} camTimestamp={camTimestamp} client={client} />
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-white/10 shrink-0" />

      {/* Bottom half: clock */}
      <div className="flex-1 flex flex-col items-center justify-center select-none overflow-hidden">
        <div className="font-sans font-bold leading-none text-white tabular-nums" style={{ fontSize: "16vw" }}>
          {formatTime(now)}
        </div>
        <div
          className="mt-4 font-semibold uppercase tracking-[0.35em] text-white/35"
          style={{ fontSize: "2vw" }}
        >
          {formatDate(now)}
        </div>
      </div>
    </div>
  );
}
