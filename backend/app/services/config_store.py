import asyncio
import json
import sqlite3
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel

ModelT = TypeVar("ModelT", bound=BaseModel)


class JsonConfigStore:
    def __init__(self, path: str, model_cls: type[ModelT], seed_path: str | None = None) -> None:
        self._path = Path(path)
        self._model_cls = model_cls
        self._seed_path = Path(seed_path) if seed_path else None
        self._lock = asyncio.Lock()

    async def load(self) -> ModelT:
        async with self._lock:
            if not self._path.exists():
                self._path.parent.mkdir(parents=True, exist_ok=True)
                if self._seed_path and self._seed_path.exists():
                    self._path.write_text(self._seed_path.read_text(encoding="utf-8"), encoding="utf-8")
                else:
                    config = self._model_cls()
                    self._path.write_text(config.model_dump_json(indent=2), encoding="utf-8")
                    return config

            raw = self._path.read_text(encoding="utf-8")
            payload = json.loads(raw)
            return self._model_cls.model_validate(payload)

    async def save(self, config: ModelT) -> ModelT:
        async with self._lock:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(config.model_dump_json(indent=2), encoding="utf-8")
            return config


class SQLiteConfigStore:
    def __init__(
        self,
        db_path: str,
        key: str,
        model_cls: type[ModelT],
        seed_path: str | None = None,
    ) -> None:
        self._db_path = Path(db_path)
        self._key = key
        self._model_cls = model_cls
        self._seed_path = Path(seed_path) if seed_path else None
        self._lock = asyncio.Lock()

    def _connect(self) -> sqlite3.Connection:
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self._db_path)
        connection.execute("PRAGMA journal_mode=WAL;")
        connection.execute("PRAGMA busy_timeout=5000;")
        return connection

    @staticmethod
    def _initialize(connection: sqlite3.Connection) -> None:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS config_store (
              key TEXT PRIMARY KEY,
              payload TEXT NOT NULL,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

    async def load(self) -> ModelT:
        async with self._lock:
            with self._connect() as connection:
                self._initialize(connection)
                row = connection.execute(
                    "SELECT payload FROM config_store WHERE key = ?",
                    (self._key,),
                ).fetchone()
                if row is None:
                    if self._seed_path and self._seed_path.exists():
                        payload_text = self._seed_path.read_text(encoding="utf-8")
                        payload = self._model_cls.model_validate(json.loads(payload_text))
                    else:
                        payload = self._model_cls()

                    connection.execute(
                        """
                        INSERT INTO config_store (key, payload, updated_at)
                        VALUES (?, ?, CURRENT_TIMESTAMP)
                        ON CONFLICT(key) DO UPDATE SET
                          payload = excluded.payload,
                          updated_at = CURRENT_TIMESTAMP
                        """,
                        (self._key, payload.model_dump_json(indent=2)),
                    )
                    connection.commit()
                    return payload

                return self._model_cls.model_validate(json.loads(row[0]))

    async def save(self, config: ModelT) -> ModelT:
        async with self._lock:
            with self._connect() as connection:
                self._initialize(connection)
                connection.execute(
                    """
                    INSERT INTO config_store (key, payload, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(key) DO UPDATE SET
                      payload = excluded.payload,
                      updated_at = CURRENT_TIMESTAMP
                    """,
                    (self._key, config.model_dump_json(indent=2)),
                )
                connection.commit()
                return config
