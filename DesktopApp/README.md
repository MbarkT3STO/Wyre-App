# Wyre

Seamless peer-to-peer file transfer between devices on the same local network. No internet required, no accounts, no cloud — just fast, direct transfers.

![Wyre Screenshot](assets/icons/screenshot-placeholder.png)

## Features

- **Automatic device discovery** — UDP broadcast finds peers on the same network instantly
- **Drag-and-drop transfers** — drop files onto the UI or use the file picker
- **Accept/Reject dialogs** — incoming transfers show a 30-second countdown dialog
- **Real-time progress** — live progress bars with speed (KB/s) and ETA
- **Transfer history** — full log of completed, failed, and cancelled transfers
- **Checksum verification** — SHA-256 integrity check on every received file
- **Transfer cancellation** — cancel from either sender or receiver side
- **OS notifications** — native system notifications on transfer completion
- **Dark/Light/System theme** — polished UI that respects your OS preference
- **Custom frameless window** — native title bar on macOS, custom controls on Windows/Linux

## Architecture

```
wyre/
├── src/
│   ├── main/                    # Electron main process (Node.js)
│   │   ├── app/                 # App lifecycle, window management
│   │   ├── discovery/           # UDP device discovery (broadcaster + listener)
│   │   ├── transfer/            # TCP file transfer (server + client + queue)
│   │   ├── ipc/                 # IPC bridge + typed handlers
│   │   ├── notifications/       # OS native notifications
│   │   └── store/               # Persisted settings (electron-store)
│   ├── preload/                 # contextBridge — typed window.api
│   ├── renderer/                # Browser context (pure TS/HTML/CSS)
│   │   ├── core/                # Router, StateManager, IpcClient
│   │   ├── components/          # Reusable UI components
│   │   ├── views/               # Full-page routed views
│   │   ├── styles/              # CSS design tokens + component styles
│   │   └── theme/               # Dark/light theme engine
│   └── shared/                  # Shared types, models, utilities
│       ├── ipc/                 # IPC channel names + payload types
│       ├── models/              # Device, Transfer, AppSettings interfaces
│       └── utils/               # Pure formatters and validators
└── tests/                       # Vitest unit tests
```

### Key Design Decisions

**Strict process isolation** — The renderer is fully sandboxed (`contextIsolation: true`, `nodeIntegration: false`). All system calls go through the typed IPC bridge. The renderer never touches Node.js APIs directly.

**Typed IPC contracts** — Every channel name and payload type is defined once in `IpcContracts.ts`. Both `IpcBridge` (main) and `IpcClient` (renderer) import from this single source of truth. Zero `any` types in IPC code.

**Service layer pattern** — `DiscoveryService`, `TransferServer`, and `TransferClient` are plain TypeScript `EventEmitter` subclasses. They have no knowledge of Electron, windows, or IPC. `IpcBridge` wires them together. This makes them fully unit-testable.

**Observable state** — `StateManager` is a ~80-line typed observable store. Components subscribe to slices of state and re-render on change. No third-party state library.

**Component base class** — Every UI component extends `Component.ts` which provides `mount()`, `unmount()`, `render()`, and `update()`. Components manage their own DOM subtree and clean up event listeners on unmount.

**Dependency injection** — Services receive dependencies through constructors. `AppBootstrapper` wires everything at startup. No singletons except the top-level bootstrapper.

### Transfer Protocol

1. **Discovery**: UDP broadcast on port 49152 every 3 seconds. Payload: `{ id, name, platform, port, version }`. Devices not seen for 10 seconds are marked offline.

2. **Handshake**: Sender connects via TCP to receiver's `TransferServer`. Sends a JSON header line: `{ transferId, senderDeviceId, senderName, fileName, fileSize, checksum }`.

3. **Accept/Decline**: Receiver's UI shows the `IncomingDialog`. On accept, server signals readiness. On decline (or 30s timeout), connection is closed.

4. **Transfer**: File is streamed in 64 KB chunks. Progress events fire every 100ms with bytes transferred, speed, and ETA.

5. **Verification**: On completion, SHA-256 checksum is verified. Mismatch → partial file deleted, error reported.

## Development Setup

### Prerequisites

- Node.js 18+ (LTS recommended)
- npm 9+

### Install

```bash
cd wyre
npm install
```

### Run in development

```bash
npm run dev
```

This starts Vite with hot reload for the renderer and restarts the main process on changes.

### Type check

```bash
npm run typecheck
```

### Lint

```bash
npm run lint
```

### Run tests

```bash
npm test
```

Tests use Vitest and run in Node environment. No Electron required for tests.

### Build for production

```bash
npm run build
```

Output goes to `dist/`.

### Package for distribution

```bash
npm run package
```

Produces platform-specific installers in `release/`:
- **macOS**: `.dmg` (universal x64 + arm64)
- **Windows**: `.exe` (NSIS installer) + portable `.exe`
- **Linux**: `.AppImage` + `.deb`

## Configuration

Settings are persisted via `electron-store` in the OS app data directory:
- **macOS**: `~/Library/Application Support/Wyre/settings.json`
- **Windows**: `%APPDATA%\Wyre\settings.json`
- **Linux**: `~/.config/Wyre/settings.json`

## Network Requirements

- Both devices must be on the same local network (LAN/WiFi)
- UDP port **49152** must be reachable for device discovery (broadcast)
- TCP port (default: random, configurable in Settings) must be reachable for file transfers
- No internet access required

## Security

- All transfers are direct device-to-device over your local network
- SHA-256 checksum verification ensures file integrity
- The renderer process is fully sandboxed — no Node.js access
- No data leaves your local network

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron 30 |
| Language | TypeScript 5 (strict mode) |
| UI | Pure HTML + CSS + TypeScript |
| Bundler | Vite + vite-plugin-electron |
| Networking | Node.js `net` (TCP) + `dgram` (UDP) |
| Persistence | electron-store |
| Testing | Vitest |
| Packaging | electron-builder |

## License

MIT
