from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import urlparse

import httpx
import websockets
from fastapi import HTTPException, status


class HomeAssistantClient:
    def __init__(self, base_url: str, token: str, timeout_seconds: float = 10.0) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            timeout=timeout_seconds,
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def get_state(self, entity_id: str) -> dict[str, Any]:
        response = await self._client.get(f"/api/states/{entity_id}")

        if response.status_code == status.HTTP_404_NOT_FOUND:
            raise HTTPException(status_code=404, detail=f"Entity not found: {entity_id}")

        self._raise_on_error(response, "Failed to fetch entity state")
        return response.json()

    async def call_service(self, domain: str, service: str, data: dict[str, Any]) -> list[dict[str, Any]]:
        response = await self._client.post(f"/api/services/{domain}/{service}", json=data)
        self._raise_on_error(response, f"Failed to call service {domain}.{service}")

        payload = response.json()
        return payload if isinstance(payload, list) else [payload]

    async def iter_state_changes(self, entity_ids: set[str]) -> AsyncIterator[dict[str, Any]]:
        if not entity_ids:
            return

        subscribe_id = 1
        ws_url = self._build_ws_url()
        async with websockets.connect(ws_url, max_size=2**20) as websocket:
            auth_required = json.loads(await websocket.recv())
            if auth_required.get("type") != "auth_required":
                raise HTTPException(status_code=502, detail="Unexpected Home Assistant websocket auth handshake")

            await websocket.send(json.dumps({"type": "auth", "access_token": self._client.headers["Authorization"].split(" ", 1)[1]}))
            auth_result = json.loads(await websocket.recv())
            if auth_result.get("type") != "auth_ok":
                raise HTTPException(status_code=502, detail="Home Assistant websocket auth failed")

            await websocket.send(
                json.dumps(
                    {
                        "id": subscribe_id,
                        "type": "subscribe_events",
                        "event_type": "state_changed",
                    }
                )
            )
            subscribe_result = json.loads(await websocket.recv())
            if not subscribe_result.get("success", False):
                raise HTTPException(status_code=502, detail="Failed to subscribe to Home Assistant state events")

            while True:
                message = json.loads(await websocket.recv())
                if message.get("type") != "event":
                    continue

                event = message.get("event", {})
                data = event.get("data", {})
                entity_id = data.get("entity_id")
                if entity_id not in entity_ids:
                    continue

                new_state = data.get("new_state")
                if not isinstance(new_state, dict):
                    continue

                yield new_state

    def _build_ws_url(self) -> str:
        parsed = urlparse(str(self._client.base_url))
        scheme = "wss" if parsed.scheme == "https" else "ws"
        netloc = parsed.netloc
        return f"{scheme}://{netloc}/api/websocket"

    @staticmethod
    def _raise_on_error(response: httpx.Response, default_detail: str) -> None:
        if response.is_success:
            return

        detail = default_detail
        try:
            body = response.json()
            if isinstance(body, dict) and "message" in body:
                detail = str(body["message"])
        except ValueError:
            pass

        raise HTTPException(status_code=response.status_code, detail=detail)
