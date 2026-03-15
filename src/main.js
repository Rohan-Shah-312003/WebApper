const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  shell,
  nativeImage,
  dialog,
  Menu,
  Tray,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { applyToPartition, applyToDefaultSession } = require("./adblocker");
const {
  installExtension,
  removeExtension,
  loadAllExtensionsIntoPartition,
  initExtensions,
  loadExtensionData,
} = require("./extensions");

// ── Platform helpers ───────────────────────────────────────────────────────────
const isMac = process.platform === "darwin";
const isWin = process.platform === "win32";
const isLinux = process.platform === "linux";

// ── GPU / sandbox flags ──────────────────────────────────────────────────────────────────────────────
if (isLinux) {
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-dev-shm-usage");
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("disable-gpu-sandbox");
  app.commandLine.appendSwitch("in-process-gpu");
  app.commandLine.appendSwitch("use-gl", "swiftshader");
  app.commandLine.appendSwitch("enable-unsafe-swiftshader");
  app.commandLine.appendSwitch("disable-software-rasterizer", "false");
  app.commandLine.appendSwitch("ozone-platform", "x11");
  const shmFallback = require("path").join(
    require("os").homedir(),
    ".webapper-tmp",
  );
  try {
    require("fs").mkdirSync(shmFallback, { recursive: true });
  } catch {}
  process.env.TMPDIR = shmFallback;
  process.env.TEMP = shmFallback;
  process.env.TMP = shmFallback;
} else {
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("disable-software-rasterizer");
  app.commandLine.appendSwitch("no-sandbox");
}

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

// Globals
let mainWindow = null;
let tray = null;
const launchedWindows = new Map();
const siteViewMap = new Map();
const toolbarInfoStore = new Map();
const TOOLBAR_H = 44;

// ── Title bar style per platform ──────────────────────────────────────────────
function getTitleBarOptions(isWebAppWindow = false) {
  if (isMac) {
    return {
      titleBarStyle: "hiddenInset",
      ...(isWebAppWindow ? { trafficLightPosition: { x: 12, y: 13 } } : {}),
    };
  }
  return {
    titleBarStyle: "default",
    autoHideMenuBar: false,
  };
}

// Main window
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 800,
    minHeight: 560,
    ...getTitleBarOptions(false),
    backgroundColor: "#0f0f11",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      // Use a dedicated partition for the main UI so extensions loaded into
      // defaultSession don't interfere with it at all
      partition: "persist:webapper_ui",
    },
    show: false,
    paintWhenInitiallyHidden: true,
    title: "Webapper",
  });
  mainWindow.loadFile(path.join(__dirname, "ui", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.send("platform", process.platform);
  });

  buildAppMenu();

  if (!isMac) {
    mainWindow.on("close", (e) => {
      if (!app.isQuitting && tray && !tray.isDestroyed()) {
        e.preventDefault();
        mainWindow.hide();
      }
    });
  }
}

// ── Application menu ──────────────────────────────────────────────────────────
function buildAppMenu() {
  const template = [
    ...(isMac
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
      : [
          {
            label: "File",
            submenu: [
              {
                label: "Show Webapper",
                accelerator: "CmdOrCtrl+Shift+W",
                click: () => {
                  if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.show();
                    mainWindow.focus();
                  }
                },
              },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]),
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

// ── System Tray (Windows & Linux) ─────────────────────────────────────────────
function buildTrayIcon() {
  const candidates = isWin
    ? [
        path.join(__dirname, "..", "assets", "icon.ico"),
        path.join(__dirname, "..", "assets", "icon.png"),
      ]
    : [path.join(__dirname, "..", "assets", "icon.png")];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const img = nativeImage.createFromPath(p);
        if (!img.isEmpty()) return img.resize({ width: 16, height: 16 });
      }
    } catch {}
  }

  const FALLBACK_PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAANklEQVQ4T2NkoBAwUqifYdQA" +
    "hjAIDgMGBgYGJioZwECFMBg1gIFKYTBqAAOVwmDUAAYqhQEAMAAIAAEbPL4AAAAASUVORK5CYII=";

  return nativeImage.createFromDataURL(
    `data:image/png;base64,${FALLBACK_PNG_BASE64}`,
  );
}

function createTray() {
  if (isMac) return;

  try {
    tray = new Tray(buildTrayIcon());
    tray.setToolTip("Webapper");
    updateTrayMenu();

    tray.on("click", () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    tray.on("double-click", () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (err) {
    console.warn("Tray creation failed:", err.message);
  }
}

function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) return;

  const openAppItems = [];
  for (const [, w] of launchedWindows) {
    if (!w.isDestroyed()) {
      let label = "App";
      try {
        label = w.getTitle() || "App";
      } catch {}
      openAppItems.push({
        label,
        click: () => {
          try {
            w.show();
            w.focus();
          } catch {}
        },
      });
    }
  }

  const menuTemplate = [
    {
      label: "Show Webapper",
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    ...(openAppItems.length ? [{ type: "separator" }, ...openAppItems] : []),
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ];

  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate));
}

// ── Dock menu (macOS only) ─────────────────────────────────────────────────────
function updateDockMenu() {
  if (!isMac || !app.dock) return;
  const items = [];
  for (const [, w] of launchedWindows) {
    if (!w.isDestroyed()) {
      let label = "App";
      try {
        label = w.getTitle() || "App";
      } catch {}
      items.push({
        label,
        click: () => {
          try {
            w.show();
            w.focus();
          } catch {}
        },
      });
    }
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

// ── Global toolbar IPC ─────────────────────────────────────────────────────────
ipcMain.on("toolbar:reload", (_, id) => {
  const sv = siteViewMap.get(id);
  if (sv && !sv.webContents.isDestroyed()) sv.webContents.reload();
});
ipcMain.on("toolbar:back", (_, id) => {
  const sv = siteViewMap.get(id);
  if (sv && !sv.webContents.isDestroyed() && sv.webContents.canGoBack())
    sv.webContents.goBack();
});
ipcMain.on("toolbar:forward", (_, id) => {
  const sv = siteViewMap.get(id);
  if (sv && !sv.webContents.isDestroyed() && sv.webContents.canGoForward())
    sv.webContents.goForward();
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
    title: sv.webContents.getTitle() || info?.name,
  };
});
ipcMain.handle("toolbar:getInfo", (_, id) => toolbarInfoStore.get(id) || null);

ipcMain.handle("platform:get", () => process.platform);

// ── Launch web app window ──────────────────────────────────────────────────────
function launchWebApp(webApp) {
  if (launchedWindows.has(webApp.id)) {
    const ex = launchedWindows.get(webApp.id);
    if (!ex.isDestroyed()) {
      ex.show();
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
  loadAllExtensionsIntoPartition(partition).catch(() => {});

  const win = new BrowserWindow({
    width: winW,
    height: winH,
    minWidth: 600,
    minHeight: TOOLBAR_H + 200,
    title: webApp.name,
    ...getTitleBarOptions(true),
    backgroundColor: "#1a1a1f",
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
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
    platform: process.platform,
  });

  win.loadFile(path.join(__dirname, "toolbar", "toolbar.html"), {
    query: { appId: webApp.id },
  });

  const siteView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      partition,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  win.contentView.addChildView(siteView);
  siteViewMap.set(webApp.id, siteView);
  siteView.setBackgroundColor("#1a1a1f");

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

  let toolbarReady = false;
  let pendingState = null;

  function push(extra = {}) {
    if (win.isDestroyed()) return;
    const pageTitle = !siteView.webContents.isDestroyed()
      ? siteView.webContents.getTitle()
      : "";
    const state = {
      canBack:
        !siteView.webContents.isDestroyed() && siteView.webContents.canGoBack(),
      canForward:
        !siteView.webContents.isDestroyed() &&
        siteView.webContents.canGoForward(),
      loading:
        !siteView.webContents.isDestroyed() && siteView.webContents.isLoading(),
      title: pageTitle || webApp.name,
      ...extra,
    };
    if (!toolbarReady) {
      pendingState = state;
      return;
    }
    win.webContents.send("toolbar:state", state);
  }

  siteView.webContents.on("did-navigate", () => push({ loading: false }));
  siteView.webContents.on("did-navigate-in-page", () =>
    push({ loading: false }),
  );
  siteView.webContents.on("did-start-loading", () => push({ loading: true }));
  siteView.webContents.on("did-stop-loading", () => push({ loading: false }));
  siteView.webContents.on("page-title-updated", (_, t) => {
    const title = t || webApp.name;
    push({ title });
    if (!win.isDestroyed()) win.setTitle(title);
  });

  win.webContents.on("did-finish-load", () => {
    toolbarReady = true;
    const state = pendingState || {
      canBack:
        !siteView.webContents.isDestroyed() && siteView.webContents.canGoBack(),
      canForward:
        !siteView.webContents.isDestroyed() &&
        siteView.webContents.canGoForward(),
      loading:
        !siteView.webContents.isDestroyed() && siteView.webContents.isLoading(),
      title:
        (!siteView.webContents.isDestroyed() &&
          siteView.webContents.getTitle()) ||
        webApp.name,
    };
    pendingState = null;
    try {
      win.webContents.send("toolbar:state", state);
    } catch {}
  });

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

  siteView.webContents.on("did-finish-load", () => {
    if (!siteViewAlive()) return;
    siteView.webContents
      .insertCSS(
        `::-webkit-scrollbar{width:8px;height:8px}
       ::-webkit-scrollbar-track{background:transparent}
       ::-webkit-scrollbar-thumb{background:rgba(128,128,128,.35);border-radius:4px}
       ::-webkit-scrollbar-thumb:hover{background:rgba(128,128,128,.6)}`,
      )
      .catch(() => {});
  });

  let lastSize = [winW, winH];
  win.on("close", () => {
    try {
      lastSize = win.getSize();
    } catch {}
    if (siteViewAlive()) {
      try {
        if (win.contentView) win.contentView.removeChildView(siteView);
      } catch {}
      try {
        siteView.webContents.destroy();
      } catch {}
    }
  });
  win.on("closed", () => {
    const all = loadApps();
    const idx = all.findIndex((a) => a.id === webApp.id);
    if (idx !== -1) {
      all[idx].windowWidth = lastSize[0];
      all[idx].windowHeight = lastSize[1];
      all[idx].lastOpened = new Date().toISOString();
      saveApps(all);
    }
    toolbarInfoStore.delete(webApp.id);
    siteViewMap.delete(webApp.id);
    launchedWindows.delete(webApp.id);
    updateDockMenu();
    updateTrayMenu();
  });

  win.once("ready-to-show", () => {
    win.show();
    updateDockMenu();
    updateTrayMenu();
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
  if (w && !w.isDestroyed()) {
    try {
      w.close();
    } catch {
      try {
        w.destroy();
      } catch {}
    }
  }
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

// ── Extension IPC ────────────────────────────────────────────────────────────
ipcMain.handle("extensions:list", () => loadExtensionData());

ipcMain.handle("extensions:install", async (_, urlOrId) => {
  try {
    const record = await installExtension(urlOrId);
    return { ok: true, extension: record };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("extensions:remove", async (_, id) => {
  try {
    await removeExtension(id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── Lifecycle ──────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  applyToDefaultSession();

  // Init extensions first (validates dirs, patches backgrounds) — this is
  // fast and purely synchronous file I/O, no session.loadExtension calls.
  // Extensions are only loaded into sessions when a web app window opens.
  try {
    await initExtensions();
  } catch {}

  createMainWindow();
  createTray();

  app.on("activate", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createMainWindow();
    }
  });
});

app.on("before-quit", () => {
  app.isQuitting = true;
  for (const [, w] of launchedWindows) {
    try {
      if (!w.isDestroyed()) w.destroy();
    } catch {}
  }
  launchedWindows.clear();
});

app.on("window-all-closed", () => {
  if (isMac) {
    app.quit();
    return;
  }
  if (!tray || tray.isDestroyed()) app.quit();
});
