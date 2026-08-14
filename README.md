# Go Go Gas!

Go Go Gas! finds nearby gas stations with live fuel-grade prices and plans fuel stops along longer US driving routes.

## Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000` and allow location access to search nearby stations.

Live station searches and destination autocomplete require a server-side `GOOGLE_PLACES_API_KEY` in `.env.local`:

```bash
GOOGLE_PLACES_API_KEY=your-key
```

Enable **Places API (New)** for that key. Destination suggestions use Autocomplete (New) and resolve selections through Place Details (New). The key remains server-side and autocomplete requests are grouped with session tokens.

Commute planning uses OSRM for road routes. Its endpoint is configurable:

```bash
OSRM_BASE_URL=https://router.project-osrm.org
```

The default public OSRM endpoint is a best-effort service. Configure a managed or self-hosted OSRM-compatible endpoint before relying on Commute planning in production. Commute planning fails safely instead of using straight-line estimates when OSRM is unavailable.

One completed active commute plan is saved in browser storage for up to seven days. Reloading the page restores its route and stops without repeating planning API requests. Browser geolocation tracking works only while the site is open. Clear the plan after a trip when using a shared device.

## Verification

```bash
npm run lint
npm run build
```

Leaflet maps and browser geolocation are client-only. Route estimates use OSRM with a straight-line fallback when routing is unavailable.

## Deployment

Deploy on Vercel as a Next.js project. Use the repository root as the Vercel Root Directory, `npm ci` as the install command, and `npm run build` as the build command.

Add `GOOGLE_PLACES_API_KEY` in Vercel Project Settings > Environment Variables for Production, Preview, and Development. Keep the key server-side; browser code only calls this application's API routes.
