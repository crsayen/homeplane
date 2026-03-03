import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas.configuration import MultiRoomAudioConfig
from app.services.config_store import SQLiteConfigStore


def test_sqlite_store_loads_seed_and_persists_updates(tmp_path: Path) -> None:
    db_path = tmp_path / "homeplane-config.sqlite3"
    seed_path = tmp_path / "audio-seed.json"
    seed_payload = {
        "rooms": [
            {"name": "Garage", "switch": "switch.garage_power", "number": "number.garage_volume"},
        ]
    }
    seed_path.write_text(json.dumps(seed_payload), encoding="utf-8")

    store = SQLiteConfigStore(
        db_path=str(db_path),
        key="audio-config",
        model_cls=MultiRoomAudioConfig,
        seed_path=str(seed_path),
    )

    loaded = asyncio.run(store.load())
    assert loaded.model_dump() == seed_payload

    updated = MultiRoomAudioConfig.model_validate(
        {
            "rooms": [
                {"name": "Office", "switch": "switch.office_power", "number": "number.office_volume"},
            ]
        }
    )
    asyncio.run(store.save(updated))

    reloaded = asyncio.run(store.load())
    assert reloaded.model_dump() == updated.model_dump()
