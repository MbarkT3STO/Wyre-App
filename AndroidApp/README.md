# Wyre Android

Peer-to-peer file transfer for Android — same protocol as the desktop app.

## Architecture

```
AndroidApp/
├── src/
│   ├── bridge/          # Capacitor plugin interface (TS → native)
│   │   ├── WyrePlugin.ts   # Typed plugin registration
│   │   └── AppBridge.ts    # Replaces desktop IpcClient
│   ├── renderer/        # WebView UI (reused from desktop)
│   │   ├── components/  # DeviceCard, TransferItem, IncomingDialog…
│   │   ├── views/       # HomeView, TransfersView, SettingsView
│   │   ├── styles/      # tokens + components (shared) + android.css
│   │   └── index.ts     # Bootstrap (uses AppBridge, not IpcClient)
│   └── shared/          # Models + utils (identical to desktop)
└── android/
    └── app/src/main/java/com/wyre/app/
        ├── MainActivity.kt      # Capacitor BridgeActivity
        ├── WyrePlugin.kt        # @CapacitorPlugin — exposes methods to JS
        ├── WyreManager.kt       # Coordinator (owns all services)
        ├── DiscoveryService.kt  # UDP broadcast + listen (port 49152)
        ├── TransferServer.kt    # TCP server (incoming files)
        ├── TransferClient.kt    # TCP client (outgoing files)
        ├── TransferModels.kt    # Sealed event classes + data models
        └── SettingsStore.kt     # SharedPreferences wrapper
```

## Key differences from Desktop

| Feature | Desktop | Android |
|---|---|---|
| Shell | Electron BrowserWindow | Capacitor WebView |
| IPC | `window.api` (contextBridge) | `AppBridge` → Capacitor plugin |
| UDP/TCP | Node.js `dgram` / `net` | Kotlin `DatagramSocket` / `Socket` |
| File I/O | Node.js `fs` | Android `InputStream`/`OutputStream` |
| Settings | electron-store | SharedPreferences |
| File picker | Drag-and-drop + `<input>` | `Intent.ACTION_GET_CONTENT` |
| Navigation | Sidebar | Bottom navigation bar |

## Build & Run

### Prerequisites
- Node.js 18+
- Android Studio (Hedgehog or newer)
- Android SDK 34
- JDK 17

### Steps

```bash
cd AndroidApp
npm install
npm run build          # Vite builds the web layer → dist/
npx cap sync android   # Copies dist/ into android/app/src/main/assets/public
npx cap open android   # Opens Android Studio
```

Then in Android Studio: **Run ▶** on a device or emulator (API 23+).

## Network Requirements

Same as desktop:
- Both devices on the same LAN/WiFi
- UDP port **49152** for discovery
- TCP port **49200** (default, configurable) for transfers
