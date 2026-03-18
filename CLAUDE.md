# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Homeplane is a Home Assistant orchestration facade — a full-stack web app providing dashboards for multi-room audio, lighting, and GPIO control on Raspberry Pi. The backend proxies and abstracts Home Assistant's API; the frontend provides the UI.

## Commands

### Local Development

```bash
# Run both frontend and backend concurrently (from root)
npm install
npm run dev

# Backend only
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --port 8080

# Frontend only
cd frontend
npm run dev       # Dev server at http://localhost:5173
npm run build     # Production build to dist/
```

### Backend Setup (first time)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # Edit with HA_BASE_URL, HA_TOKEN, APP_API_KEY
```

### Testing

```bash
cd backend
pytest tests/
pytest tests/test_orchestration.py   # API endpoint tests
pytest tests/test_sqlite_config_store.py  # SQLite persistence tests
```

### Docker

```bash
cp backend/.env.example backend/.env         # Set HA_BASE_URL, HA_TOKEN, APP_API_KEY
cp docker-compose.env.example docker-compose.env  # Set HOMEPLANE_HOSTS, VITE_HOMEPLANE_API_KEY

docker compose --env-file docker-compose.env up -d --build
```

## Architecture

### Data Flow

```
Browser → Caddy (TLS) → Nginx → /api/* → Backend (FastAPI) → Home Assistant
                              → /*     → React SPA
```

All API requests require the `x-homeplane-key` header (or `api_key` query param for WebSocket). The backend validates this, rate-limits, then proxies to Home Assistant using its long-lived token — the HA token never reaches the browser.

### Backend (`backend/app/`)

- **`main.py`** — FastAPI app, lifespan management (initializes HA client + GPIO service on startup), CORS middleware
- **`core/config.py`** — Pydantic Settings; all config via environment variables (`HA_BASE_URL`, `HA_TOKEN`, `APP_API_KEY`, `CONFIG_BACKEND`, rate limit settings)
- **`core/security.py`** — API key dependency injected into all routes
- **`core/rate_limit.py`** — In-memory per-(key+route) rate limiter
- **`api/routes/orchestration.py`** — All 15 REST endpoints + WebSocket; thin layer that calls services
- **`services/ha_client.py`** — Async HTTP (`httpx`) + WebSocket client to Home Assistant
- **`services/orchestrator.py`** — Business logic for light/switch/scene/number control
- **`services/gpio_service.py`** — Raspberry Pi GPIO via `rpi-lgpio`; falls back to in-memory simulation if hardware is unavailable
- **`services/config_store.py`** — JSON file (default) or SQLite persistence for room/lighting configs; seeds from `seed_configs/` on first run

### Frontend (`frontend/src/`)

- **`App.tsx`** — React Router, layout, global state (entity subscriptions)
- **`api/homeplaneClient.ts`** — Typed fetch wrapper; reads `VITE_HOMEPLANE_API_KEY` and optional `VITE_HOMEPLANE_API_URL` at build time
- **`components/MultiRoomAudioDashboard.tsx`** — Volume/mute per zone; inline config editor for room-to-entity mapping
- **`components/LightingDashboard.tsx`** — Room-grouped lights with on/off and dimming; inline config editor
- **`lib/`** — Theme (light/dark/system via `class`) and UI density utilities

### Config Persistence

Two backends selectable via `CONFIG_BACKEND` env var:
- `file` (default) — JSON files in a configurable directory
- `sqlite` — SQLite at a configurable path; use `sqlite3` to inspect

### GPIO

GPIO uses BCM pin numbering (pins 2–27). The `gpio_service` wraps `rpi-lgpio` (Pi 5 / kernel 6.x compatible). In Docker, `/dev/gpiochip0` must be exposed as a device. If the chip is unavailable, the service logs a warning and simulates pin state in memory.

### WebSocket Entity Streaming

`GET /api/ws/entities?api_key=...&entity_ids=light.foo,switch.bar` — subscribes to Home Assistant `state_changed` events and streams filtered updates to the client.
