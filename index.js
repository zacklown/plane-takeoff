const fs = require('fs');
const path = require('path');
const http = require('http');

const PORT = process.env.PORT || 3000;
const AIRLABS_API_KEY = process.env.AIRLABS_API_KEY || '';
const AIRPORT = 'HNL';
const AIRLABS_URL = 'https://airlabs.co/api/v9/flights';
const AIRLABS_CACHE_TTL_MS = Number(process.env.AIRLABS_CACHE_TTL_MS || 30000);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon'
};

const cache = {
  takeoff: { data: [], expiresAt: 0, pending: null },
  landing: { data: [], expiresAt: 0, pending: null }
};

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getLocation(latitude, longitude, iata, name) {
  const lat = toNumber(latitude);
  const lon = toNumber(longitude);
  return {
    iata: iata || '',
    name: name || '',
    lat,
    lon
  };
}

function sendJson(res, code, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(data);
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

function normalizeFlight(flight, direction) {
  const scheduledSeconds = toNumber(
    flight.dep_time || flight.arr_time || flight.dep_estimated_time || flight.arr_estimated_time || Math.floor(Date.now() / 1000)
  );
  const scheduledAt = scheduledSeconds ? new Date(scheduledSeconds * 1000).toISOString() : new Date().toISOString();

  const departure = getLocation(
    flight.dep_lat,
    flight.dep_lon || flight.dep_lng,
    flight.dep_iata,
    flight.dep_name
  );
  const arrival = getLocation(
    flight.arr_lat,
    flight.arr_lon || flight.arr_lng,
    flight.arr_iata,
    flight.arr_name
  );

  if (direction === 'takeoff') {
    return {
      direction,
      flight: flight.flight_number || flight.flight_icao || flight.flight_iata || 'Unknown',
      airline: flight.airline_iata ? `${flight.airline_iata} - ${flight.airline_icao || ''}`.trim() : flight.airline || '',
      other_airport: arrival.iata || arrival.name || '',
      other_airport_iata: arrival.iata || '',
      other_airport_name: arrival.name || '',
      scheduled_at: scheduledAt,
      scheduled_ts: scheduledSeconds ? scheduledSeconds * 1000 : Date.now(),
      terminal: flight.dep_terminal || flight.departure_terminal || '',
      gate: flight.dep_gate || flight.departure_gate || '',
      status: flight.status || '',
      origin: {
        iata: departure.iata || AIRPORT,
        name: departure.name || 'HNL',
        lat: departure.lat,
        lon: departure.lon
      },
      destination: {
        iata: arrival.iata || '',
        name: arrival.name || '',
        lat: arrival.lat,
        lon: arrival.lon
      }
    };
  }

  return {
    direction,
    flight: flight.flight_number || flight.flight_icao || flight.flight_iata || 'Unknown',
    airline: flight.airline_iata ? `${flight.airline_iata} - ${flight.airline_icao || ''}`.trim() : flight.airline || '',
    other_airport: departure.iata || departure.name || '',
    other_airport_iata: departure.iata || '',
    other_airport_name: departure.name || '',
    scheduled_at: scheduledAt,
    scheduled_ts: scheduledSeconds ? scheduledSeconds * 1000 : Date.now(),
    terminal: flight.arr_terminal || flight.arrival_terminal || '',
    gate: flight.arr_gate || flight.arrival_gate || '',
    status: flight.status || '',
    origin: {
      iata: departure.iata || '',
      name: departure.name || '',
      lat: departure.lat,
      lon: departure.lon
    },
    destination: {
      iata: arrival.iata || AIRPORT,
      name: arrival.name || 'HNL',
      lat: arrival.lat,
      lon: arrival.lon
    }
  };
}

async function fetchFlights(direction) {
  if (!AIRLABS_API_KEY) return [];

  const params = new URLSearchParams({
    api_key: AIRLABS_API_KEY,
    limit: '50'
  });
  if (direction === 'takeoff') {
    params.set('dep_iata', AIRPORT);
  } else {
    params.set('arr_iata', AIRPORT);
  }

  const url = `${AIRLABS_URL}?${params.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`AirLabs API error ${response.status}`);
  }

  const payload = await response.json();
  const raw = Array.isArray(payload.response) ? payload.response : [];
  return raw.map((flight) => normalizeFlight(flight, direction));
}

async function getCachedFlights(direction, forceRefresh = false) {
  const entry = cache[direction];
  if (!entry) return [];

  const hasFreshData = entry.expiresAt > Date.now() && entry.data.length > 0;
  if (!forceRefresh && hasFreshData) {
    return entry.data;
  }

  if (entry.pending) {
    return entry.pending;
  }

  entry.pending = (async () => {
    const data = await fetchFlights(direction);
    entry.data = Array.isArray(data) ? data : [];
    entry.expiresAt = Date.now() + AIRLABS_CACHE_TTL_MS;
    return entry.data;
  })().finally(() => {
    entry.pending = null;
  });

  return entry.pending;
}

async function getFlights(_req, res, query) {
  if (!AIRLABS_API_KEY) {
    sendJson(res, 500, { error: 'AIRLABS_API_KEY environment variable is required.' });
    return;
  }

  const forceRefresh = Boolean(query?.get('refresh'));

  try {
    const [takeoffFlights, landingFlights] = await Promise.all([
      getCachedFlights('takeoff', forceRefresh),
      getCachedFlights('landing', forceRefresh)
    ]);

    const flights = [...takeoffFlights, ...landingFlights];
    sendJson(res, 200, {
      status: 'ok',
      airport: AIRPORT,
      updated_at: new Date().toISOString(),
      ttl_ms: AIRLABS_CACHE_TTL_MS,
      cached: !forceRefresh,
      flights
    });
  } catch (err) {
    sendJson(res, 502, { error: err.message || 'Failed to fetch from AirLabs' });
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (url.pathname === '/api/flights') {
    getFlights(req, res, url.searchParams);
    return;
  }

  const fileName = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (fileName.includes('..')) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  const publicDir = path.join(__dirname, 'public');
  const filePath = path.resolve(publicDir, fileName);
  if (!filePath.startsWith(path.resolve(publicDir) + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  sendFile(res, filePath);
});

server.listen(PORT, () => {
  console.log(`plane-takeoff listening on http://localhost:${PORT}`);
});