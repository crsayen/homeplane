export interface EntityStateResponse {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string | null;
  last_updated: string | null;
}

export interface ToggleLightRequest {
  transition_seconds?: number;
}

export interface ActivateSceneRequest {
  transition_seconds?: number;
}

export interface SetSwitchStateRequest {
  is_on: boolean;
}

export interface SetNumberValueRequest {
  value: number;
}

export interface SetLightStateRequest {
  is_on: boolean;
  brightness_pct?: number;
}

export interface RoomAudioConfig {
  name: string;
  switch: string;
  number: string;
}

export interface MultiRoomAudioConfig {
  rooms: RoomAudioConfig[];
}

export interface RoomLightingConfig {
  name: string;
  lights: Array<string | LightingEntityConfig>;
}

export interface LightingEntityConfig {
  entity_id: string;
  display_name?: string;
  icon?: string;
  update_timeout_seconds?: number;
  dimmable?: boolean;
}

export interface LightingConfig {
  rooms: RoomLightingConfig[];
}

export interface KioskConfig {
  weather_entity: string;
  media_player_entity: string;
  package_camera_entity: string;
  doorbell_camera_entity: string;
  doorbell_sensor_entity: string;
}

export interface WeatherForecastItem {
  datetime: string;
  condition: string;
  temperature: number;
  templow?: number;
}

export type MediaPlayerCommand = "play_pause" | "next_track" | "previous_track";

export class HomeplaneClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  async toggleLight(entityId: string, payload: ToggleLightRequest = {}): Promise<unknown[]> {
    return this.request<unknown[]>(`/api/lights/${entityId}/toggle`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async activateScene(entityId: string, payload: ActivateSceneRequest = {}): Promise<unknown[]> {
    return this.request<unknown[]>(`/api/scenes/${entityId}/activate`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getEntityState(entityId: string): Promise<EntityStateResponse> {
    return this.request<EntityStateResponse>(`/api/entities/${entityId}/state`, {
      method: "GET",
    });
  }

  async setSwitchState(entityId: string, payload: SetSwitchStateRequest): Promise<unknown[]> {
    return this.request<unknown[]>(`/api/switches/${entityId}/state`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async setNumberValue(entityId: string, payload: SetNumberValueRequest): Promise<unknown[]> {
    return this.request<unknown[]>(`/api/numbers/${entityId}/value`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async setLightState(entityId: string, payload: SetLightStateRequest): Promise<unknown[]> {
    return this.request<unknown[]>(`/api/lights/${entityId}/state`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getAudioConfig(): Promise<MultiRoomAudioConfig> {
    return this.request<MultiRoomAudioConfig>("/api/audio-config", { method: "GET" });
  }

  async updateAudioConfig(payload: MultiRoomAudioConfig): Promise<MultiRoomAudioConfig> {
    return this.request<MultiRoomAudioConfig>("/api/audio-config", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  async getLightingConfig(): Promise<LightingConfig> {
    return this.request<LightingConfig>("/api/lighting-config", { method: "GET" });
  }

  async updateLightingConfig(payload: LightingConfig): Promise<LightingConfig> {
    return this.request<LightingConfig>("/api/lighting-config", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  async getKioskConfig(): Promise<KioskConfig> {
    return this.request<KioskConfig>("/api/kiosk-config", { method: "GET" });
  }

  async updateKioskConfig(payload: KioskConfig): Promise<KioskConfig> {
    return this.request<KioskConfig>("/api/kiosk-config", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  async mediaPlayerCommand(entityId: string, command: MediaPlayerCommand): Promise<unknown[]> {
    return this.request<unknown[]>(`/api/media-player/${entityId}/command`, {
      method: "POST",
      body: JSON.stringify({ command }),
    });
  }

  async setMediaPlayerVolume(entityId: string, volume: number): Promise<unknown[]> {
    return this.request<unknown[]>(`/api/media-player/${entityId}/volume`, {
      method: "POST",
      body: JSON.stringify({ volume }),
    });
  }

  async getWeatherForecast(entityId: string): Promise<WeatherForecastItem[]> {
    return this.request<WeatherForecastItem[]>(`/api/weather/${encodeURIComponent(entityId)}/forecast`, {
      method: "GET",
    });
  }

  getCameraSnapshotUrl(entityId: string): string {
    return `${this.baseUrl}/api/camera/${encodeURIComponent(entityId)}/snapshot?api_key=${encodeURIComponent(this.apiKey)}`;
  }

  getCameraStreamUrl(entityId: string): string {
    return `${this.baseUrl}/api/camera/${encodeURIComponent(entityId)}/stream?api_key=${encodeURIComponent(this.apiKey)}`;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "x-homeplane-key": this.apiKey,
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Homeplane request failed (${response.status}): ${body || response.statusText}`);
    }

    return (await response.json()) as T;
  }
}

// Example usage in React:
// const client = new HomeplaneClient(import.meta.env.VITE_HOMEPLANE_API_URL, import.meta.env.VITE_HOMEPLANE_API_KEY);
// await client.toggleLight("light.kitchen");
