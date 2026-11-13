# Changelog

All notable changes to THRESHOLD XR are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-12

Headset bring-up pass: the build now actually runs in passthrough AR on a Quest 2, and the
experience has atmosphere, motion and a much shorter wait before the first scare.

### Added

- **Declarative threat rigs** (`src/three/threatRigs.ts`): every entity silhouette is now
  data — named parts with shape, material and transform — instead of ~226 lines of hard-coded
  mesh construction. Animation addresses parts by name, so a future redesign (smoother
  surfaces, sculpted geometry, or a substituted GLTF model via `modelUrl`) only touches this
  one file. Includes an exported `THREAT_RIGS` table and a `buildThreatRig()` instantiator.
- **Limb joints and capsules**: arms and legs are split into upper/lower segments with
  explicit elbow/knee spheres and 16-segment capsules, so figures taper and bend rather than
  reading as stacked cylinders.
- **Atmospheric audio bed** (`src/audio/horrorAudio.ts`): procedurally generated reverb
  impulse, breathing air layer with slow filter sweep, 27.5 Hz sub-harmonic swell with its
  own amplitude LFO, and randomised distant creaks panned around the listener. All layers
  scale with dread and are torn down with the room tone. No audio assets are shipped.
- **Manifest stinger**: a sub-drop plus air transient, panned to the threat's azimuth, fired
  the instant an entity first appears so a silent reveal is never missed.
- **AR dimming overlay**: a camera-locked black plane billboarded from the real head pose,
  so the Compression phase can close the world in during passthrough. Previously all
  dimming was silently skipped in XR.
- `README.md` and this changelog; `RUN-LAN.md` headset setup guide.

### Changed

- **Threat materials**: bodies are true void (`0x000000`, roughness 1.0) so they absorb light
  and read as a hole in passthrough; skin carries a cold self-lit edge (`emissive` 0.85) that
  survives a bright camera feed; eyes went from `emissiveIntensity` 0.35 to 2.6 and grew
  0.011–0.017 m → 0.016–0.023 m so they read as pinpoint glow.
- **`CeilingHang` redesigned**: torso stretched shot past human proportion, drooping head
  with glowing eyes (it previously had none), arms lengthened, and palms with four splayed
  fingers per hand added — hands hang ~2.4 m below the anchor.
- **Reveal curve**: `manifestation` is eased with `pow(m, 1.7)`, so entities stay concealed
  longer and then are simply *there*.
- **Idle motion**: every entity now has a deterministic per-threat tremor, sway and body roll
  (`threatMotionSeed()`), so nothing is ever perfectly still.
- **Pacing**: `Baseline` shortened from 12% to 5% of the run, first-threat delay from
  `max(7, dur*0.13)` to `max(4.5, dur*0.055)`, first-anomaly delay from
  `max(5.5, dur*0.08)` to `max(3.5, dur*0.05)`. First threat now arrives at ~10 s on a 3-minute
  run (was ~23.4 s) and ~4.5 s on 1 minute (was ~7.9 s).
- Rig scale is applied on an inner group so per-frame animation scale composes with it
  instead of clobbering it. Standing figures are now ~2.10 m.

### Fixed

- **Express 4 catch-all route**: `app.get('/{*splat}')` is Express 5 / path-to-regexp v8
  syntax and returned 404 for every non-root path on Express 4.22. Now `'*'`.
- **HTTPS certificate had no SAN**: the self-signed fallback used `-subj /CN=localhost`,
  which browsers ignore for hostname matching since Chrome 58, and which could never match a
  LAN IP. It now emits `-addext subjectAltName=` covering `localhost`, `127.0.0.1` and every
  non-internal IPv4, and prefers mkcert material at `.certs/lan.pem` when present.
- **`PORT` was hardcoded** to 3000; now `Number(process.env.PORT) || 3000`, which allows
  running an HTTPS and a plain-HTTP instance side by side for diagnosis.
- **AR had no dimming at all**: `setPassthroughDimness()` early-returned whenever an XR
  session was active, because fog and tone-mapping exposure cannot darken composited
  passthrough. The overlay above closes that gap.
- `.gitignore` now excludes `.certs/`, `mkcert` and `.chrome-profile/` — `.certs/` contains
  the development CA **private key**.

### Notes

- Verified: `tsc --noEmit` clean, production build clean, `POST /api/ai/analyze-room` over
  HTTPS across three room presets, TLS chain validation, and headless-Chrome render.
- Not verified in this pass: the in-headset immersive session, `dom-overlay` HUD support,
  and the subjective mix level of the new audio/visuals — these need a real headset.

[Unreleased]: https://github.com/DTRHnet/Threshold-XR/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/DTRHnet/Threshold-XR/releases/tag/v0.1.0
