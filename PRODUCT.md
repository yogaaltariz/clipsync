# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person: the owner, who uses an Android phone and a Mac at the same time throughout the day. This is a personal tool, not a product for other people. There is no second audience, no onboarding for strangers, and no marketing surface.

Situation: something small is on one device and needed on the other right now. A URL found on the phone that should open on the Mac. A verification code, a phone number, a shell command, a code snippet, a screenshot. The owner is mid-task and wants the transfer to cost almost nothing in attention.

Job: move a piece of clipboard content from one device to the other in fewer steps than messaging it to themselves.

Confirmed roles from the PRD: developer, designer, product manager. The owner is all three; the tool must be comfortable with code, commands, and screenshots as first-class content.

## Product Purpose

ClipSync is a lightweight web app and PWA that provides a shared, temporary clipboard history between the owner's Android phone and Mac over the local network.

It does not replace or monitor the system clipboard. The owner explicitly adds content on one device ("Paste from Clipboard") and explicitly copies it on the other. Every open instance updates in real time.

Success for the MVP, from the PRD:

1. Open ClipSync on Android and Mac on the same local network.
2. Add text from Android; it appears on Mac without a refresh; copy it there.
3. Same flow Mac to Android.
4. Share a PNG image between devices.
5. See recent history; clear history.

The transfer must take noticeably fewer interactions than Copy, open messenger, find self-chat, paste, send, open on other device, copy.

The product should feel like a temporary cross-device clipboard, not a chat app and not a notes app.

## Positioning

The mechanism a neighboring product cannot truthfully copy:

- **Local-only by architecture.** Content never leaves the owner's Wi-Fi. There is no cloud relay, no account, no third-party server. Messaging-to-self tools (WhatsApp, Telegram, email, cloud notes) all route through someone else's infrastructure.
- **Cryptographically paired devices, end-to-end encrypted.** Being on the same Wi-Fi is not authorization. Only the explicitly paired Mac and Android phone can read clipboard contents, and the server never sees plaintext. Apple Universal Clipboard is the closest experience but is Apple-only; ClipSync spans Android and macOS.
- **Clipboard semantics, not message semantics.** Newest first, bounded history, one-tap copy, automatic expiry. No threads, no read receipts, no sender/recipient framing.

Terminology to preserve: "clipboard item", "Paste from Clipboard", "Copy", "Clear History", "Pair", "Unpair", "paired device".

## Operating Context

- **Devices:** one Android phone and one Mac. Initial supported pairing configuration is exactly 1 Mac + 1 Android.
- **Network:** same local Wi-Fi. The Mac runs the server (example: `192.168.1.20:3000`); the phone opens the same instance.
- **Android:** installed as a PWA from Chrome. Launch goes straight to clipboard history. Standalone display, app icon, persistent device identity, fast startup.
- **Mac browsers (all confirmed as targets):** Chrome, Arc and other Chromium browsers, and Safari. Safari's Clipboard API is stricter (requires a user gesture, limits image writes), so the manual paste fallback and copy fallback are not optional edge cases; they are a supported path.
- **Content that flows through it:** URLs, verification codes, phone numbers, shell commands, code snippets, short messages, screenshots and other PNG images.
- **Usage rhythm:** many short bursts per day. Open, one action, close. Rarely browsed as an archive.
- **Device identity:** each browser generates a persistent device ID and a user-editable device name (examples from the PRD: "Yoga's Mac", "Pixel", "Work MacBook"). History shows the originating device.

## Capabilities and Constraints

### Confirmed MVP capabilities

- Single-screen main interface: header with connection status and device name, primary "Paste from Clipboard" action, recent items list newest first.
- Clipboard item shows content, content type, source device, relative creation time, and a Copy action. URLs get an additional Open action. Images show a preview.
- Manual paste area as fallback when the Clipboard API is unavailable or denied.
- Copy writes text or PNG to the system clipboard; brief "Copied" confirmation; fallback when writing is unsupported.
- Real-time sync over WebSocket. Perceived latency under 1 second on the same LAN.
- Connection status visible in the UI.
- History capped at 50 items; oldest auto-deleted along with any image blobs. "Clear History" deletes everything and propagates to both devices.
- Delete individual items.
- Device rename.

### Confirmed security scope (in the first build, not deferred)

The PRD's security appendix is binding for the MVP. The earlier "no user account required" line means no username/password account, not no authentication.

- **Device pairing:** Mac selects "Pair Phone", shows a QR code from a temporary, single-use, cryptographically random pairing session. Android scans it. Devices exchange identity; the pairing credential expires and cannot be reused. Pairing is only open while the owner has explicitly started it.
- **Device identity:** each installation holds its own private key, which never leaves the device and is never stored on the server.
- **End-to-end encryption:** text, URLs, images, and metadata where practical are encrypted before leaving the originating device. The server stores and routes ciphertext only. Reading the database without a paired device's key material must reveal nothing.
- **Authentication on every endpoint and the WebSocket.** Unauthenticated requests expose no content, history, images, or device details beyond what pairing strictly needs.
- **Unpair:** settings lists paired devices with an Unpair action. Unpairing revokes access immediately; re-pairing is required to reconnect.
- **Network exposure:** bind to local interfaces only. No automatic port forwarding, UPnP, or public tunneling.
- **Transport:** where browser APIs require a secure context, provide a local HTTPS strategy and use `wss` for WebSockets.
- **Logging:** clipboard content never appears in logs, access logs, analytics, or error reports. Operational metadata only (type, size, device).
- **Images:** never served from public URLs. Authenticated access, encrypted at rest.
- **Threat model to hold:** stranger on same Wi-Fi, someone with the server URL, someone who reads the database, someone who finds an old QR code, a previously paired phone that was removed, someone who inspects server logs. None of these get clipboard content.

### Explicit non-goals for MVP

- Automatic monitoring of the Android system clipboard.
- Automatically replacing the clipboard on the other device.
- File sync, internet sync, permanent cloud storage.
- Multiple users. Messaging or chat features. Bluetooth.
- Full parity with Apple Universal Clipboard.

### Technical direction (PRD recommendations, not yet confirmed by the owner)

- Frontend: Next.js + React (alternative Vue 3). Backend: Node.js. Storage: SQLite for metadata, encrypted binary files for images (not Base64 in the database).
- API: `POST /api/clipboard`, `GET /api/clipboard`, `DELETE /api/clipboard/:id`, `DELETE /api/clipboard`. WebSocket events `clipboard.created`, `clipboard.deleted`, `clipboard.cleared`.
- Architecture must separate clipboard storage/sync (the core server) from clipboard capture (web now, native companions later), so the web MVP remains the history and device-management interface when automatic sync arrives.

### Open decisions

- Final tech stack choice (see above).
- Local HTTPS approach (self-signed certificate, mkcert, or other).
- Image size limit. The PRD requires an "image too large" state but names no number.
- Whether "Universal Clipboard" ever appears in copy. It is Apple's feature name; the product name is ClipSync.

### Roadmap (recorded for direction, not MVP scope)

- V1.1: Android Share Target, QR device connection, rich URL previews, image compression, drag-and-drop upload, pinned items, search.
- V1.2: native Android and macOS companions for automatic clipboard sync over LAN.
- V2: copy on one device, paste on the other, with the web app remaining as history and device management.

## Brand Commitments

- **Name:** ClipSync. Confirmed by the owner. Header copy in the PRD mockups reads "Shared Clipboard"; that phrase may survive as a description but the product name is ClipSync.
- **Visual authority:** the owner explicitly directed this init "based on DESIGN.md". The existing `DESIGN.md` (titled "Visitors — Style Reference", a white engineering-blueprint system: OpenRunde type, Carbon text on Paper White, hairline Fog borders, pill controls, single Lavender action color) is the binding visual constraint for this project. It was authored for a different product (an analytics tool) and is adopted here as-is. Init records this and does not expand or reinterpret it; new-work applies it.
- **Voice (from PRD copy):** plain, short, reassuring, second person. Example lines that are confirmed product copy: "Your clipboard stays on your local network." "Make sure your devices are connected to the same Wi-Fi network." "Clipboard access isn't available. Paste your content manually instead." "This clipboard format isn't supported yet." "This image is too large to share." "✓ Copied".
- **Icon:** PRD shows a clipboard glyph (📋) as the PWA home-screen icon placeholder. No final icon asset exists.

## Evidence on Hand

- `PRD.md`: full product requirements including flows, item model, API, WebSocket events, error states, PWA requirements, roadmap, and the security and privacy appendix with threat model.
- `DESIGN.md`: the adopted style reference (tokens, type scale, components, do/don't, gradients).
- No code exists yet. No logo, no screenshots, no icon assets.
- No testimonials, customers, usage numbers, or benchmarks exist, and none should be fabricated. This is a personal tool; the only proof that matters is the owner's own two devices working.
- Latency target from the PRD: under 1 second perceived on LAN. Not yet measured.

## Product Principles

1. **One action per device.** Add on one, copy on the other. Any screen, control, or copy that adds a step between those two actions is working against the product.
2. **Same Wi-Fi is not trust.** Pairing, per-device keys, end-to-end encryption, and authenticated transport are core features, not hardening to do later. Security state (paired, connected, encrypted) should be legible in the UI without being loud.
3. **Clipboard, not inbox.** Content is temporary by design. Newest first, bounded history, easy clearing. Nothing about the interface should invite hoarding or scrolling back.
4. **Fallbacks are the product on Safari.** Clipboard API behavior differs by browser and gesture. Manual paste and copy fallbacks must feel like a normal path, not an error.
5. **Web MVP is the long-term control surface.** Design the history and device-management UI so it still makes sense when automatic native sync removes the "Paste from Clipboard" step.

## Accessibility & Inclusion

- The primary action must be reachable one-handed on a phone. The PRD states it "should be highly accessible, especially on mobile."
- Clipboard API calls that require a user gesture must be triggered by real button presses, which also keeps them keyboard and switch-access friendly.
- Connection and copy state changes must be announced, not only shown by color, since Mint and Ember carry meaning in the adopted palette.
- No other product-specific accessibility standard has been established.
