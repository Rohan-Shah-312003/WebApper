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
const launchedWindows = new Map(); // id → BrowserWindow
const siteViewMap = new Map(); // id → WebContentsView
const toolbarInfoStore = new Map(); // id → info object
const TOOLBAR_H = 44;

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

// ── Ad-domain check ────────────────────────────────────────────────────────────
function isAdDomain(url) {
  try {
    const { BLOCKED_DOMAINS } = require("./adblocker");
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (BLOCKED_DOMAINS.has(host)) return true;
    const parts = host.split(".");
    for (let i = 1; i < parts.length - 1; i++)
      if (BLOCKED_DOMAINS.has(parts.slice(i).join("."))) return true;
  } catch {}
  return false;
}

// ── Global toolbar IPC (fixed channel names, id passed as argument) ────────────
// These are registered ONCE at startup, not per-window.
ipcMain.on("toolbar:reload", (_, id) => {
  const sv = siteViewMap.get(id);
  if (sv && !sv.webContents.isDestroyed()) {
    try {
      sv.webContents.reload();
    } catch {}
  }
});
ipcMain.on("toolbar:back", (_, id) => {
  const sv = siteViewMap.get(id);
  if (sv) {
    try {
      if (sv.webContents.canGoBack()) sv.webContents.goBack();
    } catch {}
  }
});
ipcMain.on("toolbar:forward", (_, id) => {
  const sv = siteViewMap.get(id);
  if (sv) {
    try {
      if (sv.webContents.canGoForward()) sv.webContents.goForward();
    } catch {}
  }
});
ipcMain.handle("toolbar:getState", (_, id) => {
  const sv = siteViewMap.get(id);
  const info = toolbarInfoStore.get(id);
  if (!sv || sv.webContents.isDestroyed())
    return {
      canBack: false,
      canForward: false,
      loading: false,
      title: info?.name || "",
    };
  return {
    canBack: sv.webContents.canGoBack(),
    canForward: sv.webContents.canGoForward(),
    loading: sv.webContents.isLoading(),
    title: sv.webContents.getTitle() || info?.name || "",
  };
});
ipcMain.handle("toolbar:getInfo", (_, id) => toolbarInfoStore.get(id) || null);

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

  applyToPartition(partition);

  // ── Shell window ──────────────────────────────────────────────────────────
  const win = new BrowserWindow({
    width: winW,
    height: winH,
    minWidth: 600,
    minHeight: TOOLBAR_H + 200,
    title: webApp.name,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 13 },
    backgroundColor: "#1a1a1f",
    skipTaskbar: false,
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

  // ── WebContentsView ───────────────────────────────────────────────────────
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
  siteViewMap.set(webApp.id, siteView);

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

  // ── Push toolbar state ────────────────────────────────────────────────────
  function push(extra = {}) {
    if (win.isDestroyed()) return;
    try {
      win.webContents.send("toolbar:state", {
        canBack: siteView.webContents.canGoBack(),
        canForward: siteView.webContents.canGoForward(),
        loading: siteView.webContents.isLoading(),
        title: siteView.webContents.getTitle() || webApp.name,
        ...extra,
      });
    } catch {}
  }

  siteView.webContents.on("did-navigate", () => push({ loading: false }));
  siteView.webContents.on("did-navigate-in-page", () =>
    push({ loading: false }),
  );
  siteView.webContents.on("did-start-loading", () => push({ loading: true }));
  siteView.webContents.on("did-stop-loading", () => push({ loading: false }));
  siteView.webContents.on("page-title-updated", (_, t) => {
    push({ title: t || webApp.name });
    if (!win.isDestroyed()) win.setTitle(t || webApp.name);
  });
  // When toolbar HTML itself finishes loading, push current state immediately
  win.webContents.on("did-finish-load", () => push());

  // ── Popup / OAuth handling ────────────────────────────────────────────────
  function siteViewAlive() {
    try {
      return !!(
        siteView &&
        siteView.webContents &&
        !siteView.webContents.isDestroyed()
      );
    } catch {
      return false;
    }
  }

  const AUTH_HOSTS = [
    "accounts.google.com",
    "accounts.youtube.com",
    "appleid.apple.com",
    "login.microsoftonline.com",
    "login.live.com",
    "github.com",
    "notion.so",
    "notion.site",
    "anthropic.com",
    "claude.ai",
    "openai.com",
  ];
  function isAuthHost(url) {
    try {
      const h = new URL(url).hostname.replace(/^www\./, "");
      return AUTH_HOSTS.some((d) => h === d || h.endsWith("." + d));
    } catch {
      return false;
    }
  }
  function isSameOrigin(url) {
    try {
      const base = new URL(webApp.url);
      const dest = new URL(url);
      return (
        dest.hostname === base.hostname ||
        (webApp.whitelist || []).some((d) => dest.hostname.endsWith(d))
      );
    } catch {
      return false;
    }
  }
  function mustBePopup(url, disposition) {
    return (
      disposition === "new-window" ||
      disposition === "new-tab" ||
      isAuthHost(url)
    );
  }

  const activePopups = new Set();
  let oauthComplete = false;
  function closeAllPopups() {
    for (const p of activePopups) {
      try {
        if (!p.isDestroyed()) p.close();
      } catch {}
    }
    activePopups.clear();
  }
  function onPopupClosed() {
    if (oauthComplete) return;
    if (activePopups.size === 0)
      setTimeout(() => {
        try {
          if (siteViewAlive()) siteView.webContents.reload();
        } catch {}
      }, 600);
  }
  function watchPopup(pw) {
    pw.webContents.on("did-navigate", (_, u) => {
      try {
        const appHost = new URL(webApp.url).hostname;
        const navHost = new URL(u).hostname;
        const onApp =
          navHost === appHost || navHost === appHost.replace("www.", "");
        const isHelper =
          /verifyNoPopupBlocker|googlepopupredirect|loginWithGoogle/i.test(u);
        if (onApp && !isHelper && !oauthComplete) {
          oauthComplete = true;
          setTimeout(() => {
            closeAllPopups();
            if (siteViewAlive()) siteView.webContents.reload();
          }, 800);
        }
      } catch {}
    });
  }
  const popupOpts = {
    width: 520,
    height: 700,
    show: true,
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    webPreferences: {
      partition,
      nodeIntegration: false,
      contextIsolation: true,
    },
  };

  siteView.webContents.setWindowOpenHandler(({ url, disposition }) => {
    if (!url || url === "about:blank") return { action: "deny" };
    if (isAdDomain(url)) return { action: "deny" };
    if (mustBePopup(url, disposition))
      return { action: "allow", overrideBrowserWindowOptions: popupOpts };
    if (isSameOrigin(url)) {
      siteView.webContents.loadURL(url);
      return { action: "deny" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  siteView.webContents.on("did-create-window", (pw, details) => {
    if (isAdDomain(details.url || "")) {
      pw.destroy();
      return;
    }
    pw.setMenu(null);
    activePopups.add(pw);
    pw.webContents.setWindowOpenHandler(({ url: u }) => {
      if (!u || u === "about:blank" || isAdDomain(u)) return { action: "deny" };
      return { action: "allow", overrideBrowserWindowOptions: popupOpts };
    });
    pw.webContents.on("did-create-window", (gc) => {
      gc.setMenu(null);
      activePopups.add(gc);
      watchPopup(gc);
      gc.on("closed", () => {
        activePopups.delete(gc);
        onPopupClosed();
      });
    });
    watchPopup(pw);
    pw.on("closed", () => {
      activePopups.delete(pw);
      onPopupClosed();
    });
  });

  // ── Scrollbar polish ──────────────────────────────────────────────────────
  siteView.webContents.on("did-finish-load", () => {
    if (!siteViewAlive()) return;
    siteView.webContents
      .insertCSS(
        `
      ::-webkit-scrollbar{width:8px;height:8px}
      ::-webkit-scrollbar-track{background:transparent}
      ::-webkit-scrollbar-thumb{background:rgba(128,128,128,.35);border-radius:4px}
      ::-webkit-scrollbar-thumb:hover{background:rgba(128,128,128,.6)}`,
      )
      .catch(() => {});
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  win.on("close", () => {
    try {
      if (siteViewAlive()) {
        win.contentView.removeChildView(siteView);
        siteView.webContents.destroy();
      }
    } catch {}
  });
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
    siteViewMap.delete(webApp.id);
    launchedWindows.delete(webApp.id);
    updateDockMenu();
  });

  win.once("ready-to-show", () => {
    win.show();
    updateDockMenu();
  });
  launchedWindows.set(webApp.id, win);
}

// ── App-management IPC ─────────────────────────────────────────────────────────
ipcMain.handle("apps:list", () => loadApps());
ipcMain.handle("apps:save", (_, apps) => {
  saveApps(apps);
  return true;
});
ipcMain.handle("apps:launch", (_, wa) => {
  launchWebApp(wa);
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
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      {
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "ico", "icns", "svg"],
      },
    ],
  });
  if (r.canceled || !r.filePaths.length) return null;
  const data = fs.readFileSync(r.filePaths[0]);
  const ext = path.extname(r.filePaths[0]).slice(1).toLowerCase();
  const mime =
    ext === "svg" ? "image/svg+xml" : `image/${ext === "jpg" ? "jpeg" : ext}`;
  return `data:${mime};base64,${data.toString("base64")}`;
});

// ── Dock menu ─────────────────────────────────────────────────────────────────
function updateDockMenu() {
  if (process.platform !== "darwin" || !app.dock) return;
  const items = [];
  for (const [, w] of launchedWindows) {
    if (!w.isDestroyed())
      items.push({
        label: w.getTitle() || "App",
        click: () => {
          w.show();
          w.focus();
        },
      });
  }
  const open = {
    label: "Open Webapper",
    click: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
    },
  };
  app.dock.setMenu(
    Menu.buildFromTemplate(
      items.length ? [...items, { type: "separator" }, open] : [open],
    ),
  );
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  applyToDefaultSession();
  createMainWindow();
  app.on("activate", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    } else createMainWindow();
  });
});
app.on("before-quit", () => {
  for (const [, w] of launchedWindows) {
    try {
      if (!w.isDestroyed()) w.destroy();
    } catch {}
  }
  launchedWindows.clear();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
