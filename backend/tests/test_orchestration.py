import importlib
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class FakeHAClient:
    def __init__(self) -> None:
        self.service_calls: list[tuple[str, str, dict[str, object]]] = []
        self.state_calls: list[str] = []

    async def close(self) -> None:
        return

    async def call_service(self, domain: str, service: str, data: dict[str, object]) -> list[dict[str, object]]:
        self.service_calls.append((domain, service, data))
        return [{"ok": True, "domain": domain, "service": service, "data": data}]

    async def get_state(self, entity_id: str) -> dict[str, object]:
        self.state_calls.append(entity_id)
        return {
            "entity_id": entity_id,
            "state": "on",
            "attributes": {"friendly_name": "Kitchen"},
            "last_changed": "2026-02-27T00:00:00+00:00",
            "last_updated": "2026-02-27T00:00:01+00:00",
        }

    async def iter_state_changes(self, entity_ids: set[str]):
        if "switch.garage_power" in entity_ids:
            yield {
                "entity_id": "switch.garage_power",
                "state": "on",
                "attributes": {"friendly_name": "Garage Power"},
                "last_changed": "2026-02-27T00:00:02+00:00",
                "last_updated": "2026-02-27T00:00:02+00:00",
            }


@pytest.fixture
def app_client() -> tuple[TestClient, FakeHAClient]:
    config_file = Path(__file__).resolve().parent / "test-audio-config.json"
    lighting_file = Path(__file__).resolve().parent / "test-lighting-config.json"
    config_file.write_text(
        '{\n  "rooms": [\n    {"name": "Garage", "switch": "switch.garage_power", "number": "number.garage_volume"}\n  ]\n}',
        encoding="utf-8",
    )
    lighting_file.write_text(
        '{\n  "rooms": [\n    {"name": "Kitchen", "lights": ["light.kitchen_main_lights"]}\n  ]\n}',
        encoding="utf-8",
    )

    os.environ["HA_BASE_URL"] = "http://homeassistant.local:8123"
    os.environ["HA_TOKEN"] = "test-token"
    os.environ["APP_API_KEY"] = "test-key"
    os.environ["ALLOWED_ORIGINS"] = "http://localhost:5173"
    os.environ["RATE_LIMIT_REQUESTS"] = "100"
    os.environ["RATE_LIMIT_WINDOW_SECONDS"] = "60"
    os.environ["AUDIO_CONFIG_PATH"] = str(config_file)
    os.environ["AUDIO_CONFIG_SEED_PATH"] = str(config_file)
    os.environ["LIGHTING_CONFIG_PATH"] = str(lighting_file)
    os.environ["LIGHTING_CONFIG_SEED_PATH"] = str(lighting_file)

    import app.core.config as config_module
    import app.main as main_module

    config_module.get_settings.cache_clear()
    main_module = importlib.reload(main_module)
    fake_ha = FakeHAClient()
    with TestClient(main_module.app) as client:
        main_module.app.state.ha_client = fake_ha
        yield client, fake_ha

    if config_file.exists():
        config_file.unlink()
    if lighting_file.exists():
        lighting_file.unlink()


def test_health_requires_api_key(app_client: tuple[TestClient, FakeHAClient]) -> None:
    client, _ = app_client
    response = client.get("/api/health")
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or missing API key"


def test_health_with_api_key(app_client: tuple[TestClient, FakeHAClient]) -> None:
    client, _ = app_client
    response = client.get("/api/health", headers={"x-homeplane-key": "test-key"})
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_toggle_light_forwards_entity_and_transition(
    app_client: tuple[TestClient, FakeHAClient],
) -> None:
    client, fake_ha = app_client
    response = client.post(
        "/api/lights/light.kitchen/toggle",
        headers={"x-homeplane-key": "test-key"},
        json={"transition_seconds": 2.5},
    )

    assert response.status_code == 200
    assert fake_ha.service_calls == [("light", "toggle", {"entity_id": "light.kitchen", "transition": 2.5})]


def test_activate_scene_forwards_entity(app_client: tuple[TestClient, FakeHAClient]) -> None:
    client, fake_ha = app_client
    response = client.post(
        "/api/scenes/scene.movie_time/activate",
        headers={"x-homeplane-key": "test-key"},
        json={},
    )

    assert response.status_code == 200
    assert fake_ha.service_calls == [("scene", "turn_on", {"entity_id": "scene.movie_time"})]


def test_get_entity_state_returns_mapped_payload(app_client: tuple[TestClient, FakeHAClient]) -> None:
    client, fake_ha = app_client
    response = client.get(
        "/api/entities/light.kitchen/state",
        headers={"x-homeplane-key": "test-key"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["entity_id"] == "light.kitchen"
    assert body["state"] == "on"
    assert body["attributes"]["friendly_name"] == "Kitchen"
    assert fake_ha.state_calls == ["light.kitchen"]


def test_invalid_entity_id_rejected_before_ha_call(app_client: tuple[TestClient, FakeHAClient]) -> None:
    client, fake_ha = app_client
    response = client.get(
        "/api/entities/not-valid/state",
        headers={"x-homeplane-key": "test-key"},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Invalid entity_id format"
    assert fake_ha.state_calls == []


def test_set_switch_state_turns_on_with_switch_domain(app_client: tuple[TestClient, FakeHAClient]) -> None:
    client, fake_ha = app_client
    response = client.post(
        "/api/switches/switch.garage_power/state",
        headers={"x-homeplane-key": "test-key"},
        json={"is_on": True},
    )

    assert response.status_code == 200
    assert fake_ha.service_calls == [("switch", "turn_on", {"entity_id": "switch.garage_power"})]


def test_set_switch_state_rejects_wrong_domain(app_client: tuple[TestClient, FakeHAClient]) -> None:
    client, fake_ha = app_client
    response = client.post(
        "/api/switches/light.kitchen/state",
        headers={"x-homeplane-key": "test-key"},
        json={"is_on": False},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "entity_id must start with 'switch.'"
    assert fake_ha.service_calls == []


def test_set_number_value_forwards_value(app_client: tuple[TestClient, FakeHAClient]) -> None:
    client, fake_ha = app_client
    response = client.post(
        "/api/numbers/number.garage_volume/value",
        headers={"x-homeplane-key": "test-key"},
        json={"value": 0.42},
    )

    assert response.status_code == 200
    assert fake_ha.service_calls == [
        ("number", "set_value", {"entity_id": "number.garage_volume", "value": 0.42})
    ]


def test_set_light_state_forwards_value(app_client: tuple[TestClient, FakeHAClient]) -> None:
    client, fake_ha = app_client
    response = client.post(
        "/api/lights/light.kitchen_main_lights/state",
        headers={"x-homeplane-key": "test-key"},
        json={"is_on": True},
    )

    assert response.status_code == 200
    assert fake_ha.service_calls == [("light", "turn_on", {"entity_id": "light.kitchen_main_lights"})]


def test_websocket_streams_entity_updates(app_client: tuple[TestClient, FakeHAClient]) -> None:
    client, _ = app_client
    with client.websocket_connect("/api/ws/entities?api_key=test-key&entity_ids=switch.garage_power") as websocket:
        payload = websocket.receive_json()

    assert payload["type"] == "state_changed"
    assert payload["state"]["entity_id"] == "switch.garage_power"
    assert payload["state"]["state"] == "on"


def test_get_audio_config_returns_file_content(app_client: tuple[TestClient, FakeHAClient]) -> None:
    client, _ = app_client
    response = client.get("/api/audio-config", headers={"x-homeplane-key": "test-key"})
    assert response.status_code == 200
    body = response.json()
    assert len(body["rooms"]) == 1
    assert body["rooms"][0]["name"] == "Garage"


def test_put_audio_config_persists_content(app_client: tuple[TestClient, FakeHAClient]) -> None:
    client, _ = app_client
    payload = {
        "rooms": [
            {"name": "Office", "switch": "switch.office_power", "number": "number.office_volume"},
            {"name": "Den", "switch": "switch.den_power", "number": "number.den_volume"},
        ]
    }
    write_response = client.put("/api/audio-config", headers={"x-homeplane-key": "test-key"}, json=payload)
    assert write_response.status_code == 200

    read_response = client.get("/api/audio-config", headers={"x-homeplane-key": "test-key"})
    assert read_response.status_code == 200
    assert read_response.json() == payload


def test_get_lighting_config_returns_file_content(app_client: tuple[TestClient, FakeHAClient]) -> None:
    client, _ = app_client
    response = client.get("/api/lighting-config", headers={"x-homeplane-key": "test-key"})
    assert response.status_code == 200
    body = response.json()
    assert len(body["rooms"]) == 1
    assert body["rooms"][0]["name"] == "Kitchen"


def test_put_lighting_config_persists_content(app_client: tuple[TestClient, FakeHAClient]) -> None:
    client, _ = app_client
    payload = {
        "rooms": [
            {"name": "Living Room", "lights": ["light.living_room_main_lights", "light.living_room_lamp"]},
        ]
    }
    write_response = client.put("/api/lighting-config", headers={"x-homeplane-key": "test-key"}, json=payload)
    assert write_response.status_code == 200

    read_response = client.get("/api/lighting-config", headers={"x-homeplane-key": "test-key"})
    assert read_response.status_code == 200
    assert read_response.json() == payload


def test_put_lighting_config_with_display_names(app_client: tuple[TestClient, FakeHAClient]) -> None:
    client, _ = app_client
    payload = {
        "rooms": [
            {
                "name": "Kitchen",
                "lights": [
                    {
                        "entity_id": "light.kitchen_main_lights",
                        "display_name": "Kitchen Main",
                        "icon": "mdi:chandelier",
                        "update_timeout_seconds": 8,
                    },
                    {"entity_id": "light.kitchen_sink_pendant"},
                ],
            },
        ]
    }
    write_response = client.put("/api/lighting-config", headers={"x-homeplane-key": "test-key"}, json=payload)
    assert write_response.status_code == 200

    read_response = client.get("/api/lighting-config", headers={"x-homeplane-key": "test-key"})
    assert read_response.status_code == 200
    body = read_response.json()
    assert body["rooms"][0]["name"] == "Kitchen"
    assert body["rooms"][0]["lights"][0] == {
        "entity_id": "light.kitchen_main_lights",
        "display_name": "Kitchen Main",
        "icon": "mdi:chandelier",
        "update_timeout_seconds": 8,
    }
    assert body["rooms"][0]["lights"][1]["entity_id"] == "light.kitchen_sink_pendant"
