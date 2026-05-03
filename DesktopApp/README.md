<div align="center">

<img src="assets/icons/icon.png" width="88" height="88" alt="Wyre Logo" />

# Wyre — Desktop

**Peer-to-peer file transfer for Windows, macOS, and Linux**

[![Electron](https://img.shields.io/badge/Electron-30-47848F.svg?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6.svg?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF.svg?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-7C3AED.svg?style=flat-square)](../LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-7C3AED.svg?style=flat-square)](#)

[![Windows](https://img.shields.io/badge/Windows-0078D4.svg?style=flat-square&logo=windows&logoColor=white)](#)
[![macOS](https://img.shields.io/badge/macOS-000000.svg?style=flat-square&logo=apple&logoColor=white)](#)
[![Linux](https://img.shields.io/badge/Linux-FCC624.svg?style=flat-square&logo=linux&logoColor=black)](#)

</div>

---

## Overview

The Wyre desktop app is an Electron application that enables instant, zero-setup file transfers between any devices on the same local network. It uses UDP broadcast for automatic device discovery and raw TCP for maximum-throughput transfers — no internet, no accounts, no cloud.

---

## ✨ Features

| Feature | Details |
|---------|---------|
| **Automatic discovery** | UDP broadcast on port `49152` every 3 s — devices appear instantly |
| **Drag-and-drop transfers** | Drop files onto the UI or use the file picker |
| **Folder send** | Zip and send entire folders in one action |
| **Accept / Decline** | 30-second countdown dialog on incoming transfers |
| **Real-time progress** | Live KB/s speed and ETA per transfer |
| **Transfer resume** | Paused transfers resume from the last byte |
| **SHA-256 verification** | Every received file is checksummed; corrupted files are rejected |
| **AES-256-GCM encryption** | Optional per-transfer encryption via ECDH (X25519) key exchange |
| **Transfer cancellation** | Cancel from sender or receiver side at any time |
| **Transfer history** | Full log of completed, failed, and cancelled transfers (500 entries) |
| **Clipboard sharing** | Send clipboard text directly to another device over TCP |
| **Built-in chat** | Real-time text and file messaging with any discovered device |
| **OS notifications** | Native system notifications on completion and incoming requests |
| **Auto-accept** | Whitelist trusted device IDs for hands-free transfers |
| **Dark / Light / System theme** | Polished UI that respects your OS preference |
| **Custom frameless window** | Native title bar on macOS, custom controls on Windows/Linux |
| **Diagnostics log** | In-app log viewer for troubleshooting |

---

## 🏗 Architecture

```
DesktopApp/
├── src/
│   ├── main/                        # Electron main process (Node.js)
│   │   ├── app/
│   │   │   ├── AppBootstrapper.ts   # Wires all services together at startup
│   │   │   └── WindowManager.ts     # BrowserWindow lifecycle + frameless controls
│   │   ├── discovery/
│   │   │   ├── DiscoveryService.ts  # Orchestrates broadcaster + listener + eviction
│   │   │   ├── UdpBroadcaster.ts    # Sends JSON announcements every 3 s
│   │   │   └── UdpListener.ts       # Receives and parses peer announcements
│   │   ├── transfer/
│   │   │   ├── TransferServer.ts    # TCP server — accepts incoming connections
│   │   │   ├── TransferClient.ts    # TCP client — initiates outgoing transfers
│   │   │   ├── TransferQueue.ts     # Serialises sends; manages pending/active state
│   │   │   ├── FileChunker.ts       # Streaming read/write with backpressure
│   │   │   └── checksumWorker.ts    # Worker thread for SHA-256 (non-blocking)
│   │   ├── crypto/
│   │   │   └── TransferCrypto.ts    # ECDH key exchange + AES-256-GCM encrypt/decrypt
│   │   ├── ipc/
│   │   │   ├── IpcBridge.ts         # Registers all ipcMain handlers; wires events → renderer
│   │   │   └── handlers/            # One file per domain (devices, transfers, settings…)
│   │   ├── notifications/
│   │   │   └── NotificationManager.ts
│   │   ├── logging/
│   │   │   └── Logger.ts            # Structured file logger
│   │   └── store/
│   │       └── SettingsStore.ts     # Typed electron-store wrapper
│   │
│   ├── preload/
│   │   └── index.ts                 # contextBridge — exposes typed window.api to renderer
│   │
│   ├── renderer/                    # Browser context — pure TS/HTML/CSS, no Node.js
│   │   ├── core/
│   │   │   ├── Router.ts            # Hash-based SPA router
│   │   │   ├── StateManager.ts      # Observable reactive state
│   │   │   └── IpcClient.ts         # Typed wrapper around window.api
│   │   ├── components/              # Reusable UI components
│   │   │   ├── DeviceCard.ts
│   │   │   ├── DeviceList.ts
│   │   │   ├── TransferItem.ts
│   │   │   ├── TransferList.ts
│   │   │   ├── IncomingDialog.ts    # Accept/Decline countdown dialog
│   │   │   ├── ChatInviteDialog.ts
│   │   │   ├── ClipboardSendBar.ts
│   │   │   ├── Toast.ts
│   │   │   └── ToastContainer.ts
│   │   ├── views/
│   │   │   ├── HomeView.ts          # Device list + drop zone
│   │   │   ├── TransfersView.ts     # Active + history
│   │   │   ├── ChatView.ts          # Chat sessions
│   │   │   └── SettingsView.ts
│   │   ├── styles/                  # CSS design system ("Keyra")
│   │   │   ├── tokens.css           # Design tokens (colors, spacing, typography)
│   │   │   ├── base.css
│   │   │   ├── components.css
│   │   │   ├── animations.css
│   │   │   └── chat.css
│   │   └── theme/
│   │       └── ThemeEngine.ts       # Dark/light/system theme switching
│   │
│   └── shared/                      # Shared between main + renderer
│       ├── ipc/
│       │   └── IpcContracts.ts      # Single source of truth for all IPC channels + types
│       ├── models/
│       │   ├── Device.ts
│       │   ├── Transfer.ts
│       │   ├── ChatMessage.ts
│       │   └── AppSettings.ts
│       └── utils/
│           ├── formatters.ts
│           └── validators.ts
│
├── tests/                           # Vitest unit tests
├── assets/                          # Static assets (fonts, icons)
├── index.html                       # Renderer entry point
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## 🔑 Key Design Decisions

### Strict Process Isolation

The renderer is fully sandboxed — `contextIsolation: true`, `nodeIntegration: false`. The renderer never touches Node.js APIs directly. All system calls go through the typed IPC bridge via `window.api`.

```
Renderer (browser context)
    │  window.api.invoke(channel, payload)
    ▼
Preload (contextBridge)
    │  ipcRenderer.invoke(channel, payload)
    ▼
Main Process (Node.js)
    │  ipcMain.handle(channel, handler)
    ▼
Service Layer (DiscoveryService, TransferQueue, …)
```

### Typed IPC Contracts

Every channel name and payload type is defined **once** in `IpcContracts.ts`. Both `IpcBridge` (main) and `IpcClient` (renderer) import from this single source of truth. Zero `any` types in IPC code.

```typescript
// IpcContracts.ts — excerpt
export const IpcChannels = {
  TRANSFER_SEND:     'transfer:send',
  TRANSFER_PROGRESS: 'transfer:progress',
  TRANSFER_COMPLETE: 'transfer:complete',
  CLIPBOARD_SEND:    'clipboard:send',
  CLIPBOARD_RECEIVED:'clipboard:received',
  // ...
} as const;

export interface IpcInvokeMap {
  [IpcChannels.TRANSFER_SEND]: [TransferSendPayload, string]; // returns transferId
  // ...
}
```

### Service Layer

Services are plain `EventEmitter` subclasses with no Electron knowledge. `IpcBridge` is the only file that knows about both Electron IPC and the service layer — it wires them together.

### SHA-256 on a Worker Thread

Checksum computation runs in a dedicated `Worker` thread (`checksumWorker.ts`) so it never blocks the main process event loop, even for large files.

---

## 🌐 Network Protocol

### Discovery — UDP port 49152

```
Device A ──── UDP broadcast ────▶ 255.255.255.255:49152
              every 3 seconds
              {
                "id": "uuid",
                "name": "Alice's MacBook",
                "platform": "darwin",
                "port": 49200,
                "version": "1.0.0",
                "encryptionSupported": true
              }
```

- Devices not seen for **10 s** → marked offline
- Devices offline for **60 s** → removed from registry

### Transfer — TCP (dynamic port, default 49200)

```
Sender                                    Receiver
  │                                           │
  │── TCP connect ──────────────────────────▶ │
  │── JSON header + \n ─────────────────────▶ │
  │                                           │── parse header
  │                                           │── emit incomingRequest
  │                                           │── show Accept/Decline dialog
  │◀── {"accepted":true,"resumeOffset":0} + \n│
  │── file bytes (64 KB chunks) ────────────▶ │
  │◀── {"p":72,"b":2949120,"s":8192000} + \n  │  (every 100 ms)
  │── EOF ──────────────────────────────────▶ │
  │                                           │── SHA-256 verify
  │                                           │── emit complete / error
```

### Encryption (optional, AES-256-GCM)

When both peers advertise `encryptionSupported: true`:

1. Sender generates an X25519 key pair, includes `senderPublicKey` in the header
2. Receiver generates its own key pair, derives a shared AES-256-GCM key via ECDH
3. Receiver includes `receiverPublicKey` in the accept response
4. All file chunks are encrypted as length-prefixed `[4-byte length][12-byte IV][ciphertext][16-byte GCM tag]` frames

---

## ⚙️ Settings

All settings are persisted via `electron-store` in the OS user data directory.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `deviceId` | `string` | auto (UUID v4) | Unique device identifier |
| `deviceName` | `string` | OS hostname | Display name shown to peers |
| `transferPort` | `number` | `49200` | TCP port for incoming transfers |
| `saveDirectory` | `string` | `~/Downloads` | Default save location |
| `theme` | `'dark' \| 'light' \| 'system'` | `'system'` | UI theme |
| `autoAccept` | `boolean` | `false` | Auto-accept from trusted devices |
| `trustedDeviceIds` | `string[]` | `[]` | Device IDs to auto-accept from |
| `autoDeclineTimeout` | `number` | `30` | Seconds before auto-declining |
| `showNotifications` | `boolean` | `true` | OS notifications |
| `uiScale` | `number` | `1.0` | UI zoom factor |

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- npm 10+

### Install

```bash
cd DesktopApp
npm install
```

### Development

```bash
npm run dev
```

Starts Vite in dev mode and launches Electron with hot-reload.

### Build

```bash
npm run build
```

Compiles TypeScript and bundles with Vite into `dist/`.

### Package

```bash
npm run package
```

Runs `npm run build` then `electron-builder` to produce platform installers in `dist/`.

| Platform | Output |
|----------|--------|
| Windows | `Wyre Setup 1.0.0.exe` (NSIS) |
| macOS | `Wyre-1.0.0-arm64.dmg` + `Wyre-1.0.0-x64.dmg` |
| Linux | `Wyre-1.0.0.AppImage` |

### Type Check

```bash
npm run typecheck
```

### Lint

```bash
npm run lint
```

### Test

```bash
npm test
```

Runs the Vitest test suite once (non-watch mode).

---

## 🧪 Tests

Tests live in `tests/` and use [Vitest](https://vitest.dev/). They cover:

- UDP announcement parsing and device eviction logic
- File name sanitisation (path traversal, reserved names, control characters)
- SHA-256 checksum computation
- Settings store read/write and defaults
- IPC payload type validation

---

## 📦 Dependencies

### Runtime

| Package | Version | Purpose |
|---------|---------|---------|
| `electron` | `^30.0.0` | Desktop shell |
| `electron-store` | `^8.2.0` | Persistent settings |
| `electron-updater` | `^6.1.0` | Auto-update support |
| `@fortawesome/fontawesome-free` | `6.5.0` | UI icons |

### Dev

| Package | Version | Purpose |
|---------|---------|---------|
| `vite` | `^5.2.0` | Bundler |
| `vite-plugin-electron` | `^0.28.0` | Electron + Vite integration |
| `typescript` | `^5.4.0` | Type checking |
| `vitest` | `^1.5.0` | Unit testing |
| `eslint` | `^8.57.0` | Linting |

---

## 🎨 Design System — Keyra

The UI uses a custom design system called **Keyra**, defined in `src/renderer/styles/tokens.css`.

- **Primary accent** — `hsl(258, 85%, 55%)` (deep violet/purple)
- **Font** — Inter Variable (self-hosted, weights 300–900)
- **Shadows** — neumorphic raised/pressed shadows
- **Themes** — full dark and light token sets, switched via `data-theme` on `<html>`
- **Transitions** — `200ms` fast, `400ms` normal, `400ms` spring (`cubic-bezier(0.34, 1.56, 0.64, 1)`)

---

<div align="center">

Part of the [Wyre](../README.md) project · MIT License · Built by [MBVRK](https://github.com/MbarkT3STO)

</div>
