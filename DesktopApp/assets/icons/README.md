# Icons

Place platform-specific app icons here:

| File | Platform | Size |
|------|----------|------|
| `icon.icns` | macOS | Multi-resolution |
| `icon.ico` | Windows | Multi-resolution |
| `icon.png` | Linux | 512×512 px |
| `tray.png` | All (system tray) | 16×16 or 22×22 px |

## Generate from a source PNG

```bash
# Install electron-icon-builder
npm install -g electron-icon-builder

# Generate all formats from a 1024×1024 source
electron-icon-builder --input=source-1024.png --output=./
```

The app will start without icons — they are optional for development.
