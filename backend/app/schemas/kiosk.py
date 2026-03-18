from pydantic import BaseModel, Field


class KioskConfig(BaseModel):
    weather_entity: str = Field(default="")
    media_player_entity: str = Field(default="")
    package_camera_entity: str = Field(default="")
    doorbell_camera_entity: str = Field(default="")
    doorbell_sensor_entity: str = Field(default="")
