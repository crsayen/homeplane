from fastapi import Depends, Request

from app.services.ha_client import HomeAssistantClient
from app.services.orchestrator import HomeOrchestrator


def get_ha_client(request: Request) -> HomeAssistantClient:
    return request.app.state.ha_client


def get_orchestrator(ha_client: HomeAssistantClient = Depends(get_ha_client)) -> HomeOrchestrator:
    return HomeOrchestrator(ha_client)
