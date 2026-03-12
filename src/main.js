const { app, BrowserWindow, WebContentsView, ipcMain, shell, nativeImage, dialog, Menu } = require('electron');
const path = require('path');
const fs   = require('fs');

// ── Storage ────────────────────────────────────────────────────────────────────
const DATA_PATH = path.join(app.getPath('userData'), 'webapps.json');

function loadApps() {
  try { if (fs.existsSync(DATA_PATH)) return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); }
  catch {}
  return [];
}
function saveApps(apps) { fs.writeFileSync(DATA_PATH, JSON.stringify(apps, null, 2)); }

// ── Globals ────────────────────────────────────────────────────────────────────
let mainWindow = null;
const launchedWindows = new Map();
const TOOLBAR_H = 44;

// ── Main window ────────────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 960, height: 680, minWidth: 800, minHeight: 560,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0f0f11',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    show: false,
  });
  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  const template = [
    ...(process.platform === 'darwin' ? [{ label: app.name, submenu: [
      { role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' },
      { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }
    ]}] : []),
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
      { role: 'togglefullscreen' }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Launch a web app window ────────────────────────────────────────────────────
function launchWebApp(webApp) {
  if (launchedWindows.has(webApp.id)) {
    const ex = launchedWindows.get(webApp.id);
    if (!ex.isDestroyed()) { ex.focus(); return; }
  }

  const isIncognito = webApp.mode === 'incognito';
  const winW = webApp.windowWidth  || 1200;
  const winH = webApp.windowHeight || 800;

  // ── 1. Shell window: loads the toolbar HTML in its OWN webContents ────────
  //    titleBarStyle:'hiddenInset' puts traffic lights inside our toolbar area.
  //    The window itself renders toolbar.html — it is NOT a bare frame.
  const win = new BrowserWindow({
    width: winW, height: winH, minWidth: 600, minHeight: TOOLBAR_H + 200,
    title: webApp.name,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 13 },
    backgroundColor: '#1a1a1f',
    webPreferences: {
      preload: path.join(__dirname, 'toolbar-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  if (webApp.iconDataUrl) {
    try { win.setIcon(nativeImage.createFromDataURL(webApp.iconDataUrl)); } catch {}
  }

  // Build toolbar URL with query params
  const tbUrl = new URL(`file://${path.join(__dirname, 'toolbar', 'toolbar.html')}`);
  tbUrl.searchParams.set('appId',  webApp.id);
  tbUrl.searchParams.set('name',   webApp.name);
  tbUrl.searchParams.set('url',    webApp.url);
  tbUrl.searchParams.set('icon',   webApp.icon || '🌐');
  tbUrl.searchParams.set('mode',   webApp.mode  || 'standard');
  if (webApp.iconDataUrl) tbUrl.searchParams.set('iconData', webApp.iconDataUrl);
  win.loadURL(tbUrl.toString());

  // ── 2. WebContentsView for the website — sits below the toolbar ───────────
  //    We add it to win.contentView (the root view that already contains the
  //    toolbar's webContents). Because the toolbar is painted by the window's
  //    OWN renderer at y=0..TOOLBAR_H, the WebContentsView starts at y=TOOLBAR_H
  //    and never overlaps it.
  const siteView = new WebContentsView({
    webPreferences: {
      partition: isIncognito ? `incognito:${webApp.id}` : `persist:webapp_${webApp.id}`,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  // contentView is the root BaseView that Electron creates for every
  // BrowserWindow — addChildView is available in Electron 29+.
  win.contentView.addChildView(siteView);

  function layout() {
    const [w, h] = win.getContentSize();
    siteView.setBounds({ x: 0, y: TOOLBAR_H, width: w, height: Math.max(0, h - TOOLBAR_H) });
  }
  layout();
  win.on('resize', layout);

  siteView.webContents.loadURL(webApp.url);

  // ── 3. IPC — toolbar buttons ──────────────────────────────────────────────
  ipcMain.on(`toolbar:back:${webApp.id}`,    () => { if (siteView.webContents.canGoBack())    siteView.webContents.goBack(); });
  ipcMain.on(`toolbar:forward:${webApp.id}`, () => { if (siteView.webContents.canGoForward()) siteView.webContents.goForward(); });
  ipcMain.on(`toolbar:reload:${webApp.id}`,  () => siteView.webContents.reload());
  ipcMain.on(`toolbar:home:${webApp.id}`,    () => siteView.webContents.loadURL(webApp.url));

  // ── 4. Push nav state → toolbar ──────────────────────────────────────────
  function push(extra = {}) {
    if (win.isDestroyed()) return;
    win.webContents.send('toolbar:update', {
      canBack:    siteView.webContents.canGoBack(),
      canForward: siteView.webContents.canGoForward(),
      ...extra,
    });
  }
  siteView.webContents.on('did-navigate',         (_, url) => push({ url, loading: false }));
  siteView.webContents.on('did-navigate-in-page', (_, url) => push({ url, loading: false }));
  siteView.webContents.on('did-start-loading',    ()       => push({ loading: true }));
  siteView.webContents.on('did-stop-loading',     ()       => push({ loading: false }));
  siteView.webContents.on('page-title-updated',   (_, t)   => { if (!win.isDestroyed()) win.setTitle(t || webApp.name); });

  // ── 5. Link routing ───────────────────────────────────────────────────────
  siteView.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const base = new URL(webApp.url);
      const dest = new URL(url);
      const internal = dest.hostname === base.hostname ||
        (webApp.whitelist || []).some(d => dest.hostname.endsWith(d));
      if (internal) { siteView.webContents.loadURL(url); return { action: 'deny' }; }
    } catch {}
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // ── 6. Scrollbar polish ───────────────────────────────────────────────────
  siteView.webContents.on('did-finish-load', () => {
    siteView.webContents.insertCSS(`
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.35); border-radius: 4px; }
      ::-webkit-scrollbar-thumb:hover { background: rgba(128,128,128,0.6); }
    `);
  });

  // ── 7. Cleanup ────────────────────────────────────────────────────────────
  win.on('closed', () => {
    try {
      const sz  = win.getSize ? win.getSize() : [winW, winH];
      const all = loadApps();
      const idx = all.findIndex(a => a.id === webApp.id);
      if (idx !== -1) {
        all[idx].windowWidth  = sz[0];
        all[idx].windowHeight = sz[1];
        all[idx].lastOpened   = new Date().toISOString();
        saveApps(all);
      }
    } catch {}
    ipcMain.removeAllListeners(`toolbar:back:${webApp.id}`);
    ipcMain.removeAllListeners(`toolbar:forward:${webApp.id}`);
    ipcMain.removeAllListeners(`toolbar:reload:${webApp.id}`);
    ipcMain.removeAllListeners(`toolbar:home:${webApp.id}`);
    launchedWindows.delete(webApp.id);
  });

  win.once('ready-to-show', () => win.show());
  launchedWindows.set(webApp.id, win);
}

// ── IPC handlers ───────────────────────────────────────────────────────────────
ipcMain.handle('apps:list',   () => loadApps());
ipcMain.handle('apps:save',   (_, apps) => { saveApps(apps); return true; });
ipcMain.handle('apps:launch', (_, webApp) => { launchWebApp(webApp); return true; });
ipcMain.handle('apps:delete', (_, id) => {
  saveApps(loadApps().filter(a => a.id !== id));
  const w = launchedWindows.get(id);
  if (w && !w.isDestroyed()) w.close();
  return true;
});
ipcMain.handle('app:fetchFavicon', async (_, url) => {
  try {
    const { hostname, origin } = new URL(url);
    return [
      `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`,
      `${origin}/favicon.ico`,
      `${origin}/apple-touch-icon.png`,
    ];
  } catch { return []; }
});
ipcMain.handle('dialog:pickImage', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png','jpg','jpeg','ico','icns','svg'] }]
  });
  if (result.canceled || !result.filePaths.length) return null;
  const data = fs.readFileSync(result.filePaths[0]);
  const ext  = path.extname(result.filePaths[0]).slice(1).toLowerCase();
  const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  return `data:${mime};base64,${data.toString('base64')}`;
});

// ── App lifecycle ──────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
  });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
