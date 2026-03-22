import { useEffect, useMemo, useRef, useState } from "react";
import { EntityStateResponse, HomeplaneClient, KioskConfig, WeatherForecastItem } from "../api/homeplaneClient";

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

// Two media player entities for the same WiiM Pro hardware:
// - Native (WiiM integration): has track info for Spotify Connect, AirPlay, etc.
// - MA (Music Assistant): has track info when MA is the source
const WIIM_NATIVE_ENTITY = "media_player.wiim_pro_24f8_5";
const WIIM_MA_ENTITY = "media_player.wiim_pro_24f8_4";

const INDOOR_SWITCHES = [
  "switch.living_room_power",
  "switch.kitchen_power",
  "switch.casa_shea_power",
  "switch.falcon_s_perch_power",
  "switch.bedroom_power",
  "switch.craftzone_power",
] as const;

function MusicPanel({
  displayState,
  albumArtUrl,
  switchStates,
  volumeState,
  pending,
  onPlayMusic,
  onStopMusic,
  onPlayEverywhere,
  onSkip,
  onPlayPause,
  onPrevious,
  onOpenRooms,
  onVolumeCommit,
}: {
  displayState: EntityStateResponse | null;
  albumArtUrl: string | undefined;
  switchStates: Map<string, string>;
  volumeState: EntityStateResponse | null;
  pending: boolean;
  onPlayMusic: () => void;
  onStopMusic: () => void;
  onPlayEverywhere: () => void;
  onSkip: () => void;
  onPlayPause: () => void;
  onPrevious: () => void;
  onOpenRooms: () => void;
  onVolumeCommit: (vol: number) => void;
}) {
  const [localVolume, setLocalVolume] = useState<number | null>(null);

  const stateVolume = volumeState ? Number(volumeState.state) : 0;
  const prevVolumeRef = useRef(stateVolume);
  useEffect(() => {
    if (stateVolume !== prevVolumeRef.current) {
      prevVolumeRef.current = stateVolume;
      setLocalVolume(null);
    }
  }, [stateVolume]);

  const displayVolume = localVolume ?? stateVolume;
  const isPlaying = displayState?.state === "playing";
  const title = displayState?.attributes.media_title as string | undefined;
  const artist = displayState?.attributes.media_artist as string | undefined;

  // Keep showing previous track info during brief transitions (e.g. skipping).
  // Times out after 5s so externally-stopped music doesn't show stale info.
  const lastTrackRef = useRef<{ title?: string; artist?: string; albumArtUrl?: string } | null>(null);
  const [transitionExpired, setTransitionExpired] = useState(false);
  if (isPlaying && title) {
    lastTrackRef.current = { title, artist, albumArtUrl };
  }
  if (displayState?.state === "paused" || displayState?.state === "off") {
    lastTrackRef.current = null;
  }
  useEffect(() => {
    if (isPlaying) {
      setTransitionExpired(false);
      return;
    }
    if (!lastTrackRef.current) return;
    const timer = window.setTimeout(() => {
      lastTrackRef.current = null;
      setTransitionExpired(true);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [isPlaying, transitionExpired]);

  const displayTrack = isPlaying && title ? { title, artist, albumArtUrl } : lastTrackRef.current;
  const showPlaying = isPlaying || (displayTrack !== null && !transitionExpired);

  const allOn = INDOOR_SWITCHES.every((id) => switchStates.get(id) === "on");
  const someOn = INDOOR_SWITCHES.some((id) => switchStates.get(id) === "on");

  // Determine button state
  let buttonLabel: string;
  let buttonIcon: string;
  let buttonAction: () => void;
  if (!showPlaying) {
    buttonLabel = "Play Music";
    buttonIcon = "play";
    buttonAction = onPlayMusic;
  } else if (!allOn) {
    buttonLabel = "Play Everywhere";
    buttonIcon = "speaker";
    buttonAction = onPlayEverywhere;
  } else {
    buttonLabel = "Stop Music";
    buttonIcon = "stop";
    buttonAction = onStopMusic;
  }

  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden relative">
      <div className="text-[10px] uppercase tracking-[0.3em] text-white/30 font-semibold">Music</div>

      {/* Transport controls — dead center of panel */}
      {showPlaying && (
        <div className="absolute inset-0 m-auto w-fit h-fit flex items-center gap-6 z-10">
          <button
            type="button"
            onClick={onPrevious}
            className="text-white/50 active:scale-90 transition-transform"
          >
            <svg width="3vw" height="3vw" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
          </button>
          <button
            type="button"
            onClick={onPlayPause}
            className="text-white active:scale-90 transition-transform"
          >
            {isPlaying ? (
              <svg width="4vw" height="4vw" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6zm8-14v14h4V5z"/></svg>
            ) : (
              <svg width="4vw" height="4vw" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="text-white/50 active:scale-90 transition-transform"
          >
            <svg width="3vw" height="3vw" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zm10 0h2V6h-2v12z"/></svg>
          </button>
        </div>
      )}

      {/* Track info */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {showPlaying && displayTrack ? (
          <div className="flex gap-3 items-start">
            {displayTrack.albumArtUrl && (
              <img
                src={displayTrack.albumArtUrl}
                alt=""
                className="w-[6vw] h-[6vw] rounded-lg object-cover shrink-0"
              />
            )}
            <div className="min-w-0">
              {displayTrack.title && (
                <div className="text-[1.5vw] font-semibold text-white leading-tight line-clamp-2">{displayTrack.title}</div>
              )}
              {displayTrack.artist && (
                <div className="text-[1vw] text-white/40 mt-1 truncate">{displayTrack.artist}</div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-[1vw] text-white/20">Idle</div>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-2">
        {/* Volume */}
        <div className={`flex items-center gap-2 ${!(isPlaying || someOn) ? "opacity-25 pointer-events-none" : ""}`}>
          <svg className="text-white/20 shrink-0" width="0.9vw" height="0.9vw" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={displayVolume}
            onChange={(e) => setLocalVolume(Number(e.target.value))}
            onPointerUp={(e) => {
              const vol = Number((e.target as HTMLInputElement).value);
              setLocalVolume(null);
              onVolumeCommit(vol);
            }}
            disabled={!(isPlaying || someOn)}
            className="volume-slider flex-1"
          />
          <span className="text-[0.8vw] text-white/25 tabular-nums w-8 text-right">
              {Math.round(displayVolume)}
            </span>
        </div>

        <div className="h-2" />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={buttonAction}
            disabled={pending}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg transition text-[1.1vw] font-semibold ${
              pending
                ? "bg-white/5 text-white/30 cursor-wait"
                : showPlaying
                  ? "bg-white/10 text-white/70 hover:bg-white/15"
                  : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            {pending ? (
              <svg className="animate-spin" width="1.4vw" height="1.4vw" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>
            ) : buttonIcon === "play" ? (
              <svg width="1.4vw" height="1.4vw" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            ) : buttonIcon === "stop" ? (
              <svg width="1.4vw" height="1.4vw" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
            ) : (
              <svg width="1.4vw" height="1.4vw" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
            )}
            {pending ? "Starting\u2026" : buttonLabel}
          </button>
          <button
            type="button"
            onClick={onOpenRooms}
            className="px-2 rounded-lg bg-white/5 text-white/30 active:bg-white/10 transition flex items-center"
            title="Room controls"
          >
            <svg width="1.2vw" height="1.2vw" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
          </button>
        </div>

        {/* Stop button when playing everywhere (so user can still stop) */}
        {showPlaying && !allOn && (
          <button
            type="button"
            onClick={onStopMusic}
            className="flex items-center justify-center gap-2 py-1.5 rounded-lg transition text-[0.9vw] font-medium bg-white/5 text-white/40 hover:bg-white/10"
          >
            <svg width="0.9vw" height="0.9vw" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg> Stop Music
          </button>
        )}
      </div>
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
  const [videoFailed, setVideoFailed] = useState(false);
  const [snapshotTs, setSnapshotTs] = useState(Date.now());
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  const camEntity = config.doorbell_camera_entity;

  // Countdown + auto-dismiss
  useEffect(() => {
    const id = setInterval(() => {
      const remaining = Math.max(0, Math.round((autoCloseAt.getTime() - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) onDismiss();
    }, 500);
    return () => clearInterval(id);
  }, [autoCloseAt, onDismiss]);

  // go2rtc WebRTC via Caddy
  useEffect(() => {
    if (!camEntity || !videoRef.current) return;
    let cancelled = false;

    const startWebRTC = async () => {
      try {
        const pc = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });
        pcRef.current = pc;

        pc.addTransceiver("video", { direction: "recvonly" });
        pc.addTransceiver("audio", { direction: "recvonly" });

        pc.ontrack = (event) => {
          if (videoRef.current && event.streams[0]) {
            videoRef.current.srcObject = event.streams[0];
            videoRef.current.play().catch(() => {});
          }
        };
        pc.oniceconnectionstatechange = () => {
          const s = pc.iceConnectionState;
          if (s === "failed" || s === "disconnected" || s === "closed") {
            if (!cancelled) setVideoFailed(true);
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // Wait for ICE gathering to complete (with timeout)
        if (pc.iceGatheringState !== "complete") {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 3000);
            const check = () => {
              if (pc.iceGatheringState === "complete") {
                clearTimeout(timer);
                resolve();
              }
            };
            pc.addEventListener("icegatheringstatechange", check);
            check();
          });
        }

        const resp = await fetch(`/go2rtc/api/webrtc?src=doorbell`, {
          method: "POST",
          body: pc.localDescription!.sdp,
        });
        if (!resp.ok) throw new Error(`go2rtc returned ${resp.status}`);
        const answerSdp = await resp.text();

        if (cancelled) { pc.close(); return; }

        await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
      } catch {
        if (!cancelled) setVideoFailed(true);
      }
    };

    startWebRTC();
    return () => {
      cancelled = true;
      pcRef.current?.close();
      pcRef.current = null;
    };
  }, [camEntity]);

  // Fallback snapshot refresh (every 1s) when WebRTC fails
  useEffect(() => {
    if (!videoFailed) return;
    const id = setInterval(() => setSnapshotTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [videoFailed]);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <svg className="animate-pulse" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
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
        ) : videoFailed ? (
          <img
            key={snapshotTs}
            src={`${client.getCameraSnapshotUrl(camEntity)}&t=${snapshotTs}`}
            alt="Doorbell"
            className="max-w-full max-h-full object-contain"
          />
        ) : (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="max-w-full max-h-full object-contain"
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
  const [wiimNativeState, setWiimNativeState] = useState<EntityStateResponse | null>(null);
  const [wiimMaState, setWiimMaState] = useState<EntityStateResponse | null>(null);
  const [indoorSwitchStates, setIndoorSwitchStates] = useState<Map<string, string>>(new Map());
  const indoorSwitchStatesRef = useRef(indoorSwitchStates);
  indoorSwitchStatesRef.current = indoorSwitchStates;
  const [musicPending, setMusicPending] = useState(false);
  const retryTimerRef = useRef<number | null>(null);
  const [indoorVolumeState, setIndoorVolumeState] = useState<EntityStateResponse | null>(null);
  const [doorbellActive, setDoorbellActive] = useState(false);
  const [doorbellAutoCloseAt, setDoorbellAutoCloseAt] = useState(new Date());
  const [camTimestamp, setCamTimestamp] = useState(Date.now());
  const [editorOpen, setEditorOpen] = useState(false);
  const [configDraft, setConfigDraft] = useState<KioskConfig>(EMPTY_CONFIG);
  const [configSaving, setConfigSaving] = useState(false);
  const [roomsOpen, setRoomsOpen] = useState(false);
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

  // Fetch both WiiM entity states (every 30s, also refreshed via WS)
  useEffect(() => {
    let cancelled = false;
    const fetchBoth = () => {
      client.getEntityState(WIIM_NATIVE_ENTITY)
        .then((s) => { if (!cancelled) setWiimNativeState(s); })
        .catch(() => {});
      client.getEntityState(WIIM_MA_ENTITY)
        .then((s) => { if (!cancelled) setWiimMaState(s); })
        .catch(() => {});
    };
    fetchBoth();
    const id = setInterval(fetchBoth, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [client]);

  // Fetch indoor switch + volume states on mount
  useEffect(() => {
    Promise.all(INDOOR_SWITCHES.map((id) => client.getEntityState(id).catch(() => null)))
      .then((states) => {
        const map = new Map<string, string>();
        for (const s of states) {
          if (s) map.set(s.entity_id, s.state);
        }
        setIndoorSwitchStates(map);
      });
    client.getEntityState("input_number.indoor_volume")
      .then(setIndoorVolumeState).catch(() => {});
  }, [client]);

  // WebSocket: real-time media player + doorbell sensor + indoor speaker/volume updates
  useEffect(() => {
    if (!config) return;
    const ids = [
      WIIM_NATIVE_ENTITY,
      WIIM_MA_ENTITY,
      config.weather_entity,
      config.doorbell_sensor_entity,
      "input_number.indoor_volume",
      ...INDOOR_SWITCHES,
    ].filter(Boolean);
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

          if (state.entity_id === WIIM_NATIVE_ENTITY) {
            setWiimNativeState(state);
          }
          if (state.entity_id === WIIM_MA_ENTITY) {
            setWiimMaState(state);
          }
          if (state.entity_id === config.weather_entity) {
            setWeatherState(state);
          }
          if ((INDOOR_SWITCHES as readonly string[]).includes(state.entity_id)) {
            setIndoorSwitchStates((prev) => new Map(prev).set(state.entity_id, state.state));
          }
          if (state.entity_id === "input_number.indoor_volume") {
            setIndoorVolumeState(state);
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

  // Clear pending state as soon as all speakers are on
  useEffect(() => {
    if (musicPending && INDOOR_SWITCHES.every((id) => indoorSwitchStates.get(id) === "on")) {
      setMusicPending(false);
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    }
  }, [musicPending, indoorSwitchStates]);

  const ensureSpeakersOn = (attemptsLeft: number) => {
    if (attemptsLeft <= 0) {
      setMusicPending(false);
      return;
    }
    retryTimerRef.current = window.setTimeout(() => {
      const current = indoorSwitchStatesRef.current;
      const offSwitches = INDOOR_SWITCHES.filter((id) => current.get(id) !== "on");
      if (offSwitches.length === 0) {
        setMusicPending(false);
        return;
      }
      for (const id of offSwitches) {
        client.setSwitchState(id, { is_on: true }).catch(() => {});
      }
      ensureSpeakersOn(attemptsLeft - 1);
    }, 3000);
  };

  // Pick the entity that has real track info — MA when it's the source, native otherwise
  const maHasTrack = wiimMaState?.state === "playing" && !!(wiimMaState.attributes.media_title as string | undefined);
  const activeMediaState = maHasTrack ? wiimMaState : wiimNativeState;
  const activeMediaEntity = maHasTrack ? WIIM_MA_ENTITY : WIIM_NATIVE_ENTITY;

  // Resolve album art — HA local proxy paths need to go through our backend
  const rawPicture = activeMediaState?.attributes.entity_picture as string | undefined;
  const activeAlbumArtUrl = rawPicture
    ? rawPicture.startsWith("/api/")
      ? client.getMediaPlayerImageUrl(activeMediaState!.entity_id)
      : rawPicture
    : undefined;

  const handlePlayMusic = () => {
    setMusicPending(true);
    client.runScript("script.play_music").catch(() => {});
    ensureSpeakersOn(3);
  };

  const handleStopMusic = () => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setMusicPending(false);
    client.runScript("script.stop_music_indoor").catch(() => {});
  };

  const handleSkip = () => {
    client.mediaPlayerCommand(activeMediaEntity, "next_track").catch(() => {});
  };

  const handlePlayPause = () => {
    client.mediaPlayerCommand(activeMediaEntity, "play_pause").catch(() => {});
  };

  const handlePrevious = () => {
    client.mediaPlayerCommand(activeMediaEntity, "previous_track").catch(() => {});
  };

  const handlePlayEverywhere = () => {
    setMusicPending(true);
    client.runScript("script.indoor_speakers_on").catch(() => {});
    ensureSpeakersOn(3);
  };

  const handleVolumeCommit = (vol: number) => {
    client.setInputNumberValue("input_number.indoor_volume", vol).catch(() => {});
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

      {/* Rooms modal (multi-room audio page in iframe) */}
      {roomsOpen && (
        <div className="fixed inset-0 z-40 flex flex-col bg-black">
          <div className="flex items-center justify-between px-6 py-3 border-b border-white/10 shrink-0">
            <span className="text-[1.4vw] font-bold text-white uppercase tracking-[0.3em]">Room Controls</span>
            <button
              type="button"
              onClick={() => setRoomsOpen(false)}
              className="rounded-xl border border-white/20 px-5 py-2 text-[1vw] font-semibold text-white/70 active:bg-white/10 transition"
            >
              Close
            </button>
          </div>
          <iframe
            src="/dashboards/audio"
            className="flex-1 w-full border-none bg-[#050505]"
            title="Room Controls"
            style={{ colorScheme: "dark" }}
          />
        </div>
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
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>

      {/* Top half: three panels */}
      <div className="h-[45vh] grid grid-cols-3 divide-x divide-white/10 min-h-0">
        <div className="p-5 overflow-hidden min-w-0">
          <WeatherPanel state={weatherState} forecast={weatherForecast} />
        </div>
        <div className="p-5 overflow-hidden min-w-0">
          <MusicPanel
            displayState={activeMediaState}
            albumArtUrl={activeAlbumArtUrl}
            switchStates={indoorSwitchStates}
            volumeState={indoorVolumeState}
            pending={musicPending}
            onPlayMusic={handlePlayMusic}
            onStopMusic={handleStopMusic}
            onPlayEverywhere={handlePlayEverywhere}
            onSkip={handleSkip}
            onPlayPause={handlePlayPause}
            onPrevious={handlePrevious}
            onOpenRooms={() => setRoomsOpen(true)}
            onVolumeCommit={handleVolumeCommit}
          />
        </div>
        <div className="p-5 overflow-hidden min-w-0">
          {doorbellActive
            ? <div className="h-full flex items-center justify-center text-white/10 text-sm">Live view active</div>
            : <CamerasPanel config={config} camTimestamp={camTimestamp} client={client} />
          }
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
