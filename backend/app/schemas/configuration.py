from pydantic import BaseModel, Field


class RoomAudioConfig(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    switch: str = Field(min_length=3, max_length=128)
    number: str = Field(min_length=3, max_length=128)


class MultiRoomAudioConfig(BaseModel):
    rooms: list[RoomAudioConfig] = Field(default_factory=list)
