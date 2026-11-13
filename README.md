# THRESHOLD XR

A cold, clinical, black-and-white **passthrough AR psychological endurance horror**
experience for WebXR headsets (Meta Quest / Pico), with a flat-screen fallback.

Survive the timer in total silence while a spatial threat director analyses the geometry
of your real room and weaponises it: blind spots, doorway occlusions, uninspected seams,
and the space you just cleared. Threats are staged 55–105° off-axis so they register only
after they move.

---

## Requirements

- Node.js 20+ (developed against v24) — `tsx` is used to run the TypeScript server directly
- A WebXR headset for AR mode (Quest 2/3, Pico); any modern browser for flat mode
- **HTTPS** for AR: `immersive-ar` requires a secure context

## Quick start

```bash
bun install                 # or npm install
./node_modules/.bin/vite build
HTTPS=1 NODE_ENV=production ./node_modules/.bin/tsx server.ts
```

Open `https://<your-lan-ip>:3000` and press **WebXR AR**.

For the full LAN/headset setup — mkcert CA creation, trusting it on the headset, and the
USB `adb reverse` path that avoids certificates entirely — see **[RUN-LAN.md](RUN-LAN.md)**.

> `npm start` (`node server.ts`) does **not** work: `server.ts` imports `./src/engine/spatial`
> without a file extension and plain Node ESM requires one. Use `tsx`.

### Environment

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Listen port |
| `HTTPS` | unset | Set to `1` to serve TLS (required for WebXR on a remote device) |
| `SSL_KEY_PATH` | `.certs/lan-key.pem` | TLS private key |
| `SSL_CERT_PATH` | `.certs/lan.pem` | TLS certificate |
| `NODE_ENV` | — | `production` serves the built `dist/`; otherwise Vite middleware |
| `GEMINI_API_KEY` | unset | Optional. Without it the director uses the local spatial scorer |
| `GEMINI_MODEL` | `gemini-4-hydrogen` | Optional model override |

## Playing

| Input | Action |
|---|---|
| `Enter` / `Space` (title) | Start a run |
| `W A S D` / arrows | Move (flat mode); left thumbstick in AR |
| Mouse drag, `Q`/`E` | Look (flat mode); head tracking in AR |
| `M` | Mute |
| `V` | Simulate a vocal spike (debug) |
| `Esc` / `P` | Pause |
| Headset menu/back | Exit the AR session |

Duration (1/3/5/10 min), room preset, mic sensitivity and camera passthrough are chosen on
the title screen. Microphone monitoring is optional: with it on, sub-threshold gasps feed the
director and a loud enough breach ends the run.

## Architecture

```
server.ts                 Express: /api/health, /api/ai/analyze-room, static/SPA, optional TLS
src/App.tsx               React shell, 10 Hz director loop, shell state machine
src/engine/director.ts    Horror phases, threat scheduling, tension telemetry
src/engine/spatial.ts     Slot extraction, occlusion, gaze sectors, local scare scoring
src/engine/webxrSpatial.ts Room reconstruction from WebXR detected planes
src/engine/acoustics.ts   Mic RMS/onset/ZCR analysis, adaptive floor calibration
src/three/RoomRenderer.ts Three.js scene, camera, XR session, threat animation
src/three/threatRigs.ts   Declarative entity rigs (data, not code)
src/audio/horrorAudio.ts  Web Audio: room tone, atmosphere, stingers, spatial cues
src/components/           Title screen, HUD, blueprint modal, outcome overlay
```

### Tuning

- **Entity silhouettes** — `src/three/threatRigs.ts`. Each threat is a list of named parts
  (shape, material, transform). Raise `segments` for smoother surfaces, swap shapes, or set
  a rig's `modelUrl` to substitute a real mesh later. Animation addresses parts by name, so
  no other file needs to change.
- **Scare cadence** — `src/engine/director.ts`: `computeHorrorPhase()` sets the phase
  thresholds; `createDirectorState()` sets the first event/anomaly delays.
- **Atmosphere** — `src/audio/horrorAudio.ts`: `startAtmosphere()` builds the reverb, air and
  sub layers; `scheduleAtmosphereEvent()` controls the rate of distant creaks.

## Security notes

- `.certs/` holds the development **CA private key** and is gitignored. Never commit it.
- The dev TLS certificate is for LAN/headset testing only, not for public exposure.

## Status

Flat mode is fully playable. AR mode requires HTTPS plus a trusted certificate (or the
`adb reverse` workaround); see RUN-LAN.md. Gemini is optional — the local scorer is the
default path.
