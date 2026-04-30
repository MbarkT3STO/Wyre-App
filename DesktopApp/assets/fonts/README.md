# Fonts

Place `Inter-Variable.woff2` here for self-hosted font support.

## Download Inter Variable

```bash
curl -L "https://github.com/rsms/inter/releases/download/v4.0/Inter-4.0.zip" -o inter.zip
unzip -j inter.zip "Inter Desktop/Inter-Variable.ttf" -d .
# Convert TTF → WOFF2 with: npx ttf2woff2 Inter-Variable.ttf > Inter-Variable.woff2
```

Or use the Google Fonts CDN by adding this to `index.html`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300..700&display=swap" rel="stylesheet">
```

The app falls back to `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` if Inter is not available.
