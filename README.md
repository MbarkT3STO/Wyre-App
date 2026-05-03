<div align="center">

<img src="DesktopApp/assets/icons/icon.png" width="96" height="96" alt="Wyre Logo" />

# Wyre

**Seamless peer-to-peer file transfer for local networks**

[![License: MIT](https://img.shields.io/badge/License-MIT-7C3AED.svg?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-7C3AED.svg?style=flat-square)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6.svg?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-30-47848F.svg?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Capacitor](https://img.shields.io/badge/Capacitor-6-119EFF.svg?style=flat-square&logo=capacitor&logoColor=white)](https://capacitorjs.com/)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android-7C3AED.svg?style=flat-square)](#)

Transfer files instantly between any devices on your local network.  
No internet. No accounts. No cloud. Just fast, direct, private transfers.

[**Desktop App**](#-desktop-app) · [**Android App**](#-android-app) · [**Website**](#-website) · [**Download**](#-download)

</div>

---

## Overview

Wyre is a cross-platform file transfer application built around a single principle: **your files should go directly from one device to another, with nothing in between.** It uses UDP broadcast for zero-configuration device discovery and raw TCP for maximum-speed transfers — all on your local network.

The project is split into three parts:

| App | Stack | Description |
|-----|-------|-------------|
| [`DesktopApp/`](DesktopApp/) | Electron 30 · TypeScript · Vite | Native desktop app for Windows, macOS, and Linux |
| [`AndroidApp/`](AndroidApp/) | Capacitor 6 · Kotlin · TypeScript | Native Android app sharing the same UI and protocol |
| [`Website/`](Website/) | HTML · CSS · Vanilla JS | Marketing landing page |

---

## ✨ Features

- **Zero-setup discovery** — UDP broadcast on port `49152` finds every Wyre device on the network automatically, every 3 seconds
- **Full-speed LAN transfers** — direct TCP connection, 64 KB chunks, no cloud bottleneck
- **SHA-256 integrity verification** — every received file is checksummed; corrupted files are rejected automatically
- **Accept / Decline dialogs** — incoming transfers show a 30-second countdown; you're always in control
- **Real-time progress** — live KB/s speed and ETA on every transfer
- **Transfer cancellation** — cancel from either the sender or receiver side at any time
- **Transfer resume** — paused transfers can be resumed from the last byte
- **Folder send** — zip and send entire folders in one action
- **Clipboard sharing** — send clipboard text directly to another device
- **Built-in chat** — real-time text and file messaging between discovered devices
- **Transfer history** — full log of completed, failed, and cancelled transfers (up to 500 entries)
- **OS notifications** — native system notifications on transfer completion and incoming requests
- **Dark / Light / System theme** — polished UI that respects your OS preference
- **Auto-accept trusted devices** — whitelist specific device IDs for hands-free transfers

---

## 🗂 Repository Structure

```
Wyre/
├── DesktopApp/          # Electron desktop application
│   ├── src/
│   │   ├── main/        # Electron main process (Node.js)
│   │   │   ├── app/         # App lifecycle, window management
│   │   │   ├── discovery/   # UDP broadcaster + listener
│   │   │   ├── transfer/    # TCP server, client, queue, crypto
│   │   │   ├── ipc/         # IPC bridge + typed handlers
│   │   │   ├── notifications/
│   │   │   └── store/       # electron-store settings
│   │   ├── preload/     # contextBridge — typed window.api
│   │   ├── renderer/    # Browser context (pure TS/HTML/CSS)
│   │   └── shared/      # Shared types, models, IPC contracts
│   └── tests/           # Vitest unit tests
│
├── AndroidApp/          # Capacitor Android application
│   ├── src/
│   │   ├── bridge/      # Capacitor plugin interface (TS → native)
│   │   ├── renderer/    # Shared WebView UI (reused from desktop)
│   │   └── shared/      # Shared models + utils
│   └── android/
│       └── app/src/main/java/com/wyre/app/
│           ├── WyrePlugin.kt       # @CapacitorPlugin — JS bridge
│           ├── WyreManager.kt      # Central coordinator
│           ├── DiscoveryService.kt # UDP broadcast + listen
│           ├── TransferServer.kt   # TCP incoming server
│           ├── TransferClient.kt   # TCP outgoing client
│           ├── ChatManager.kt      # Chat session manager
│           └── SettingsStore.kt    # SharedPreferences wrapper
│
└── Website/             # Landing page
    ├── index.html
    ├── css/
    └── js/
```

---

## 🌐 Network Protocol

Wyre uses a simple, open protocol over UDP and TCP.

### Discovery (UDP · port 49152)

Every device broadcasts a JSON announcement every **3 seconds**:

```json
{
  "id": "uuid-v4",
  "name": "MacBook Pro",
  "platform": "darwin",
  "port": 49200,
  "version": "1.0.0",
  "encryptionSupported": true
}
```

Devices that haven't been seen for **10 seconds** are marked offline. They are fully removed after **60 seconds**.

### Transfer (TCP · dynamic port, default 49200)

1. **Sender** opens a TCP connection and writes a newline-terminated JSON header:
   ```json
   {
     "transferId": "uuid",
     "senderDeviceId": "uuid",
     "senderName": "Alice's PC",
     "fileName": "report.pdf",
     "fileSize": 4096000,
     "checksum": "sha256hex",
     "encryption": { "supported": true, "senderPublicKey": "base64" }
   }
   ```
2. **Receiver** responds with `{"accepted": true, "resumeOffset": 0}` or `{"accepted": false}`
3. **File data** streams in 64 KB chunks immediately after the response
4. **Progress** is sent back from receiver → sender as `{"p":72,"b":2949120,"s":8192000,"e":1}` every 100 ms
5. **Checksum** is verified on the receiver side after the last byte; mismatches delete the file

### Clipboard (TCP · same port)

A lightweight frame with `"type": "clipboard"` is sent over the same TCP port. The receiver's `TransferServer` routes it to the clipboard handler without creating a transfer entry.

### Chat (TCP · same port)

Chat sessions are multiplexed on the same TCP port using a `"type": "chat_handshake"` frame. The `TransferServer` routes these connections to the `ChatManager`.

---

## 🔒 Security

- **No data leaves your network** — all communication is LAN-only
- **SHA-256 checksums** — every file is verified after receipt
- **Path traversal protection** — received file names are sanitised (basename extraction, illegal character removal, Windows reserved name rejection, 255-byte truncation)
- **AES-256-GCM encryption** — optional per-transfer encryption using ECDH key exchange (X25519)
- **No telemetry** — zero analytics, zero tracking, zero external requests
- **MIT licensed** — fully open source and auditable

---

## 📦 Download

| Platform | Format | Notes |
|----------|--------|-------|
| Windows | NSIS Installer | x64 |
| macOS | DMG | Apple Silicon (arm64) + Intel (x64) |
| Linux | AppImage | x64, no installation required |
| Android | APK | Android 6.0+ (API 23+) |

→ See [DesktopApp/README.md](DesktopApp/README.md) and [AndroidApp/README.md](AndroidApp/README.md) for build instructions.

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron 30 |
| Mobile shell | Capacitor 6 + Kotlin |
| Language | TypeScript 5.4 (strict) |
| Bundler | Vite 5 + vite-plugin-electron |
| Networking | Node.js `net` + `dgram` (Desktop) · Kotlin `Socket` + `DatagramSocket` (Android) |
| Persistence | electron-store (Desktop) · SharedPreferences (Android) |
| Testing | Vitest |
| Packaging | electron-builder |
| Icons | FontAwesome 6.5 |
| Font | Inter Variable |

---

## 👤 Author

Built by **[MBVRK](https://github.com/MbarkT3STO)** — a passion project focused on simplicity, performance, and privacy.

---

<div align="center">

MIT License · © 2026 Wyre

</div>
