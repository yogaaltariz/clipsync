# ClipSync

A personal, end-to-end encrypted clipboard sync between your Mac and your Android phone. No cloud, no accounts — everything stays on your local Wi-Fi network.

Copy something on one device, tap a button, and it shows up on the other in under a second. Share text, links, and images.

## How it works

Your Mac runs a small local server. Both devices talk to it directly over your Wi-Fi — nothing ever leaves your network. Each device generates its own private encryption key on first launch and those keys never leave the device; the server only ever sees encrypted content it can't read.

## Requirements

- Node.js 20 or newer
- [mkcert](https://github.com/FiloSottile/mkcert) (`brew install mkcert`) — used to create a locally-trusted HTTPS certificate. This is required: browsers block camera access and clipboard APIs on plain HTTP for any address other than `localhost`, and pairing needs the camera.
- A Mac and an Android phone on the same Wi-Fi network

## Setup

Install dependencies once:

```bash
npm install                          # root workspace (frontend + Nx tooling)
cd apps/clipsync-server && npm install
```

Build the web app (do this once, and again any time the frontend code changes):

```bash
cd apps/clipsync-web
npm run build
```

Set up mkcert's local certificate authority once per machine:

```bash
mkcert -install
```

## Running it

From `apps/clipsync-server`:

```bash
npm run dev:lan
```

This single command:

1. Detects your Mac's current Wi-Fi IP address
2. Generates a fresh HTTPS certificate for that address (mkcert)
3. Prints a QR code in your terminal — scan it with your phone's camera app to jump straight to the site (this just opens the link, it isn't the pairing code)
4. Starts the server, reachable from any device on your Wi-Fi

Leave this running. If your Mac's IP changes (different Wi-Fi network, router restart), just run it again — it regenerates everything automatically.

### Running for real use (not iterating on code)

`dev:lan` is a development command (auto-restarts on file changes). For everyday use, build once and run the compiled server instead — same idea, slightly more steps:

```bash
cd apps/clipsync-server
npm run build
mkcert -cert-file cert.pem -key-file key.pem $(ipconfig getifaddr en0) localhost 127.0.0.1
CLIPSYNC_TLS_CERT=$(pwd)/cert.pem CLIPSYNC_TLS_KEY=$(pwd)/key.pem CLIPSYNC_BIND_HOST=0.0.0.0 npm start
```

## Pairing your two devices

The first time, each device needs to be told what it is:

1. **On the Mac**, open the printed URL (or scan the terminal QR) in a browser. Choose **"This is my first device"**. A QR code appears on screen.
2. **On the phone**, open the same URL in a browser. You'll get a certificate warning the first time (the phone doesn't trust your mkcert certificate yet) — tap through it (**Advanced → Proceed anyway** on Chrome). Choose **"Join an existing pair"**, then point the camera at the Mac's QR code.
3. Both screens confirm **"Device paired"**. Tap **Go to Clipboard** on each.

Only two devices can be paired at a time, matching the personal Mac + phone use case. Unpair a device from **Settings** if you need to pair a different one.

To avoid the certificate warning on the phone every time: run `mkcert -CAROOT` on the Mac, transfer the `rootCA.pem` file it points to onto the phone, and install it under **Settings → Security → Install a certificate**.

## Using it

- **Send something:** copy text or an image on one device, then tap **Paste from Clipboard** in the app. It appears on the other device almost instantly.
- **Receive something:** tap **Copy** next to any item to put it back on that device's system clipboard. Tap an image to view it full-size, copy, or delete it.
- **History:** the last 50 items are kept, oldest dropped automatically. Clear everything from **Settings → Clear Clipboard History**.
- Clipboard access must be explicitly granted by the browser the first time you tap "Paste from Clipboard" — if it's denied, the app falls back to a manual paste box.

## Project structure

```
apps/
  clipsync-server/   Node/Express backend — pairing, auth, storage, WebSocket sync
  clipsync-web/       React frontend — the screens described above
```

The two are independent npm packages; the frontend is included in the root Nx/npm workspace, the backend is not (see `apps/clipsync-server/docs/LOCAL_HTTPS.md` for why HTTPS is required).

## Known limitations

This is a personal MVP, not a finished product:

- Images are shared as plain files between devices — text and links are end-to-end encrypted, images currently are not (both still never leave your local network).
- Devices are always paired by camera-scanning a QR code shown on the other device; there's no manual pairing-code fallback yet.
- Device names are auto-detected from the browser and can't be renamed.
- Sync only happens while the app is open in a browser tab — there's no background/native clipboard watcher (that would need a native app, not a web app).

## Security notes

- The server binds to `127.0.0.1` (not reachable from your network) unless you explicitly set `CLIPSYNC_BIND_HOST`, so nothing is exposed by accident.
- All clipboard content is encrypted on-device before it's sent, using a key derived from an X25519 key exchange between your two paired devices (HKDF + AES-256-GCM). The server stores and relays ciphertext it cannot decrypt.
- Requests are signed with each device's private Ed25519 key; private keys never leave the device that generated them.
- Pairing codes are single-use and expire after two minutes.
