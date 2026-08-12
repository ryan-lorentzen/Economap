# EconoMap Frontend Instructions

## Scope

This directory is the repository and application root. The legacy parent project has been removed; do not reintroduce its scraper, Flask, Prisma, or grocery-comparison infrastructure without an explicit product decision.

This application uses Next.js 15 and React 19. Check the relevant local Next.js documentation in `node_modules/next/dist/docs/` before using unfamiliar framework APIs, and heed deprecation notices.

## Application Purpose

EconoMap is currently a gas-station finder. The application:

- Gets the user's location through the browser Geolocation API.
- Searches nearby gas stations through the Google Places API.
- Displays fuel-grade prices and stations on a client-only Leaflet map.
- Ranks stations by EconoMap score, price, or distance.
- Builds a route to a selected station and estimates the return trip using OSRM, with a straight-line fallback when routing is unavailable.

Grocery price comparison and shopping-cart code is present but is not part of the active user flow. The `/products` route currently redirects to `/`. Do not describe or implement those modules as production functionality without confirming the intended product direction.

## Project Layout

All paths below are relative to the repository root:

- `src/app/`: Next.js App Router pages, layout, global styles, and API route handlers.
- `src/app/page.tsx`: active gas-finder page and primary client-side orchestration.
- `src/app/api/gas-prices/route.ts`: server-side gas-station proxy and input validation.
- `src/app/api/grocery-stores/route.ts`: server-side grocery-store proxy; currently supporting functionality.
- `src/features/map/`: Leaflet map, markers, and route display.
- `src/features/list/`: unfinished product-list and shopping-cart UI.
- `src/GasPrices/`: Google Places gas-station integration, client, and types.
- `src/GroceryStores/`: Google Places grocery-store integration, client, and types.
- `src/store/`: Zustand state for location and cart data.
- `src/lib/`: shared utilities, route calculations, fake planning data, and data-source abstractions.
- `src/types/index.ts`: shared domain interfaces and route types.
- `public/images/leaflet/`: Leaflet marker assets used by the map.

Use the `@/*` alias for imports from `src/*`, as configured in `tsconfig.json`.

## Development

Run commands from the repository root:

```bash
npm install
npm run dev
npm run lint
npm run build
npm run start
```

The development server runs at `http://localhost:3000` by default.

`npm run lint` uses the repository's ESLint configuration. There is currently no unit-test script; validate behavior with lint, build, and manual browser checks unless tests are added.

## Environment and Integrations

- Set `GOOGLE_PLACES_API_KEY` in the local environment for live gas-station and grocery-store searches.
- Keep this key server-side. Requests from browser code must go through `/api/gas-prices` or `/api/grocery-stores`.
- The API route handlers validate latitude, longitude, and radius before calling Google Places.
- Google Places responses are normalized into the shared `GasStation` and `Store` types.
- Live requests use `cache: 'no-store'`; preserve this behavior unless caching is deliberately designed with freshness requirements.
- Deploy to Vercel as a Next.js project from this repository root. Vercel uses `npm ci` and `npm run build`; no `vercel.json` is required for the current configuration.
- Configure `GOOGLE_PLACES_API_KEY` in Vercel for Production, Preview, and Development rather than generating environment files during the build.

Do not commit `.env*` files or API keys. The frontend `.gitignore` excludes them.

## Client and Map Boundaries

- Leaflet and `react-leaflet` require the browser. Keep map rendering client-only and preserve the `dynamic(..., { ssr: false })` boundary used by the home page.
- Browser-only APIs such as `navigator.geolocation`, `window`, and Leaflet imports belong in client components or guarded effects.
- Use the existing Leaflet assets in `public/images/leaflet/` when configuring default markers.
- Route calculations use Leaflet Routing Machine with OSRM in the browser. `src/lib/routingUtils.ts` provides a fallback estimate, so route-related changes must account for unavailable or failed routing requests.
- Abort or ignore stale live-search requests when search parameters change; the current gas search uses `AbortController` and an active-request guard.

## State and Data Conventions

- Use `useLocationStore` for the current latitude and longitude.
- Use `useCartStore` for product/cart state; cart quantities are bounded by the existing store logic.
- Extend shared interfaces in `src/types/index.ts` rather than duplicating domain shapes in components.
- Keep Google Places mapping in the corresponding `googlePlaces*.ts` integration module, not in presentation components.
- Preserve explicit source metadata such as `source: 'google_places'` when handling live records.
- Fake planning data in `src/lib/dataSource.ts` and `src/lib/fakeData.ts` is a development placeholder, not live retailer pricing.

## UI and Accessibility

- Preserve the existing EconoMap visual language: responsive Tailwind styling, green/blue/orange semantic colors, rounded cards, and Leaflet map controls.
- Verify layouts on both desktop and narrow mobile viewports.
- Use semantic controls, visible focus states, meaningful button labels, and `aria-pressed`/`aria-expanded` state where applicable.
- Keep map interactions usable on touch devices, including popup close and routing controls.
- Avoid exposing raw API errors or secrets in the UI; display actionable user-facing messages instead.

## Change Verification

Before completing frontend changes:

1. Run `npm run lint`.
2. Run `npm run build` for changes affecting routes, server handlers, imports, configuration, or production behavior.
3. Manually check location permission denial, missing API-key behavior, empty search results, changing fuel grades/radius, station selection, and map behavior when relevant.
4. Inspect the diff and avoid committing generated `.next/`, `tsbuildinfo`, logs, or environment files.

When changing Google Places field masks, response mapping, route scoring, or fallback behavior, explain the behavioral impact and test both successful and failed/empty responses.
