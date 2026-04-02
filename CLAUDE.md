# CLAUDE.md - Metanoia Project Guide

## Project Overview
Metanoia is a digital wellness platform consisting of a Chrome extension and a web dashboard. It uses Gemini AI to detect "digital maladies" (manipulative patterns) in real-time as users browse, providing alerts, counter-perspectives, and tracking wellness metrics.

## Tech Stack
- **Frontend:** React 18, Vite, Tailwind CSS, Lucide Icons, Framer Motion.
- **Backend:** Node.js, Express (Full-stack setup).
- **Database/Auth:** Firebase (Firestore & Authentication).
- **AI:** @google/genai (Gemini 3 Flash).
- **Extension:** Manifest V3 (Vanilla JS/CSS for content/background).

## Architectural Overview
- `/src`: React dashboard application.
- `/server.ts`: Express entry point, handles API routes (`/api/scan`, `/api/feedback`) and Vite middleware.
- `/public/extension`: Chrome extension source code.
  - `content.js`: DOM scanning, icon injection, and highlighting.
  - `background.js`: API communication and WebSocket relay.
  - `popup.html/js`: Extension status and sync UI.
- `/src/firebase.ts`: Firebase configuration and data services.

## Coding Conventions
- **Components:** Use functional components with hooks.
- **Styling:** Tailwind CSS utility classes exclusively.
- **Icons:** Use `lucide-react`.
- **AI Calls:** Always use the `@google/genai` SDK on the server-side for scanning.
- **Error Handling:** Use `handleFirestoreError` for all Firebase operations to provide structured JSON error logs.

## Domain Terminology
- **Malady:** A manipulative digital pattern (Rabbit Hole, Outrage Cycle, Echo Chamber, Buy Now Reflex).
- **Metric:** Quantifiable wellness value (Time Saved, Money Saved, Viewpoints Provided, Rage Avoided).
- **Counter Perspective:** An alternative viewpoint provided for Echo Chambers to break algorithmic bias.
- **Sync:** The process of linking the extension to the web dashboard via UID.

## Important Commands
- `npm run dev`: Starts the Express server with Vite middleware on port 3000.
- `npm run build`: Builds the React app into `/dist`.
- `npm run lint`: Runs TypeScript type checking.

## Current Focus
- Refining extension accuracy and reducing false positives.
- Improving real-time feedback loops between the extension and dashboard.
- Enhancing the visual "Tron" aesthetic across all interfaces.
