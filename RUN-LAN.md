# Running THRESHOLD XR on the LAN (Quest / Pico)

WebXR `immersive-ar` **requires a secure context**, so the dev server must speak HTTPS.
`server.ts` speaks HTTPS when `HTTPS=1` is set (`npm run dev:https` does this). It reads
`.certs/lan-key.pem` + `.certs/lan.pem` by default, overridable with `SSL_KEY_PATH` /
`SSL_CERT_PATH`. Without `HTTPS=1` it serves plain HTTP and WebXR is unavailable on any
remote device.

## 1. One-time: create the local CA and certificate

Uses [mkcert](https://github.com/FiloSottile/mkcert). No root required for generation.

```bash
mkdir -p .certs
./mkcert -cert-file .certs/lan.pem -key-file .certs/lan-key.pem \
  192.168.86.30 localhost 127.0.0.1 ::1
```

Replace `192.168.86.30` with the current LAN IP (`hostname -I`). Re-run this command
whenever the IP changes, then restart the server. The CA itself (`rootCA.pem`) stays the same.

## 2. Build and run

```bash
bun install
./node_modules/.bin/vite build
HTTPS=1 NODE_ENV=production ./node_modules/.bin/tsx server.ts
```

Expect: `THRESHOLD server listening on https://0.0.0.0:3000 (WebXR secure context)`

Overrides: `PORT`, `HTTPS`, `SSL_KEY_PATH`, `SSL_CERT_PATH`. If no cert files are found,
a self-signed cert with SANs for localhost + every LAN IPv4 is generated — usable, but the
headset will warn and WebXR may refuse; mkcert is the reliable path.

> `npm start` (`node server.ts`) does **not** work: `server.ts` imports `./src/engine/spatial`
> without a file extension, and plain Node ESM needs one. Use `tsx`.

## 3. Trust the CA on the headset

Copy `.certs/threshold-xr-ca.crt` (DER) or `.certs/threshold-xr-ca.pem.crt` (PEM) to the device.

**Quest** (developer mode + USB debugging on):

```bash
adb push .certs/threshold-xr-ca.crt /sdcard/Download/
adb shell am start -n com.android.settings/.Settings
```

Then: Security → Encryption & credentials → Install a certificate → CA certificate →
Download → `threshold-xr-ca.crt`.

**Do not** rely on clicking through the browser's certificate warning: a page whose TLS
error was manually bypassed is not guaranteed to be a secure context, so WebXR may still refuse.
Install the CA instead.

## 4. Enter AR

Open `https://192.168.86.30:3000` in Meta Quest Browser → **WebXR AR**. The session starts,
the virtual room hides, real passthrough shows, and the room is rebuilt from detected planes.
Pressing the headset's menu/back button ends the session and restores the flat view.

## 5. Alternative: USB tunnel, no certificates at all

If the headset is on a different network or SSID, or you would rather skip the CA install,
forward the port over USB instead. `http://localhost` is a **secure context by
specification**, so WebXR works over plain HTTP with no certificate whatsoever.

```bash
adb reverse tcp:8080 tcp:8080                     # on the host, headset plugged in + USB debugging
PORT=8080 NODE_ENV=production ./node_modules/.bin/tsx server.ts   # plain-HTTP instance
```

Then open `http://localhost:8080` in Quest Browser and press **WebXR AR**.

Notes:

- The tunnel only lives while the cable is connected and the adb server runs; recreate it
  after unplugging.
- `localhost` on the headset is the headset, not your machine — this mapping is what makes it
  work.
- Run the HTTPS instance on `PORT=3000` at the same time if you want both paths available.

## 6. Verifying on the headset without seeing it

The Quest Browser exposes a Chrome DevTools socket, which makes real verification possible
without a screenshot:

```bash
adb forward tcp:9222 localabstract:chrome_devtools_remote
curl -s http://127.0.0.1:9222/json | head -40     # list tabs + webSocketDebuggerUrl
```

Then drive it over CDP (`Runtime.evaluate`, `Input.dispatchMouseEvent`,
`Page.captureScreenshot`). Two gotchas learned the hard way:

- `navigator.xr.isSessionSupported()` **never settles while the page is hidden**
  (`document.visibilityState === 'hidden'`, i.e. the browser panel is not displayed), so
  `enterWebXRPassthrough()` awaits forever and the AR button silently does nothing.
- `isSessionSupported('immersive-ar')` also returns **false while the headset is off-head**
  (`mWakefulness=Asleep`), because Quest suspends XR when nobody is wearing it. Waking it
  with `adb shell input keyevent KEYCODE_WAKEUP` is not enough; it has to be worn.
- Old tabs persist and will happily serve a stale bundle — check
  `document.querySelector('script[type=module]').src` against `dist/assets/` when a change
  seems to have no effect.

## Notes

- The HUD stays on screen only if the browser supports the optional `dom-overlay` feature.
  If it is unsupported the session still runs, just without the 2D HUD.
- `.certs/` contains the CA **private key**. It is gitignored — never commit or share it.
- No `GEMINI_API_KEY` is required: the Spatial Director falls back to the local scorer.
