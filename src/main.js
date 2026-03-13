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

// ── Ad-domain check ────────────────────────────────────────────────────────────
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

  // ── 2. WebContentsView (the actual site) ──────────────────────────────────
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

  // ── 3. Toolbar IPC ────────────────────────────────────────────────────────
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

  // ── 4. Toolbar nav-state push ─────────────────────────────────────────────
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
  // We intercept ALL window.open() calls via setWindowOpenHandler, always
  // returning { action: "deny" }, then manually decide what to do:
  //
  //   • Ad domain          → drop silently
  //   • Same-origin link   → navigate siteView in place
  //   • Auth / OAuth URL   → open a controlled BrowserWindow popup (show:true,
  //                          correct partition, no blank window problem)
  //   • Everything else    → open in OS browser
  //
  // Why NOT use action:"allow" + overrideBrowserWindowOptions:
  //   - Electron-created popups can render blank because show:true isn't
  //     set by default and can't be overridden via overrideBrowserWindowOptions
  //     in all Electron versions.
  //   - We can't fully control webPreferences (partition, sandbox) that way.
  //   - Google sign-in detects missing features and shows an error page.
  //
  // For the OAuth redirect (Google → notion.so?code=...) we watch
  // did-navigate on the popup and reload siteView when it lands on the app
  // domain. postMessage is NOT required — Notion uses the redirect flow.

  // Guard: siteView.webContents can become undefined when parent win closes
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

  // Domains we open as a controlled auth popup (not OS browser)
  const AUTH_HOSTS = [
    "accounts.google.com",
    "accounts.youtube.com",
    "appleid.apple.com",
    "login.microsoftonline.com",
    "login.live.com",
    "github.com",
    "notion.so", // Notion opens OAuth popups on its own domain
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

  function isSameOriginOrWhitelisted(url) {
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

  // Track all open auth popups so we know when all are gone
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

  function handlePopupClosed() {
    console.log(
      "[popup] closed. remaining:",
      activePopups.size,
      "| oauthComplete:",
      oauthComplete,
    );
    if (oauthComplete) return;
    if (activePopups.size === 0) {
      // All popups gone without a detected redirect — reload softly so any
      // completed session (e.g. email sign-in) is picked up.
      setTimeout(() => {
        try {
          if (siteViewAlive()) siteView.webContents.reload();
        } catch {}
      }, 600);
    }
  }

  function attachOAuthWatcher(popupWin) {
    popupWin.webContents.on("did-navigate", (_, navUrl) => {
      console.log("[popup] did-navigate:", navUrl);
      try {
        const appHost = new URL(webApp.url).hostname;
        const navHost = new URL(navUrl).hostname;
        const isAppDomain =
          navHost === appHost || navHost === appHost.replace("www.", "");
        const isHelperPage =
          /verifyNoPopupBlocker|googlepopupredirect|loginWithGoogle/i.test(
            navUrl,
          );
        if (isAppDomain && !isHelperPage && !oauthComplete) {
          oauthComplete = true;
          console.log("[popup] OAuth complete! Reloading siteView");
          setTimeout(() => {
            closeAllPopups();
            if (siteViewAlive()) siteView.webContents.reload();
          }, 800);
        }
      } catch {}
    });
    popupWin.webContents.on("did-fail-load", (_, code, desc, u) => {
      console.log("[popup] did-fail-load:", code, desc, u);
    });
    popupWin.webContents.on("will-navigate", (_, navUrl) => {
      console.log("[popup] will-navigate:", navUrl);
    });
  }

  // Some apps (e.g. Notion) test for popup support by calling window.open()
  // on their OWN domain before launching the real OAuth popup. If disposition
  // is "new-window" we must honour it as a real popup regardless of origin —
  // otherwise the app thinks popups are blocked and refuses to continue.
  function mustBePopup(url, disposition) {
    if (disposition === "new-window" || disposition === "new-tab") return true;
    return isAuthHost(url);
  }

  siteView.webContents.setWindowOpenHandler(({ url, disposition }) => {
    if (!url || url === "about:blank") return { action: "deny" };

    // 1. Ad domain → silently drop
    if (isAdDomain(url)) return { action: "deny" };

    // 2. Must be a real popup (new-window disposition OR known auth host).
    //    Return action:"allow" so Electron creates the window with window.opener
    //    intact — Notion uses postMessage via window.opener to signal auth
    //    completion back to the main page. We MUST preserve that relationship.
    if (mustBePopup(url, disposition)) {
      console.log("[popup] allowing popup (opener preserved):", url);
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
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
        },
      };
    }

    // 3. Same-origin / whitelisted plain link → navigate siteView in place
    if (isSameOriginOrWhitelisted(url)) {
      siteView.webContents.loadURL(url);
      return { action: "deny" };
    }

    // 4. Everything else → OS browser
    shell.openExternal(url);
    return { action: "deny" };
  });

  // did-create-window fires after action:"allow" — attach tracking here
  siteView.webContents.on("did-create-window", (popupWin, details) => {
    const openedUrl = details.url || "";
    console.log("[popup] did-create-window:", openedUrl);

    if (isAdDomain(openedUrl)) {
      popupWin.destroy();
      return;
    }

    popupWin.setMenu(null);
    activePopups.add(popupWin);

    // Any further popups this window spawns also need opener preserved
    popupWin.webContents.setWindowOpenHandler(
      ({ url: childUrl, disposition: d }) => {
        console.log("[popup] child window.open:", childUrl);
        if (!childUrl || childUrl === "about:blank") return { action: "deny" };
        if (isAdDomain(childUrl)) return { action: "deny" };
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
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
          },
        };
      },
    );

    // Track grandchild popups (Google account chooser etc.)
    popupWin.webContents.on("did-create-window", (grandchild) => {
      console.log("[popup] grandchild created");
      grandchild.setMenu(null);
      activePopups.add(grandchild);
      attachOAuthWatcher(grandchild);
      grandchild.on("closed", () => {
        activePopups.delete(grandchild);
        handlePopupClosed();
      });
    });

    attachOAuthWatcher(popupWin);

    popupWin.on("closed", () => {
      activePopups.delete(popupWin);
      handlePopupClosed();
    });
  });

  // ── 6. Scrollbar polish ───────────────────────────────────────────────────
  siteView.webContents.on("did-finish-load", () => {
    if (!siteViewAlive()) return;
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

ipcMain.handle(
  "toolbar:getInfo",
  (_, appId) => toolbarInfoStore.get(appId) || null,
);

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
