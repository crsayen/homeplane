from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", case_sensitive=False)

    ha_base_url: str = Field(..., alias="HA_BASE_URL")
    ha_token: str = Field(..., alias="HA_TOKEN")

    app_api_key: str = Field(..., alias="APP_API_KEY")

    allowed_origins: Annotated[list[str], NoDecode] = Field(default_factory=list, alias="ALLOWED_ORIGINS")
    allowed_origin_regex: str | None = Field(
        default=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
        alias="ALLOWED_ORIGIN_REGEX",
    )

    rate_limit_requests: int = Field(default=60, alias="RATE_LIMIT_REQUESTS")
    rate_limit_window_seconds: int = Field(default=60, alias="RATE_LIMIT_WINDOW_SECONDS")
    audio_config_path: str = Field(default="./data/multi-room-audio.config.json", alias="AUDIO_CONFIG_PATH")
    audio_config_seed_path: str = Field(
        default="./data/multi-room-audio.config.json",
        alias="AUDIO_CONFIG_SEED_PATH",
    )

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def parse_allowed_origins(cls, value: str | list[str] | None) -> list[str]:
        if value is None:
            return []
        if isinstance(value, list):
            return [cls._normalize_origin(origin) for origin in value if origin and cls._normalize_origin(origin)]
        return [cls._normalize_origin(origin) for origin in value.split(",") if cls._normalize_origin(origin)]

    @staticmethod
    def _normalize_origin(origin: str) -> str:
        normalized = origin.strip().strip("\"'").rstrip("/")
        return normalized


@lru_cache
def get_settings() -> Settings:
    return Settings()
