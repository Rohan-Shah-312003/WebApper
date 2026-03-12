# Webapper 🌐

Turn any website into a standalone desktop app — all open source!

## Features

- **Create web apps** from any URL with a custom name & icon
- **Three modes**: Standard (single window), Tabbed (multi-tab), Incognito (no session)
- **App library** with search & filter
- **App gallery** — 20 popular apps ready to add in one click
- **Custom icons** — upload your own or auto-fetch favicon
- **URL whitelisting** — control which links open in-app vs. system browser
- **Session isolation** — each app gets its own persistent storage partition
- **Window size memory** — windows remember their last size
- **macOS titlebar integration** — hiddenInset style for clean look
- **Context menu** — right-click to launch, edit, or delete

## Quick Start

```bash
# Install dependencies
npm install

# Run in development
npm start

# Build for distribution
npm run build:mac    # macOS .dmg
npm run build:win    # Windows .exe
npm run build:linux  # Linux AppImage
```

## Project Structure

```
webapper/
├── src/
│   ├── main.js              # Main Electron process
│   ├── preload.js           # Renderer bridge (contextBridge)
│   ├── webapp-preload.js    # Preload for launched web app windows
│   └── ui/
│       ├── index.html       # Main UI
│       ├── style.css        # Styles
│       └── app.js           # Renderer logic
├── assets/                  # App icons (icon.icns, icon.ico, icon.png)
├── package.json
└── README.md
```

## Architecture

### Main Process (`src/main.js`)

- Manages app lifecycle & main window
- Stores app data as JSON in `userData` directory
- Handles IPC: list/save/delete apps, launch web app windows
- Each web app window gets an isolated `persist:webapp_<id>` partition
- Incognito apps use a non-persisted `incognito:<id>` partition

### Renderer (`src/ui/`)

- Pure HTML/CSS/JS — no framework needed
- Communicates with main process via `window.webapper` (exposed by preload)

### IPC Channels

| Channel            | Direction       | Description                 |
| ------------------ | --------------- | --------------------------- |
| `apps:list`        | renderer → main | Load all saved apps         |
| `apps:save`        | renderer → main | Persist apps array          |
| `apps:launch`      | renderer → main | Open a web app window       |
| `apps:delete`      | renderer → main | Remove an app               |
| `app:fetchFavicon` | renderer → main | Get favicon URL suggestions |
| `dialog:pickImage` | renderer → main | Open file picker for icon   |

## Adding Icons

Place your app icons in the `assets/` folder:

- `assets/icon.icns` — macOS
- `assets/icon.ico` — Windows
- `assets/icon.png` — Linux (512×512 recommended)

## Customization Ideas

- **Ad blocking**: Inject a content script that blocks ad domains
- **Custom CSS injection**: Per-app CSS overrides
- **Keyboard shortcuts**: Register global shortcuts to focus specific apps
- **Dock badges**: Use `app.setBadgeCount()` for notification counts
- **Auto-launch**: Use `app.setLoginItemSettings()` to start on login
- **Tray icon**: Add a system tray menu for quick access
