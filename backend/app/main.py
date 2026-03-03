from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.orchestration import router as orchestration_router
from app.core.config import get_settings
from app.core.rate_limit import InMemoryRateLimiter
from app.schemas.configuration import MultiRoomAudioConfig
from app.schemas.lighting import LightingConfig
from app.services.config_store import JsonConfigStore, SQLiteConfigStore
from app.services.ha_client import HomeAssistantClient


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()

    app.state.ha_client = HomeAssistantClient(
        base_url=settings.ha_base_url,
        token=settings.ha_token,
    )
    app.state.rate_limiter = InMemoryRateLimiter(
        max_requests=settings.rate_limit_requests,
        window_seconds=settings.rate_limit_window_seconds,
    )
    if settings.config_store_backend == "sqlite":
        app.state.audio_config_store = SQLiteConfigStore(
            db_path=settings.sqlite_config_db_path,
            key="audio-config",
            model_cls=MultiRoomAudioConfig,
            seed_path=settings.audio_config_seed_path,
        )
        app.state.lighting_config_store = SQLiteConfigStore(
            db_path=settings.sqlite_config_db_path,
            key="lighting-config",
            model_cls=LightingConfig,
            seed_path=settings.lighting_config_seed_path,
        )
    else:
        app.state.audio_config_store = JsonConfigStore(
            settings.audio_config_path,
            model_cls=MultiRoomAudioConfig,
            seed_path=settings.audio_config_seed_path,
        )
        app.state.lighting_config_store = JsonConfigStore(
            settings.lighting_config_path,
            model_cls=LightingConfig,
            seed_path=settings.lighting_config_seed_path,
        )

    yield

    await app.state.ha_client.close()


settings = get_settings()
app = FastAPI(title="Homeplane API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_origin_regex=settings.allowed_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(orchestration_router)
