from pydantic import BaseModel, ConfigDict, Field


class ToggleLightRequest(BaseModel):
    transition_seconds: float | None = Field(default=None, ge=0, le=120)


class RunSceneRequest(BaseModel):
    transition_seconds: float | None = Field(default=None, ge=0, le=120)


class SetSwitchStateRequest(BaseModel):
    is_on: bool


class SetLightStateRequest(BaseModel):
    is_on: bool


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
