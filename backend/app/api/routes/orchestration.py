import re
from logging import getLogger

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect, status

from app.api.deps import get_orchestrator
from app.core.config import get_settings
from app.core.security import require_api_key
from app.core.security import validate_api_key_value
from app.schemas.actions import (
    EntityStateResponse,
    HomeAssistantServiceResult,
    RunSceneRequest,
    SetNumberValueRequest,
    SetSwitchStateRequest,
    ToggleLightRequest,
)
from app.schemas.configuration import MultiRoomAudioConfig
from app.services.orchestrator import HomeOrchestrator

router = APIRouter(prefix="/api", tags=["orchestration"])
ENTITY_ID_PATTERN = re.compile(r"^[a-z0-9_]+\.[a-zA-Z0-9_]+$")
logger = getLogger(__name__)


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
