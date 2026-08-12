# EconoMap

EconoMap finds nearby gas stations with live fuel-grade prices, price and distance ranking, and route estimates.

## Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000` and allow location access to search nearby stations.

Live station searches require a server-side `GOOGLE_PLACES_API_KEY` in `.env.local`:

```bash
GOOGLE_PLACES_API_KEY=your-key
```

## Verification

```bash
npm run lint
npm run build
```

Leaflet maps and browser geolocation are client-only. Route estimates use OSRM with a straight-line fallback when routing is unavailable.
