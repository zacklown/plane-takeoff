# plane-takeoff

A tiny webapp that fetches AirLabs data and shows live HNL takeoffs and landings.

## Quick start

### 1) Create an `.env` file

```dotenv
AIRLABS_API_KEY=your_airlabs_api_key_here
AIRLABS_CACHE_TTL_MS=30000
```

### 2a) Run with Docker Compose

```powershell
docker compose up --build -d
```

### 2b) Run with plain Docker

```powershell
docker build -t plane-takeoff .
docker run --rm -p 3000:3000 --env-file .env plane-takeoff
```

Then open `http://localhost:3000`.

## Features

- Lists departures and arrivals for HNL.
- Highlights the soonest takeoff and soonest landing.
- Draws the next departure/arrival route on an OpenStreetMap map.
- Sends browser notifications for upcoming events, e.g.:
  - `UA34 from Tokyo is about to land`
  - `UA34 to Tokyo is about to take off`

## Files

- `index.js` — Node HTTP server and `/api/flights` endpoint.
- `public/index.html` — frontend with tables, map, and notification logic.
- `Dockerfile` — container image.
- `docker-compose.yml` — optional compose setup.
- `.env.example` — environment template.
- `.dockerignore` — excludes non-app files from the image context.