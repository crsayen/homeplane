from collections.abc import AsyncIterator

from app.schemas.actions import EntityStateResponse, HomeAssistantServiceResult
from app.services.ha_client import HomeAssistantClient


class HomeOrchestrator:
    def __init__(self, ha_client: HomeAssistantClient) -> None:
        self._ha_client = ha_client

    async def toggle_light(self, entity_id: str, transition_seconds: float | None) -> list[HomeAssistantServiceResult]:
        payload: dict[str, object] = {"entity_id": entity_id}
        if transition_seconds is not None:
            payload["transition"] = transition_seconds

        result = await self._ha_client.call_service("light", "toggle", payload)
        return [HomeAssistantServiceResult.model_validate(item) for item in result]

    async def run_scene(self, entity_id: str, transition_seconds: float | None) -> list[HomeAssistantServiceResult]:
        payload: dict[str, object] = {"entity_id": entity_id}
        if transition_seconds is not None:
            payload["transition"] = transition_seconds

        result = await self._ha_client.call_service("scene", "turn_on", payload)
        return [HomeAssistantServiceResult.model_validate(item) for item in result]

    async def get_entity_state(self, entity_id: str) -> EntityStateResponse:
        state = await self._ha_client.get_state(entity_id)
        return EntityStateResponse(
            entity_id=state["entity_id"],
            state=state["state"],
            attributes=state.get("attributes", {}),
            last_changed=state.get("last_changed"),
            last_updated=state.get("last_updated"),
        )

    async def set_switch_state(self, entity_id: str, is_on: bool) -> list[HomeAssistantServiceResult]:
        payload: dict[str, object] = {"entity_id": entity_id}
        service = "turn_on" if is_on else "turn_off"
        result = await self._ha_client.call_service("switch", service, payload)
        return [HomeAssistantServiceResult.model_validate(item) for item in result]

    async def set_number_value(self, entity_id: str, value: float) -> list[HomeAssistantServiceResult]:
        payload: dict[str, object] = {"entity_id": entity_id, "value": value}
        result = await self._ha_client.call_service("number", "set_value", payload)
        return [HomeAssistantServiceResult.model_validate(item) for item in result]

    async def stream_entity_states(self, entity_ids: set[str]) -> AsyncIterator[EntityStateResponse]:
        async for state in self._ha_client.iter_state_changes(entity_ids):
            yield EntityStateResponse(
                entity_id=state["entity_id"],
                state=state["state"],
                attributes=state.get("attributes", {}),
                last_changed=state.get("last_changed"),
                last_updated=state.get("last_updated"),
            )
