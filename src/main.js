const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  shell,
  nativeImage,
  dialog,
  Menu,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { applyToPartition, applyToDefaultSession } = require("./adblocker");

// ── Storage ────────────────────────────────────────────────────────────────────
const DATA_PATH = path.join(app.getPath("userData"), "webapps.json");

function loadApps() {
  try {
    if (fs.existsSync(DATA_PATH))
      return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  } catch {}
  return [];
}
function saveApps(apps) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(apps, null, 2));
}

// ── Globals ────────────────────────────────────────────────────────────────────
let mainWindow = null;
const launchedWindows = new Map();
const TOOLBAR_H = 44;

// Toolbar info keyed by appId — single shared IPC handler reads from here
const toolbarInfoStore = new Map();

// ── Main window ────────────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 800,
    minHeight: 560,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#0f0f11",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });
  mainWindow.loadFile(path.join(__dirname, "ui", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());

  const template = [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Ad-domain check ───────────────────────────────────────────────────────────
function isAdDomain(url) {
  try {
    const { BLOCKED_DOMAINS } = require("./adblocker");
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (BLOCKED_DOMAINS.has(host)) return true;
    const parts = host.split(".");
    for (let i = 1; i < parts.length - 1; i++) {
      if (BLOCKED_DOMAINS.has(parts.slice(i).join("."))) return true;
    }
  } catch {}
  return false;
}

// ── Launch a web app window ────────────────────────────────────────────────────
function launchWebApp(webApp) {
  if (launchedWindows.has(webApp.id)) {
    const ex = launchedWindows.get(webApp.id);
    if (!ex.isDestroyed()) {
      ex.focus();
      return;
    }
  }

  const isIncognito = webApp.mode === "incognito";
  const partition = isIncognito
    ? `incognito:${webApp.id}`
    : `persist:webapp_${webApp.id}`;
  const winW = webApp.windowWidth || 1280;
  const winH = webApp.windowHeight || 800;

  // Apply ad blocker before any requests fire
  applyToPartition(partition);

  // ── 1. Shell window ───────────────────────────────────────────────────────
  const win = new BrowserWindow({
    width: winW,
    height: winH,
    minWidth: 600,
    minHeight: TOOLBAR_H + 200,
    title: webApp.name,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 13 },
    backgroundColor: "#1a1a1f",
    webPreferences: {
      preload: path.join(__dirname, "toolbar-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  if (webApp.iconDataUrl) {
    try {
      win.setIcon(nativeImage.createFromDataURL(webApp.iconDataUrl));
    } catch {}
  }

  // Store info for the shared getInfo handler, pass appId in query string
  // so toolbar.html has it synchronously without waiting for async IPC
  toolbarInfoStore.set(webApp.id, {
    appId: webApp.id,
    name: webApp.name,
    icon: webApp.icon || "🌐",
    mode: webApp.mode || "standard",
    iconDataUrl: webApp.iconDataUrl || null,
  });

  win.loadFile(path.join(__dirname, "toolbar", "toolbar.html"), {
    query: { appId: webApp.id },
  });

  // ── 2. WebContentsView ────────────────────────────────────────────────────
  const siteView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "webapp-preload.js"),
      partition,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  win.contentView.addChildView(siteView);

  function layout() {
    const [w, h] = win.getContentSize();
    siteView.setBounds({
      x: 0,
      y: TOOLBAR_H,
      width: w,
      height: Math.max(0, h - TOOLBAR_H),
    });
  }
  layout();
  win.on("resize", layout);

  siteView.webContents.loadURL(webApp.url);

  // ── 3. Toolbar button IPC ─────────────────────────────────────────────────
  ipcMain.on(`toolbar:reload:${webApp.id}`, () => {
    if (!siteView.webContents.isDestroyed()) siteView.webContents.reload();
  });
  ipcMain.on(`toolbar:back:${webApp.id}`, () => {
    if (siteView.webContents.canGoBack()) siteView.webContents.goBack();
  });
  ipcMain.on(`toolbar:forward:${webApp.id}`, () => {
    if (siteView.webContents.canGoForward()) siteView.webContents.goForward();
  });
  ipcMain.on(`toolbar:home:${webApp.id}`, () => {
    if (!siteView.webContents.isDestroyed())
      siteView.webContents.loadURL(webApp.url);
  });

  // ── 4. Push nav state to toolbar ─────────────────────────────────────────
  function pushToolbar(extra = {}) {
    if (win.isDestroyed()) return;
    win.webContents.send("toolbar:update", {
      canBack: siteView.webContents.canGoBack(),
      canForward: siteView.webContents.canGoForward(),
      ...extra,
    });
  }
  siteView.webContents.on("did-navigate", (_, url) =>
    pushToolbar({ url, loading: false }),
  );
  siteView.webContents.on("did-navigate-in-page", (_, url) =>
    pushToolbar({ url, loading: false }),
  );
  siteView.webContents.on("did-start-loading", () =>
    pushToolbar({ loading: true }),
  );
  siteView.webContents.on("did-stop-loading", () =>
    pushToolbar({ loading: false }),
  );
  siteView.webContents.on("page-title-updated", (_, t) => {
    if (!win.isDestroyed()) win.setTitle(t || webApp.name);
  });

  // ── 5. Popup / OAuth handling ─────────────────────────────────────────────
  //
  // KEY FACTS about Google OAuth / Notion sign-in:
  //
  //   A) window.open() is called by the site → setWindowOpenHandler fires
  //   B) We MUST return { action: "allow" } so Electron creates the window
  //      itself — this preserves window.opener in the popup, which is
  //      required for postMessage to flow back to the signing-in page.
  //   C) A manually-created BrowserWindow (new BrowserWindow + loadURL)
  //      has NO opener relationship → postMessage never arrives → Claude/
  //      Notion never know the login completed → stuck forever.
  //   D) We pass overrideBrowserWindowOptions with the SAME partition so
  //      the popup shares cookies/session with the main site view.
  //   E) For plain external links that aren't auth flows, did-create-window
  //      closes the popup and opens the system browser instead.
  //
  // Notion extra: Notion's Google OAuth popup closes itself after the user
  //   clicks Allow. The app detects it via polling popup.closed. When the
  //   popup closes we reload siteView so Notion picks up the new session.

  // Hostnames that must always open as a popup (OAuth providers).
  // These must never be swallowed by the same-origin in-place navigation.
  const ALWAYS_POPUP_HOSTS = [
    "accounts.google.com",
    "accounts.youtube.com",
    "appleid.apple.com",
    "login.microsoftonline.com",
    "login.live.com",
    "github.com",
  ];

  function isAlwaysPopup(url) {
    try {
      const h = new URL(url).hostname.replace(/^www\./, "");
      return ALWAYS_POPUP_HOSTS.some((d) => h === d || h.endsWith("." + d));
    } catch {
      return false;
    }
  }

  siteView.webContents.setWindowOpenHandler(({ url }) => {
    // 1. Ad domain → hard deny
    if (isAdDomain(url)) return { action: "deny" };

    // 2. Same-origin / whitelisted → navigate siteView in place ONLY if it's
    //    not an OAuth provider URL (Notion calls window.open on its own domain
    //    for some flows, which must stay as a popup, not replace the main view)
    if (!isAlwaysPopup(url)) {
      try {
        const base = new URL(webApp.url);
        const dest = new URL(url);
        const internal =
          dest.hostname === base.hostname ||
          (webApp.whitelist || []).some((d) => dest.hostname.endsWith(d));
        if (internal) {
          siteView.webContents.loadURL(url);
          return { action: "deny" };
        }
      } catch {}
    }

    // 3. Everything else (OAuth, external) → real Electron window, same partition.
    //    "allow" preserves window.opener → postMessage works.
    //    did-create-window below decides whether to keep it or send to OS browser.
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        width: 520,
        height: 640,
        title: "Sign in",
        webPreferences: {
          partition,
          nodeIntegration: false,
          contextIsolation: true,
        },
      },
    };
  });

  siteView.webContents.on("did-create-window", (popupWin, details) => {
    const openedUrl = details.url || "";

    // Decide if this is an auth/OAuth window or just an external link
    let isAuthWindow = false;
    try {
      const h = new URL(openedUrl).hostname.replace(/^www\./, "");
      isAuthWindow =
        h.includes("google.") ||
        h.includes("accounts.") ||
        h.includes("apple.com") ||
        h.includes("microsoft.com") ||
        h.includes("live.com") ||
        h.includes("github.com") ||
        h.includes("notion.so") ||
        h.includes("anthropic.com") ||
        h.includes("claude.ai") ||
        h.includes("openai.com") ||
        openedUrl === "" ||
        openedUrl === "about:blank";
    } catch {}

    if (!isAuthWindow) {
      // Plain external link → system browser, no Electron window
      popupWin.destroy();
      if (openedUrl && openedUrl !== "about:blank")
        shell.openExternal(openedUrl);
      return;
    }

    // AUTH WINDOW — watch for OAuth callback navigating back to app domain
    // (handles Claude's ?code= callback pattern)
    popupWin.webContents.on("did-navigate", (_, navUrl) => {
      try {
        const dest = new URL(navUrl);
        const base = new URL(webApp.url);
        if (
          dest.hostname === base.hostname ||
          dest.hostname === base.hostname.replace("www.", "")
        ) {
          if (!siteView.webContents.isDestroyed()) {
            siteView.webContents.loadURL(navUrl);
          }
          setTimeout(() => {
            if (!popupWin.isDestroyed()) popupWin.close();
          }, 500);
        }
      } catch {}
    });

    // Notion pattern: the Google OAuth popup closes itself after the user
    // clicks Allow. Notion's main page polls popup.closed and then reloads
    // itself — but since we're in Electron, siteView needs a nudge.
    // Always reload on popup close so the new session cookies are picked up.
    popupWin.on("closed", () => {
      setTimeout(() => {
        if (!siteView.webContents.isDestroyed()) {
          siteView.webContents.reload();
        }
      }, 800);
    });
  });

  // ── 6. Scrollbar polish ───────────────────────────────────────────────────
  siteView.webContents.on("did-finish-load", () => {
    siteView.webContents
      .insertCSS(
        `
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.35); border-radius: 4px; }
      ::-webkit-scrollbar-thumb:hover { background: rgba(128,128,128,0.6); }
    `,
      )
      .catch(() => {});
  });

  // ── 7. Cleanup ────────────────────────────────────────────────────────────
  win.on("closed", () => {
    try {
      const sz = win.getSize ? win.getSize() : [winW, winH];
      const all = loadApps();
      const idx = all.findIndex((a) => a.id === webApp.id);
      if (idx !== -1) {
        all[idx].windowWidth = sz[0];
        all[idx].windowHeight = sz[1];
        all[idx].lastOpened = new Date().toISOString();
        saveApps(all);
      }
    } catch {}
    toolbarInfoStore.delete(webApp.id);
    ipcMain.removeAllListeners(`toolbar:reload:${webApp.id}`);
    ipcMain.removeAllListeners(`toolbar:back:${webApp.id}`);
    ipcMain.removeAllListeners(`toolbar:forward:${webApp.id}`);
    ipcMain.removeAllListeners(`toolbar:home:${webApp.id}`);
    launchedWindows.delete(webApp.id);
  });

  win.once("ready-to-show", () => win.show());
  launchedWindows.set(webApp.id, win);
}

// ── Global IPC handlers ────────────────────────────────────────────────────────

// Single shared handler — toolbar passes its appId as an argument
ipcMain.handle("toolbar:getInfo", (_, appId) => {
  return toolbarInfoStore.get(appId) || null;
});

ipcMain.handle("apps:list", () => loadApps());
ipcMain.handle("apps:save", (_, apps) => {
  saveApps(apps);
  return true;
});
ipcMain.handle("apps:launch", (_, webApp) => {
  launchWebApp(webApp);
  return true;
});
ipcMain.handle("apps:delete", (_, id) => {
  saveApps(loadApps().filter((a) => a.id !== id));
  const w = launchedWindows.get(id);
  if (w && !w.isDestroyed()) w.close();
  return true;
});
ipcMain.handle("app:fetchFavicon", async (_, url) => {
  try {
    const { hostname, origin } = new URL(url);
    return [
      `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`,
      `${origin}/favicon.ico`,
      `${origin}/apple-touch-icon.png`,
    ];
  } catch {
    return [];
  }
});
ipcMain.handle("dialog:pickImage", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      {
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "ico", "icns", "svg"],
      },
    ],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const data = fs.readFileSync(result.filePaths[0]);
  const ext = path.extname(result.filePaths[0]).slice(1).toLowerCase();
  const mime =
    ext === "svg" ? "image/svg+xml" : `image/${ext === "jpg" ? "jpeg" : ext}`;
  return `data:${mime};base64,${data.toString("base64")}`;
});

// ── App lifecycle ──────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  applyToDefaultSession();
  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
