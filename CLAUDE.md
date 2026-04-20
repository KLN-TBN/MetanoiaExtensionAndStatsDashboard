# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
Metanoia is a digital wellness platform consisting of a Chrome extension and a web dashboard. It uses Gemini AI to detect "digital maladies" (manipulative patterns) in real-time as users browse, providing alerts, counter-perspectives, and tracking wellness metrics.

## Commands
- `npm run dev` — Start Express server with Vite middleware on port 3000 (development)
- `npm run build` — Build the React app into `/dist`
- `npm run lint` — TypeScript type checking (`tsc --noEmit`)
- `npm run start` — Same as `dev`, uses `tsx server.ts`

**Note:** `tsx server.ts` does **not** hot-reload. Changes to `server.ts` require a manual server restart (`Ctrl+C` then `npm run dev`). To enable auto-restart on save during development, use `tsx watch server.ts` instead.

**Environment:** Requires `GEMINI_API_KEY` (or `GOOGLE_API_KEY` or `API_KEY`) in `.env.local`. Firebase config is in `firebase-applet-config.json` (not `.env`).

## Architecture

### Data Flow
1. Chrome extension (`content.js`) scans DOM text + visible images on page load/mutation
2. `background.js` POSTs extracted text, `imageUrls`, `enabledMaladies`, and `userId` to `/api/scan`
3. Server builds a dynamic Gemini prompt using only the user's enabled malady types
4. Server validates each malady: discards unknown types and any whose `flaggedText` cannot be found (normalised) in the original source text — prevents phantom highlights
5. If `lust_trigger` is enabled and images were provided, a second multimodal Gemini call scans images for suggestive content (`imageMaladies`)
6. Server writes verified malady logs (text + image) to Firestore `malady_logs` and updates `users/{uid}/stats`
7. Dashboard (`App.tsx`) subscribes to Firestore in real-time via `onSnapshot` and renders detection logs with feedback controls

### Dual Firebase SDK Usage
- **Client-side** (`src/firebase.ts`): Uses `firebase` (web SDK) for auth and Firestore reads/listeners
- **Server-side** (`server.ts`): Uses `firebase-admin` for privileged writes (logging maladies, updating stats)
- Both use the same `firestoreDatabaseId` from `firebase-applet-config.json` (not the default Firestore DB)
- If `GOOGLE_APPLICATION_CREDENTIALS` env var is set, Admin SDK uses that service-account cert; otherwise falls back to ADC (works on Cloud Run)

### WebSocket
`server.ts` wraps `console.log`/`console.error` to broadcast all server logs to WebSocket clients via `/ws`. WebSocket upgrades are handled manually on the HTTP server before Vite intercepts them. The dashboard **no longer connects to the WebSocket** — server logs are only visible in the server terminal or browser DevTools console. The `/ws` endpoint remains on the server for potential future use.

### Extension Download
The dashboard packages `/public/extension/` files into a ZIP (via `jszip`) served directly from the browser. Files served at `/extension/*` from Vite's public directory.

### Extension–Dashboard Sync
The extension sends `REQUEST_SYNC` via `window.postMessage`; the dashboard listens and dispatches a `METANOIA_SYNC` CustomEvent with `{ uid, appUrl, enabledMaladies, displayName }`. The extension stores all four values in `chrome.storage.local`. `enabledMaladies` is included in every scan request so the server only scans for the user's active types. `displayName` is shown in the popup instead of the raw UID.

## Firestore Collections
- `users/{uid}` — `UserProfile`: email, surveyResults, protectionProfile, stats
- `malady_logs` — `MaladyLog`: uid, maladyType, explanation, metricValue, metricType, url, flaggedText, counterPerspective, feedback, timestamp

## Tech Stack
- **Frontend:** React 19, Vite, Tailwind CSS v4, Lucide Icons, Framer Motion (`motion/react`)
- **Backend:** Node.js, Express, `tsx` (no build step for server)
- **Database/Auth:** Firebase (Firestore & Google Auth)
- **AI:** `@google/genai` (Gemini) — server-side only
- **Extension:** Manifest V3, Vanilla JS/CSS

## Domain Terminology
- **Malady types:** `rabbit_hole`, `outrage_cycle`, `echo_chamber`, `buy_now`, `gambling_trigger`, `lust_trigger`
- **Metric types:** `time_saved` (min), `money_saved` ($), `viewpoints` (pts), `rage_avoided` (min), `urge_avoided` (count), `exposure_avoided` (count)
- **Malady colors:** rabbit_hole=`#00f2ff`, outrage_cycle=`#ff4444`, echo_chamber=`#00ff00`, buy_now=`#ff00ff`, gambling_trigger=`#ffd700`, lust_trigger=`#ff69b4`
- **Counter Perspective:** Alternative viewpoint provided only for `echo_chamber` maladies
- **Sync:** Linking the extension to the dashboard via Firebase UID — also syncs `enabledMaladies` and `displayName`
- **Personalized scanning:** The Gemini prompt is built dynamically from the user's `surveyResults` (stored as `enabledMaladies` in Chrome storage) — only enabled types are ever detected
- **Image scanning:** When `lust_trigger` is enabled, `content.js` extracts up to 8 images strictly visible in the current viewport, ranked by visible area (largest/most prominent first). The server fetches each image, base64-encodes it, and makes a multimodal Gemini call. Flagged images are blurred in the DOM and get the same M dot + popover as text detections. Image maladies are logged to Firestore with a `logId` so feedback buttons work correctly.
- **interpret-struggles:** `/api/interpret-struggles` maps free-text user descriptions to malady IDs using Gemini — used in the onboarding freeform input

## Extension UX — Popup
- Shows `CONNECTED: <displayName>` (Google display name or email) — falls back to UID prefix only if name not yet synced
- Re-syncing the dashboard (visiting it) refreshes the stored name

## Extension UX — M Icon / Popover
- Hovering the M dot opens the popover; it **persists** when the mouse moves away
- Clicking × dismisses the marker permanently (removes from DOM, decrements count)
- Popover show/hide is CSS `visibility`+`opacity` toggled by a `.open` class (not `display:none`) to avoid the `mouseleave`/`mouseenter` race that caused flicker
- Popover is `position: fixed` (not `absolute`) — this escapes any `overflow: hidden` ancestor on host pages that would otherwise clip it
- `positionPopover(marker, popover)` in `content.js` is the single source of truth for coordinate calculation; used by `mouseenter`, `scrollToMalady`, and the scroll listener
- The scroll listener repositions all `.open` popovers on every scroll event so they track their dot
- `scrollToMalady` waits 500 ms after `scrollIntoView` before positioning + opening the popover, giving the smooth scroll animation time to settle
- `getBlockAncestor` includes `FIGURE` in its preferred tag set so image markers on Wikipedia-style sites (which wrap images in `<figure>`) attach next to the image rather than to a distant ancestor div
- Scan indicator calls `setScanIndicator(false, injectedCount)`: shows "M · CLEAR" for 1.2 s when a scan completes with 0 new threats, so users can distinguish a clean scan from a silent failure

## Dashboard UX Conventions
- **Stat cards** display `Math.round()` values — no decimals ever. Money uses a `$` prefix (e.g. `$7`), time/rage use a `min` suffix, viewpoints/urges/exposures have no unit. Six stat cards total in a 2/3/6-column responsive grid.
- **Log items** use a coloured left border matching their malady type: rabbit_hole=cyan, outrage_cycle=red, echo_chamber=green, buy_now=magenta, gambling_trigger=gold, lust_trigger=pink.
- **Feedback buttons** (thumbs up/down) call `updateLogFeedback` from `firebase.ts` directly; optimistic local state, toggling the same value clears the feedback.
- **`no-scan` CSS class** disables the `.tron-card::before` scan animation on high-volume elements (log items, skeletons) to avoid dozens of concurrent CSS animations.
- **Loading skeleton** (`LogsSkeleton`) is shown while the first Firestore `onSnapshot` resolves, controlled by `logsInitialized` state.
- **Empty logs state** is context-aware: different messages for "filter with no matches", "extension connected but no logs", and "extension not installed yet".
- **Mobile layout**: the Install Extension card renders above the logs list on small screens (duplicated with `block lg:hidden` / `hidden lg:block`).
- **Protection Focus editing**: The Protection Focus sidebar card has an Edit button. In edit mode, malady rows become clickable toggles with checkboxes; saving calls `updateSurveyResults` and re-syncs the extension immediately. At least one malady must be selected to save.
- **Onboarding (Survey)**: Hybrid flow — preset malady cards (quick-select) + optional freeform textarea. Freeform text is sent to `/api/interpret-struggles`; matched maladies are merged into the selection. Freeform field clears after interpretation; summary sentence displayed inline.

## Deployment

### Live Service
- **URL:** https://metanoia-stats-dashboard-797861117032.us-west1.run.app
- **GCP Project ID:** `gen-lang-client-0757426625`
- **Cloud Run service name:** `metanoia-stats-dashboard`
- **Region:** `us-west1`
- **Container image:** `gcr.io/gen-lang-client-0757426625/metanoia-dashboard`

### Environment Variables on Cloud Run
| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Google Gemini API key |
| `APP_URL` | The live service URL (used by dashboard to sync extension) |

Firebase Admin SDK uses ADC (no credentials file needed — Cloud Run's service account handles it). Ensure the service account `797861117032-compute@developer.gserviceaccount.com` has the `Cloud Datastore User` role in IAM.

### To Redeploy
Run these commands from the `MetanoiaExtensionAndStatsDashboard/` directory:

```bash
# 1. Build and push image
gcloud builds submit --tag gcr.io/gen-lang-client-0757426625/metanoia-dashboard

# 2. Deploy to Cloud Run
gcloud run deploy metanoia-stats-dashboard --image gcr.io/gen-lang-client-0757426625/metanoia-dashboard --platform managed --region us-west1 --allow-unauthenticated --set-env-vars "GEMINI_API_KEY=YOUR_GEMINI_KEY,APP_URL=https://metanoia-stats-dashboard-797861117032.us-west1.run.app"
```

### Notes
- `server.ts` reads `process.env.PORT` — Cloud Run injects `PORT=8080`
- `background.js` does NOT hardcode the API URL — it receives it from the dashboard via `chrome.storage` on sync
- The Dockerfile does a two-stage build: Stage 1 runs `npm run build` (React/Vite), Stage 2 runs the Express server

## Coding Conventions
- Functional React components with hooks only
- Tailwind CSS utility classes exclusively; "Tron" aesthetic uses `#00f2ff` (cyan), `#ff00ff` (magenta), `#050505` (near-black)
- All Gemini API calls must remain server-side in `server.ts`
- Use `handleFirestoreError` pattern for structured JSON error logs on Firebase operations
