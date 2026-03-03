import re

from pydantic import BaseModel, Field, model_validator

ENTITY_ID_PATTERN = re.compile(r"^[a-z0-9_]+\.[a-zA-Z0-9_]+$")


def validate_entity_id(entity_id: str) -> str:
    if not ENTITY_ID_PATTERN.match(entity_id):
        raise ValueError("Invalid entity_id format")
    return entity_id


class LightingEntityConfig(BaseModel):
    entity_id: str = Field(min_length=3, max_length=120)
    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    icon: str | None = Field(default=None, min_length=3, max_length=80)
    update_timeout_seconds: float | None = Field(default=None, ge=1, le=30)

    @model_validator(mode="after")
    def validate_entity(self) -> "LightingEntityConfig":
        validate_entity_id(self.entity_id)
        if not self.entity_id.startswith("light."):
            raise ValueError("lighting entities must start with 'light.'")
        return self


class RoomLightingConfig(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    lights: list[LightingEntityConfig | str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_lights(self) -> "RoomLightingConfig":
        for light in self.lights:
            entity_id = light if isinstance(light, str) else light.entity_id
            validate_entity_id(entity_id)
            if not entity_id.startswith("light."):
                raise ValueError("lighting entities must start with 'light.'")
        return self


class LightingConfig(BaseModel):
    rooms: list[RoomLightingConfig] = Field(default_factory=list)
