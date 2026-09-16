# Product Requirements Document

## Cross-Device Shared Clipboard

**Status:** Draft
**Version:** 0.1
**Platform:** Web / PWA
**Primary Devices:** Android + macOS
**Network:** Local network / same Wi-Fi
**Initial Content Types:** Text, URLs, Images

---

## 1. Overview

Cross-Device Shared Clipboard is a lightweight web application that allows users to share clipboard content between devices connected to the same local network.

The initial use case focuses on Android phones and Mac computers.

Instead of automatically replacing the system clipboard, the application provides a shared clipboard history accessible from both devices. Users can add content from one device and immediately access and copy it from another.

Example:

**Android → Mac**

1. User copies text on Android.
2. User opens Shared Clipboard.
3. User taps **Paste from Clipboard**.
4. The content appears in the shared clipboard history.
5. The open Shared Clipboard page on Mac updates automatically.
6. User clicks **Copy** on Mac.
7. User can paste the content into any Mac application.

The same flow should work in the opposite direction.

---

# 2. Problem

Moving small pieces of information between Android and macOS is unnecessarily cumbersome.

Common examples include:

* URLs
* verification codes
* phone numbers
* code snippets
* commands
* messages
* screenshots
* images

Users commonly solve this by sending content to themselves through messaging applications, email, cloud notes, or other third-party services.

This introduces unnecessary steps:

**Current flow**

Copy → Open messaging app → Find self/private chat → Paste → Send → Open messaging app on other device → Copy → Paste

The desired experience is:

**Shared Clipboard**

Copy → Add to Shared Clipboard → Copy on another device

---

# 3. Product Goal

Provide the fastest simple way to move clipboard content between Android and macOS without requiring users to send messages to themselves.

The product should feel like a temporary cross-device clipboard rather than a messaging application.

---

# 4. Non-Goals

The MVP will NOT attempt to:

* automatically monitor the Android system clipboard
* automatically replace the clipboard on another device
* synchronize files
* synchronize clipboard content through the internet
* provide permanent cloud storage
* support multiple users
* provide messaging/chat functionality
* require Bluetooth
* replicate Apple Universal Clipboard completely

These capabilities may be considered for later versions.

---

# 5. Target User

### Primary User

A person who regularly uses an Android phone and a Mac computer simultaneously.

Typical scenarios include:

* developers
* designers
* product managers
* office workers
* users working across phone and desktop

### Example

A developer finds a URL on their Android phone and wants to open it on their Mac.

Instead of sending it through WhatsApp or another application, they add it to Shared Clipboard and immediately retrieve it from the Mac.

---

# 6. Core Concept

All connected devices share one temporary clipboard history.

```text
              LOCAL NETWORK

       ┌──────────────────────┐
       │   Clipboard Server   │
       │                      │
       │   Clipboard History  │
       └──────────┬───────────┘
                  │
          WebSocket / HTTP
             ┌────┴────┐
             │         │
             ▼         ▼

        Android       Mac
          PWA        Browser
```

When a clipboard item is added from one device, all connected clients receive the new item immediately.

---

# 7. MVP Requirements

## 7.1 Device Connection

Users must be able to access Shared Clipboard from multiple devices on the same local network.

Example:

```text
Mac server:

192.168.1.20:3000
```

The Android device opens the same Shared Clipboard instance.

### Requirements

* Devices must be on the same network.
* No user account is required.
* The UI should show whether the device is connected.
* Clipboard updates should appear without manually refreshing the page.

---

# 8. Clipboard History

The main interface displays recently shared clipboard items.

Each item should contain:

* content
* content type
* source device
* creation time
* copy action

Example:

```text
Shared Clipboard
────────────────────────────────

Android • Just now

docker compose up -d

                         [ Copy ]

────────────────────────────────

Mac • 2 min ago

https://example.com

                         [ Copy ]

────────────────────────────────

Android • 5 min ago

┌─────────────────────────────┐
│                             │
│        Image Preview        │
│                             │
└─────────────────────────────┘

                         [ Copy ]
```

Newest clipboard items appear first.

---

# 9. Adding Clipboard Content

The primary action is:

**Paste from Clipboard**

When triggered, the application attempts to read the current system clipboard.

Supported MVP content:

### Text

Examples:

* plain text
* code
* phone numbers
* commands

### URL

URLs use the same underlying text format but may receive special UI treatment.

Example:

```text
github.com/example/project

[Open]                       [Copy]
```

### Image

Supported initial format:

* PNG

Additional browser-supported formats may be added later.

The application should display a preview of the image before or after adding it.

---

# 10. Manual Paste Fallback

Clipboard APIs may behave differently depending on browser, operating system, permissions, and security context.

Therefore, the application must provide a fallback.

Example:

```text
┌─────────────────────────────────┐
│ Paste something here...         │
│                                 │
│                                 │
└─────────────────────────────────┘

             [ Add to Clipboard ]
```

Users can manually paste text or images into this area when direct clipboard reading is unavailable.

---

# 11. Copying Content

Each clipboard item provides a **Copy** action.

For text:

**Copy** writes the text to the system clipboard.

For images:

**Copy** attempts to write the image into the system clipboard.

After successful copying:

```text
✓ Copied
```

should briefly replace or accompany the Copy action.

If direct clipboard writing is unsupported, the application should provide an appropriate fallback.

---

# 12. Real-Time Synchronization

New clipboard items should appear on connected devices immediately.

Recommended transport:

**WebSocket**

Example:

```text
Android

Add clipboard
      │
      ▼
POST /clipboard
      │
      ▼
Server
      │
      ├──── WebSocket ────► Mac
      │
      └──── WebSocket ────► Android
```

Expected perceived update latency on the same local network:

**< 1 second**

under normal conditions.

---

# 13. Clipboard Item Model

Example:

```json
{
  "id": "clip_abc123",
  "type": "text/plain",
  "content": "docker compose up -d",
  "deviceId": "android_123",
  "deviceName": "Android",
  "createdAt": "2026-09-16T13:00:00+07:00"
}
```

Image example:

```json
{
  "id": "clip_def456",
  "type": "image/png",
  "contentUrl": "/uploads/clip_def456.png",
  "deviceId": "android_123",
  "deviceName": "Android",
  "createdAt": "2026-09-16T13:01:00+07:00"
}
```

Images should be stored as binary files rather than Base64 strings inside the database.

---

# 14. Device Identification

Each browser generates a persistent device ID.

Example:

```text
deviceId:
d3c802a7-...

deviceName:
Yoga's Mac
```

The identifier can be stored locally using browser storage.

Users should be able to rename their device.

Examples:

* Yoga's Mac
* Pixel
* Work MacBook
* Android Phone

Clipboard history should display the originating device.

---

# 15. History Retention

The application is designed as temporary storage.

MVP recommendation:

**Maximum 50 clipboard items.**

When the limit is exceeded, the oldest items are automatically deleted.

Image files associated with deleted items must also be removed.

Users should also have:

**Clear History**

which deletes all clipboard items.

---

# 16. Security

Because clipboard contents can contain sensitive information, security should be considered a core product requirement.

The server should:

* listen only on the local network
* not upload clipboard contents to external services
* avoid analytics containing clipboard content
* prevent arbitrary external network access where possible

The UI should communicate:

**Your clipboard stays on your local network.**

Future versions should consider encryption between devices.

---

# 17. Suggested Technical Architecture

## Frontend

Recommended:

**Next.js + React**

Alternative:

**Vue 3**

Responsibilities:

* clipboard interaction
* clipboard history
* image preview
* device identification
* connection status
* WebSocket connection
* PWA installation

---

## Backend

Recommended:

**Node.js**

Responsibilities:

* clipboard API
* WebSocket server
* clipboard history
* image storage
* device tracking
* history cleanup

---

## Database

Recommended for MVP:

**SQLite**

Example:

```text
clipboard_items

id
type
text_content
file_path
device_id
device_name
created_at
```

SQLite avoids requiring an external database service.

---

# 18. Proposed API

### Add clipboard item

```text
POST /api/clipboard
```

Text payload:

```json
{
  "type": "text/plain",
  "content": "Hello",
  "deviceId": "device_123"
}
```

Images use multipart upload.

---

### Get clipboard history

```text
GET /api/clipboard
```

---

### Delete clipboard item

```text
DELETE /api/clipboard/:id
```

---

### Clear clipboard

```text
DELETE /api/clipboard
```

---

# 19. WebSocket Events

### New clipboard

```text
clipboard.created
```

Payload:

```json
{
  "id": "clip_123",
  "type": "text/plain",
  "content": "Hello",
  "deviceName": "Android"
}
```

### Clipboard deleted

```text
clipboard.deleted
```

### Clipboard cleared

```text
clipboard.cleared
```

---

# 20. Main Screen

The application should primarily be a single-screen experience.

```text
┌────────────────────────────────────┐
│ 📋 Shared Clipboard       ● Online │
│                                    │
│ Yoga's Android                     │
├────────────────────────────────────┤
│                                    │
│       Paste from Clipboard         │
│                                    │
├────────────────────────────────────┤
│ RECENT                             │
│                                    │
│ docker compose up -d               │
│ Android · Just now          [Copy] │
│                                    │
│ ────────────────────────────────── │
│                                    │
│ https://github.com/...             │
│ Mac · 3m                     [Copy]│
│                                    │
│ ────────────────────────────────── │
│                                    │
│ ┌──────────────────────────────┐   │
│ │                              │   │
│ │       Screenshot             │   │
│ │                              │   │
│ └──────────────────────────────┘   │
│ Android · 8m                [Copy] │
│                                    │
└────────────────────────────────────┘
```

The primary action should be highly accessible, especially on mobile.

---

# 21. PWA

The web application should be installable as a Progressive Web App.

On Android:

```text
Home Screen

┌──────────┐
│    📋    │
│ ClipSync │
└──────────┘
```

Launching the PWA should open directly to clipboard history.

The PWA should provide:

* standalone display
* app icon
* persistent device identity
* fast startup
* responsive mobile interface

---

# 22. Error States

### Server unavailable

```text
Unable to connect

Make sure your devices are connected
to the same Wi-Fi network.

[Retry]
```

### Clipboard permission denied

```text
Clipboard access isn't available.

Paste your content manually instead.
```

### Unsupported clipboard content

```text
This clipboard format isn't supported yet.
```

### Image too large

```text
This image is too large to share.
```

---

# 23. MVP Success Criteria

The MVP is considered successful when a user can:

1. Open Shared Clipboard on Android and Mac.
2. Connect both devices through the same local network.
3. Add text from Android.
4. See it appear automatically on Mac.
5. Copy the text from Mac.
6. Perform the same workflow from Mac to Android.
7. Share a clipboard image between devices.
8. Access recent clipboard history.
9. Clear clipboard history.

The entire transfer should require significantly fewer interactions than sending the content through a messaging application.

---

# 24. Future Improvements

## V1.1 — Better Sharing

* Android Share Target
* QR code device connection
* rich URL previews
* image compression
* drag-and-drop image upload
* pinned clipboard items
* search clipboard history

## V1.2 — Native Companion

Introduce lightweight native applications to enable:

**Automatic clipboard synchronization**

```text
Copy on Android
      ↓
Automatically detected
      ↓
Sent over LAN
      ↓
Mac clipboard updated
      ↓
⌘V
```

This removes the requirement to manually press **Paste from Clipboard**.

## V2 — Universal Clipboard

Long-term experience:

```text
Android

Copy
 ↓
 ↓  Local network
 ↓
Mac

⌘V
```

No web interface interaction would be required for normal clipboard transfers.

The web application could remain available as the clipboard history interface.

---

# 25. Product Direction

The architecture should separate **clipboard storage/synchronization** from **clipboard capture**.

```text
                 Shared Clipboard Core

                  ┌─────────────┐
                  │   Server    │
                  │             │
                  │ History     │
                  │ Sync        │
                  │ Storage     │
                  └──────┬──────┘
                         │
              ┌──────────┴──────────┐
              │                     │
             Web                 Native
              │                     │
       Manual clipboard       Automatic clipboard
           sharing                 sync
```

This allows the initial web MVP to remain useful even if native Android and macOS companion applications are introduced later.

The web application therefore serves two purposes:

**MVP:** manual cross-device clipboard sharing.

**Long term:** clipboard history and device management interface for an automatic Universal Clipboard system.


# Security & Privacy Requirements

The Shared Clipboard is designed for synchronization between **one user's Mac and Android phone**.

Clipboard data must be treated as highly sensitive because it may contain passwords, authentication codes, private URLs, source code, personal messages, or images.

Being connected to the same local network **must not be sufficient authorization** to access clipboard data.

## Device Pairing

Only explicitly paired devices may access the clipboard.

The initial supported configuration is:

**1 Mac + 1 Android phone**

A new device must complete a pairing process before it can read, create, modify, or delete clipboard items.

Recommended pairing flow:

1. User opens Shared Clipboard on Mac.
2. Mac selects **Pair Phone**.
3. Mac generates a temporary pairing session.
4. Mac displays a QR code.
5. User opens Shared Clipboard on Android.
6. User scans the QR code.
7. Both devices exchange cryptographic identity information.
8. Pairing is confirmed.
9. Both devices store the established device identity locally.
10. The temporary pairing credential expires and cannot be reused.

The QR code must not contain long-lived private encryption keys.

---

## Device Identity

Each installation generates its own cryptographic identity.

Private keys must remain on the device that generated them.

They must never be transmitted to the other device or stored on the clipboard server.

Example:

```text
Android
├── Device ID
├── Private key 🔐
└── Mac trusted identity

Mac
├── Device ID
├── Private key 🔐
└── Android trusted identity
```

The server should only receive the information necessary to authenticate devices and route encrypted clipboard data.

---

## End-to-End Encryption

Clipboard contents should be encrypted before leaving the originating device.

```text
Android

"docker compose up -d"
        ↓
     Encrypt
        ↓
"9fd2a7c81...."
        ↓
       LAN
        ↓
       Mac
        ↓
     Decrypt
        ↓
"docker compose up -d"
```

The server must not need access to plaintext clipboard content.

This applies to:

* text
* URLs
* images
* clipboard metadata where practical

If encrypted history is stored on disk, compromising or reading the server's clipboard database should not reveal the clipboard contents without access to an authorized device's cryptographic material.

---

## Authentication

Every clipboard API and real-time connection must require authentication from a paired device.

Protected operations include:

```text
GET    /api/clipboard
POST   /api/clipboard
DELETE /api/clipboard/:id
DELETE /api/clipboard
WS     /clipboard
```

Unauthenticated requests must not expose:

* clipboard content
* clipboard history
* images
* device information beyond what is strictly necessary for pairing

---

## Network Exposure

The service should primarily operate over the local network.

It should not intentionally expose the clipboard service to the public internet.

The application should bind only to the interfaces required for local-network communication.

Router port forwarding, UPnP port creation, and public tunneling must not be automatically enabled.

---

## Browser Transport Security

Where browser APIs or browser security requirements require HTTPS, the application must provide a secure local HTTPS strategy.

Encryption at the application layer does not remove the need to consider transport security.

WebSocket communication should use secure WebSockets (`wss`) whenever HTTPS is used.

---

## Clipboard History

Clipboard history should be temporary.

Default:

**Maximum: 50 items**

Users can configure a shorter retention period in future versions.

Sensitive clipboard data should not be retained indefinitely.

Deleting an item must also delete its associated encrypted image/blob data.

---

## Clear History

Users must be able to select:

**Clear Clipboard History**

This removes all stored clipboard records and associated files.

The deletion should propagate to both paired devices.

---

## Unpair Device

Settings must provide:

```text
Paired Devices

✓ Yoga's MacBook
✓ Yoga's Android

[Unpair]
```

Unpairing a device immediately revokes its ability to access future clipboard data.

Reconnecting the device requires a new pairing process.

---

## Pairing Mode

The server must not continuously accept new devices.

Pairing should only become available after the user explicitly selects:

**Pair New Device**

Pairing sessions must:

* expire automatically
* be single-use
* use cryptographically random credentials
* reject reuse after successful pairing

Example:

```text
Normal state

New device
    │
    ▼
 ❌ Rejected


User selects
"Pair New Device"
    │
    ▼
Temporary pairing window
    │
    ▼
Scan QR
    │
    ▼
✓ Device paired
    │
    ▼
Pairing window closes
```

---

## Clipboard Content Logging

Clipboard content must never appear in:

* application logs
* HTTP access logs
* analytics
* error-reporting payloads
* debugging telemetry

Logs may contain non-sensitive operational information such as:

```text
clipboard item received
type=image
size=428 KB
device=android
```

but not the actual clipboard contents.

---

## Image Security

Images must receive the same protection as text.

Images should not be exposed through publicly accessible URLs such as:

```text
/uploads/image123.png
```

Instead, image access must require authentication and the image itself should remain encrypted while stored.

---

## Threat Model

The MVP must protect against the following scenarios.

### Another person on the same Wi-Fi

They discover the Mac's IP address.

**Expected:** No clipboard access.

### Someone knows the clipboard server URL

**Expected:** No clipboard access without a paired-device identity.

### Attacker reads the clipboard database

**Expected:** Clipboard contents remain encrypted.

### Attacker discovers an old pairing QR code

**Expected:** Pairing fails because the token has expired or already been consumed.

### Previously paired phone is removed

**Expected:** Its authorization is revoked and it cannot retrieve new clipboard items.

### Server logs are inspected

**Expected:** No clipboard content is present.

---

# Security Principle

The fundamental authorization model is:

```text
Same Wi-Fi
    ≠
Trusted device
```

Instead:

```text
Same Wi-Fi
     +
Cryptographically paired device
     +
Authenticated connection
     +
Encrypted clipboard content
     =
Clipboard access
```

For the initial product, only the explicitly paired Mac and Android phone should be capable of reading clipboard contents.

