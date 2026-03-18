from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ToggleLightRequest(BaseModel):
    transition_seconds: float | None = Field(default=None, ge=0, le=120)


class RunSceneRequest(BaseModel):
    transition_seconds: float | None = Field(default=None, ge=0, le=120)


class SetSwitchStateRequest(BaseModel):
    is_on: bool


class SetLightStateRequest(BaseModel):
    is_on: bool
    brightness_pct: float | None = Field(default=None, ge=0, le=100)


class SetNumberValueRequest(BaseModel):
    value: float


class HomeAssistantServiceResult(BaseModel):
    model_config = ConfigDict(extra="allow")


class EntityStateResponse(BaseModel):
    entity_id: str
    state: str
    attributes: dict[str, object] = Field(default_factory=dict)
    last_changed: str | None = None
    last_updated: str | None = None


class SetGpioPinStateRequest(BaseModel):
    state: bool
    duration_ms: float | None = Field(default=None, gt=0, le=3_600_000)


class GpioPinStateResponse(BaseModel):
    pin: int
    state: bool


class MediaPlayerCommandRequest(BaseModel):
    command: Literal["play_pause", "next_track", "previous_track"]


class MediaPlayerVolumeRequest(BaseModel):
    volume: float = Field(ge=0.0, le=1.0)
