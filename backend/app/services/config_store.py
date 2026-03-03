import asyncio
import json
from pathlib import Path

from app.schemas.configuration import MultiRoomAudioConfig


class AudioConfigStore:
    def __init__(self, path: str, seed_path: str | None = None) -> None:
        self._path = Path(path)
        self._seed_path = Path(seed_path) if seed_path else None
        self._lock = asyncio.Lock()

    async def load(self) -> MultiRoomAudioConfig:
        async with self._lock:
            if not self._path.exists():
                self._path.parent.mkdir(parents=True, exist_ok=True)
                if self._seed_path and self._seed_path.exists():
                    self._path.write_text(self._seed_path.read_text(encoding="utf-8"), encoding="utf-8")
                else:
                    config = MultiRoomAudioConfig(rooms=[])
                    self._path.write_text(config.model_dump_json(indent=2), encoding="utf-8")
                    return config

            raw = self._path.read_text(encoding="utf-8")
            payload = json.loads(raw)
            return MultiRoomAudioConfig.model_validate(payload)

    async def save(self, config: MultiRoomAudioConfig) -> MultiRoomAudioConfig:
        async with self._lock:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(config.model_dump_json(indent=2), encoding="utf-8")
            return config
