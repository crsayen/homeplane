import re
from collections.abc import AsyncIterator
from logging import getLogger

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from fastapi.responses import Response, StreamingResponse

from app.api.deps import get_orchestrator
from app.core.config import get_settings
from app.core.security import require_api_key, require_api_key_or_query
from app.core.security import validate_api_key_value
from app.schemas.actions import (
    EntityStateResponse,
    GpioPinStateResponse,
    HomeAssistantServiceResult,
    MediaPlayerCommandRequest,
    MediaPlayerVolumeRequest,
    RunSceneRequest,
    SetGpioPinStateRequest,
    SetLightStateRequest,
    SetNumberValueRequest,
    SetSwitchStateRequest,
    ToggleLightRequest,
)
from app.services.gpio_service import VALID_BCM_PINS, GPIOService
from app.schemas.configuration import MultiRoomAudioConfig
from app.schemas.kiosk import KioskConfig
from app.schemas.lighting import LightingConfig
from app.services.ha_client import HomeAssistantClient
from app.services.orchestrator import HomeOrchestrator

router = APIRouter(prefix="/api", tags=["orchestration"])
ENTITY_ID_PATTERN = re.compile(r"^[a-z0-9_]+\.[a-zA-Z0-9_]+$")
logger = getLogger(__name__)


def validate_gpio_pin(pin: int) -> int:
    if pin not in VALID_BCM_PINS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Invalid BCM GPIO pin: {pin}. Must be in range 2–27.",
        )
    return pin


def validate_entity_id(entity_id: str) -> str:
    if not ENTITY_ID_PATTERN.match(entity_id):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Invalid entity_id format",
        )
    return entity_id


def validate_entity_domain(entity_id: str, expected_domain: str) -> None:
    validate_entity_id(entity_id)
    if not entity_id.startswith(f"{expected_domain}."):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"entity_id must start with '{expected_domain}.'",
        )


@router.get("/health", dependencies=[Depends(require_api_key)])
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/audio-config", response_model=MultiRoomAudioConfig, dependencies=[Depends(require_api_key)])
async def get_audio_config(request: Request) -> MultiRoomAudioConfig:
    await request.app.state.rate_limiter.check(request)
    return await request.app.state.audio_config_store.load()


@router.put("/audio-config", response_model=MultiRoomAudioConfig, dependencies=[Depends(require_api_key)])
async def update_audio_config(request: Request, payload: MultiRoomAudioConfig) -> MultiRoomAudioConfig:
    await request.app.state.rate_limiter.check(request)
    return await request.app.state.audio_config_store.save(payload)


@router.get("/lighting-config", response_model=LightingConfig, dependencies=[Depends(require_api_key)])
async def get_lighting_config(request: Request) -> LightingConfig:
    await request.app.state.rate_limiter.check(request)
    return await request.app.state.lighting_config_store.load()


@router.put("/lighting-config", response_model=LightingConfig, dependencies=[Depends(require_api_key)])
async def update_lighting_config(request: Request, payload: LightingConfig) -> LightingConfig:
    await request.app.state.rate_limiter.check(request)
    return await request.app.state.lighting_config_store.save(payload)


@router.post(
    "/lights/{entity_id}/toggle",
    response_model=list[HomeAssistantServiceResult],
    dependencies=[Depends(require_api_key)],
)
async def toggle_light(
    entity_id: str,
    payload: ToggleLightRequest,
    request: Request,
    orchestrator: HomeOrchestrator = Depends(get_orchestrator),
) -> list[HomeAssistantServiceResult]:
    validate_entity_id(entity_id)
    await request.app.state.rate_limiter.check(request)
    return await orchestrator.toggle_light(entity_id=entity_id, transition_seconds=payload.transition_seconds)


@router.post(
    "/lights/{entity_id}/state",
    response_model=list[HomeAssistantServiceResult],
    dependencies=[Depends(require_api_key)],
)
async def set_light_state(
    entity_id: str,
    payload: SetLightStateRequest,
    request: Request,
    orchestrator: HomeOrchestrator = Depends(get_orchestrator),
) -> list[HomeAssistantServiceResult]:
    validate_entity_domain(entity_id, "light")
    await request.app.state.rate_limiter.check(request)
    return await orchestrator.set_light_state(
        entity_id=entity_id,
        is_on=payload.is_on,
        brightness_pct=payload.brightness_pct,
    )


@router.post(
    "/scenes/{entity_id}/activate",
    response_model=list[HomeAssistantServiceResult],
    dependencies=[Depends(require_api_key)],
)
async def activate_scene(
    entity_id: str,
    payload: RunSceneRequest,
    request: Request,
    orchestrator: HomeOrchestrator = Depends(get_orchestrator),
) -> list[HomeAssistantServiceResult]:
    validate_entity_id(entity_id)
    await request.app.state.rate_limiter.check(request)
    return await orchestrator.run_scene(entity_id=entity_id, transition_seconds=payload.transition_seconds)


@router.get(
    "/entities/{entity_id}/state",
    response_model=EntityStateResponse,
    dependencies=[Depends(require_api_key)],
)
async def get_entity_state(
    entity_id: str,
    request: Request,
    orchestrator: HomeOrchestrator = Depends(get_orchestrator),
) -> EntityStateResponse:
    validate_entity_id(entity_id)
    await request.app.state.rate_limiter.check(request)
    return await orchestrator.get_entity_state(entity_id=entity_id)


@router.post(
    "/switches/{entity_id}/state",
    response_model=list[HomeAssistantServiceResult],
    dependencies=[Depends(require_api_key)],
)
async def set_switch_state(
    entity_id: str,
    payload: SetSwitchStateRequest,
    request: Request,
    orchestrator: HomeOrchestrator = Depends(get_orchestrator),
) -> list[HomeAssistantServiceResult]:
    validate_entity_domain(entity_id, "switch")
    await request.app.state.rate_limiter.check(request)
    return await orchestrator.set_switch_state(entity_id=entity_id, is_on=payload.is_on)


@router.post(
    "/numbers/{entity_id}/value",
    response_model=list[HomeAssistantServiceResult],
    dependencies=[Depends(require_api_key)],
)
async def set_number_value(
    entity_id: str,
    payload: SetNumberValueRequest,
    request: Request,
    orchestrator: HomeOrchestrator = Depends(get_orchestrator),
) -> list[HomeAssistantServiceResult]:
    validate_entity_domain(entity_id, "number")
    await request.app.state.rate_limiter.check(request)
    return await orchestrator.set_number_value(entity_id=entity_id, value=payload.value)


@router.post(
    "/gpio/{pin}/state",
    response_model=GpioPinStateResponse,
    dependencies=[Depends(require_api_key)],
)
async def set_gpio_pin_state(
    pin: int,
    payload: SetGpioPinStateRequest,
    request: Request,
) -> GpioPinStateResponse:
    validate_gpio_pin(pin)
    await request.app.state.rate_limiter.check(request)
    gpio: GPIOService = request.app.state.gpio_service
    if payload.duration_ms is not None:
        await gpio.set_pin_timed(pin, payload.state, payload.duration_ms)
    else:
        gpio.set_pin(pin, payload.state)
    return GpioPinStateResponse(pin=pin, state=payload.state)


@router.get(
    "/gpio/{pin}/state",
    response_model=GpioPinStateResponse,
    dependencies=[Depends(require_api_key)],
)
async def get_gpio_pin_state(
    pin: int,
    request: Request,
) -> GpioPinStateResponse:
    validate_gpio_pin(pin)
    await request.app.state.rate_limiter.check(request)
    gpio: GPIOService = request.app.state.gpio_service
    return GpioPinStateResponse(pin=pin, state=gpio.read_pin(pin))


@router.get("/kiosk-config", response_model=KioskConfig, dependencies=[Depends(require_api_key)])
async def get_kiosk_config(request: Request) -> KioskConfig:
    await request.app.state.rate_limiter.check(request)
    return await request.app.state.kiosk_config_store.load()


@router.put("/kiosk-config", response_model=KioskConfig, dependencies=[Depends(require_api_key)])
async def update_kiosk_config(request: Request, payload: KioskConfig) -> KioskConfig:
    await request.app.state.rate_limiter.check(request)
    return await request.app.state.kiosk_config_store.save(payload)


@router.get("/camera/{entity_id}/snapshot", dependencies=[Depends(require_api_key_or_query)])
async def get_camera_snapshot(entity_id: str, request: Request) -> Response:
    validate_entity_domain(entity_id, "camera")
    await request.app.state.rate_limiter.check(request)
    ha_client: HomeAssistantClient = request.app.state.ha_client
    image_bytes, content_type = await ha_client.get_camera_snapshot(entity_id)
    return Response(
        content=image_bytes,
        media_type=content_type,
        headers={"Cache-Control": "no-cache, no-store"},
    )


@router.get("/camera/{entity_id}/stream", dependencies=[Depends(require_api_key_or_query)])
async def stream_camera(entity_id: str, request: Request) -> StreamingResponse:
    validate_entity_domain(entity_id, "camera")
    ha_client: HomeAssistantClient = request.app.state.ha_client

    async def generate() -> AsyncIterator[bytes]:
        async for chunk in ha_client.iter_camera_stream(entity_id):
            yield chunk

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=--myboundary",
        headers={"Cache-Control": "no-cache"},
    )


@router.post(
    "/media-player/{entity_id}/command",
    response_model=list[HomeAssistantServiceResult],
    dependencies=[Depends(require_api_key)],
)
async def media_player_command(
    entity_id: str,
    payload: MediaPlayerCommandRequest,
    request: Request,
    orchestrator: HomeOrchestrator = Depends(get_orchestrator),
) -> list[HomeAssistantServiceResult]:
    validate_entity_domain(entity_id, "media_player")
    await request.app.state.rate_limiter.check(request)
    return await orchestrator.media_player_command(entity_id, payload.command)


@router.post(
    "/media-player/{entity_id}/volume",
    response_model=list[HomeAssistantServiceResult],
    dependencies=[Depends(require_api_key)],
)
async def set_media_player_volume(
    entity_id: str,
    payload: MediaPlayerVolumeRequest,
    request: Request,
    orchestrator: HomeOrchestrator = Depends(get_orchestrator),
) -> list[HomeAssistantServiceResult]:
    validate_entity_domain(entity_id, "media_player")
    await request.app.state.rate_limiter.check(request)
    return await orchestrator.set_media_player_volume(entity_id, payload.volume)


@router.websocket("/ws/entities")
async def stream_entities(websocket: WebSocket) -> None:
    settings = get_settings()
    api_key = websocket.query_params.get("api_key")
    try:
        validate_api_key_value(api_key, settings)
    except HTTPException:
        await websocket.close(code=1008, reason="Invalid or missing API key")
        return

    entities_param = websocket.query_params.get("entity_ids", "")
    entity_ids = {entity.strip() for entity in entities_param.split(",") if entity.strip()}
    if not entity_ids:
        await websocket.close(code=1008, reason="At least one entity_id is required")
        return

    try:
        for entity_id in entity_ids:
            validate_entity_id(entity_id)
    except HTTPException:
        await websocket.close(code=1008, reason="Invalid entity_id format")
        return

    await websocket.accept()
    orchestrator = HomeOrchestrator(websocket.app.state.ha_client)
    try:
        async for state in orchestrator.stream_entity_states(entity_ids):
            await websocket.send_json({"type": "state_changed", "state": state.model_dump()})
    except WebSocketDisconnect:
        return
    except Exception as exc:
        logger.exception("Websocket entity stream failed: %s", exc)
        try:
            await websocket.send_json({"type": "stream_error", "detail": str(exc)})
        except Exception:
            pass
        await websocket.close(code=1011, reason="Entity stream failure")
