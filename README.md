# homeplane

Starter scaffold for a Home Assistant orchestration facade:

- `backend/`: FastAPI API that holds your Home Assistant token and exposes validated endpoints.
- `frontend/src/api/homeplaneClient.ts`: Typed client for React apps.

## Backend quick start

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# edit .env with your HA URL/token and app API key
uvicorn app.main:app --reload --port 8080
```

## Frontend quick start

```bash
cd frontend
npm install
cp .env.example .env
# set VITE_HOMEPLANE_API_KEY (and optionally VITE_HOMEPLANE_API_URL)
npm run dev
```

## Run locally

Run these in separate terminals:

1. Backend
```bash
source /Users/chrissayen/dev/homeplane/venv/bin/activate
cd /Users/chrissayen/dev/homeplane/backend
uvicorn app.main:app --reload --port 8080
```
2. Frontend
```bash
cd /Users/chrissayen/dev/homeplane/frontend
npm run dev
```

Open the frontend URL printed by Vite (usually `http://localhost:5173`).

Or from repo root in one command:

```bash
npm install
npm run dev
```

## Docker Deployment (Rack Server)

This repo includes:

- [docker-compose.yml](/Users/chrissayen/dev/homeplane/docker-compose.yml)
- [Caddyfile](/Users/chrissayen/dev/homeplane/Caddyfile)
- [backend/Dockerfile](/Users/chrissayen/dev/homeplane/backend/Dockerfile)
- [frontend/Dockerfile](/Users/chrissayen/dev/homeplane/frontend/Dockerfile)
- [frontend/nginx.conf](/Users/chrissayen/dev/homeplane/frontend/nginx.conf)

Architecture:

- `caddy` container: host-based routing + TLS termination (LAN certificates)
- `web` container: serves built React app with Nginx and proxies `/api` + `/api/ws/*` to backend
- `backend` container: FastAPI/Uvicorn service (internal Docker network only)
- `homeplane_config` Docker volume: persists editable room configuration at `/data/multi-room-audio.config.json`

### 1. Configure backend secrets

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` with your Home Assistant URL/token and app key.

### 2. Configure frontend build-time env

```bash
cp docker-compose.env.example docker-compose.env
```

Edit `docker-compose.env`:
- `HOMEPLANE_HOSTS` set to your LAN hostname(s), e.g. `homeplane.lan`
- `VITE_HOMEPLANE_API_KEY` must match backend `APP_API_KEY`
- `VITE_HOMEPLANE_API_URL` can be left empty to use same-origin

### 3. Configure DNS/hosts for host-based routing

Point your chosen hostname to the server IP on your LAN.

Example `/etc/hosts` entry on a client device:

```text
192.168.1.50 homeplane.lan
```

### 4. Build and run

```bash
docker compose --env-file docker-compose.env up -d --build
```

### 5. Trust Caddy LAN certificate on clients

Caddy uses an internal CA (`local_certs`) for TLS on LAN hostnames.

Export CA root certificate:

```bash
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-local-root.crt
```

Install/trust `caddy-local-root.crt` on each client device that will access Homeplane.

### 6. Open app

Browse to `https://<your-hostname>/` (for example `https://homeplane.lan/`).

### 7. Update deployment

```bash
docker compose --env-file docker-compose.env up -d --build
```

Room updates done through the UI `Config` editor are written to the backend config volume and apply immediately. No rebuild/redeploy is required for adding/removing rooms.

### SQLite config storage (optional)

Homeplane supports storing `audio-config` and `lighting-config` in SQLite instead of JSON files.

When `CONFIG_STORE_BACKEND=sqlite`, Homeplane uses one table (`config_store`) in the database file and stores JSON payloads keyed by config name.

On first load of each config key, Homeplane will seed from:
- `AUDIO_CONFIG_SEED_PATH` for audio
- `LIGHTING_CONFIG_SEED_PATH` for lighting

#### Local setup

In `backend/.env`:

```env
CONFIG_STORE_BACKEND=sqlite
SQLITE_CONFIG_DB_PATH=./data/homeplane-config.sqlite3
```

Then restart backend:

```bash
source /Users/chrissayen/dev/homeplane/venv/bin/activate
cd /Users/chrissayen/dev/homeplane/backend
uvicorn app.main:app --reload --port 8080
```

#### Docker setup

In `backend/.env` on your server:

```env
CONFIG_STORE_BACKEND=sqlite
```

`docker-compose.yml` already maps SQLite DB path to `/data/homeplane-config.sqlite3`, which is on the persistent `homeplane_config` volume.

Rebuild/restart:

```bash
docker compose --env-file docker-compose.env up -d --build
```

Inspect DB on server (optional):

```bash
sqlite3 /var/lib/docker/volumes/<project>_homeplane_config/_data/homeplane-config.sqlite3 ".tables"
sqlite3 /var/lib/docker/volumes/<project>_homeplane_config/_data/homeplane-config.sqlite3 "select key, updated_at from config_store;"
```

## Implemented endpoints

All endpoints require `x-homeplane-key` header.

- `POST /api/lights/{entity_id}/toggle`
- `POST /api/scenes/{entity_id}/activate`
- `GET /api/entities/{entity_id}/state`
- `POST /api/switches/{entity_id}/state`
- `POST /api/lights/{entity_id}/state`
- `POST /api/numbers/{entity_id}/value`
- `GET /api/health`
- `GET /api/audio-config`
- `PUT /api/audio-config`
- `GET /api/lighting-config`
- `PUT /api/lighting-config`
- `WS /api/ws/entities?api_key=...&entity_ids=switch.a,number.b`
- `POST /api/gpio/{pin}/state` — set GPIO pin state (BCM pin 2–27)
- `GET /api/gpio/{pin}/state` — read GPIO pin state

### GPIO endpoint details

`POST /api/gpio/{pin}/state` body:

```json
{ "state": true }
```

Set pin indefinitely. Or with a timed auto-revert:

```json
{ "state": true, "duration_ms": 500 }
```

Pin reverts to the opposite state after `duration_ms` milliseconds. If a new timed request arrives before the timer fires, the previous timer is cancelled.

### Home Assistant `rest_command` example

```yaml
rest_command:
  pulse_gpio_17:
    url: "https://homeplane.lan/api/gpio/17/state"
    method: POST
    headers:
      x-homeplane-key: "your-key"
    payload: '{"state": true, "duration_ms": 500}'
    content_type: "application/json"
    verify_ssl: false  # needed for Caddy LAN self-signed cert
```

## Raspberry Pi GPIO setup

GPIO control uses `rpi-lgpio` (Pi 5 / kernel 6.x compatible). Two extra things are required in `docker-compose.yml` for the backend service, both already present:

**Device access** — exposes the GPIO character device to the container:
```yaml
devices:
  - /dev/gpiochip0:/dev/gpiochip0
```

**Board revision** — `rpi-lgpio` reads `/proc/device-tree/system/linux,revision` to detect Pi hardware, which isn't available inside Docker. Pass it as an env var instead:
```yaml
environment:
  RPI_LGPIO_REVISION: "00d04171"
```

To find your Pi's revision:
```bash
cat /proc/device-tree/system/linux,revision | od -An -tx1 | tr -d " \n"; echo
```

If GPIO hardware isn't available (non-Pi or missing device), the service falls back to an in-memory simulation and logs a warning. The app continues to run normally.

## Notes

- Home Assistant token never leaves the backend.
- Basic in-memory per-route+API-key rate limiting is enabled.
- CORS is configured from `ALLOWED_ORIGINS`.
- Dashboard subscribes to Home Assistant `state_changed` events through backend websocket streaming.
- Room config is stored server-side and can be edited from the dashboard UI.
- Lighting config is stored server-side and can be edited from the dashboard UI.

## Multi-Room Audio Dashboard

Room config is loaded from backend `GET /api/audio-config` and edited in-app via the `Config` button.

Dashboard component:
- [MultiRoomAudioDashboard.tsx](/Users/chrissayen/dev/homeplane/frontend/src/components/MultiRoomAudioDashboard.tsx)
- Tailwind CSS powered, mobile-first layout with light/dark/system theme toggle.

Dashboard paths:
- `/` dashboard index
- `/dashboards/audio` multi-room audio dashboard
- `/dashboards/lighting` lighting dashboard (room-grouped on/off lights, config editable in-app)
Default seed file in backend image:
- [backend/data/multi-room-audio.config.json](/Users/chrissayen/dev/homeplane/backend/data/multi-room-audio.config.json)
