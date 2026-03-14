// ── State ──────────────────────────────────────────────────────────────────────
let apps = [];
let editingId = null;
let currentFilter = "all";
let contextTarget = null;
let currentPlatform = "darwin"; // updated after init

// ── Gallery data ───────────────────────────────────────────────────────────────
const GALLERY = [
  {
    name: "Gmail",
    url: "https://mail.google.com",
    icon: "📧",
    mode: "standard",
  },
  {
    name: "Google Calendar",
    url: "https://calendar.google.com",
    icon: "📅",
    mode: "standard",
  },
  {
    name: "Google Drive",
    url: "https://drive.google.com",
    icon: "📁",
    mode: "tabbed",
  },
  {
    name: "Google Docs",
    url: "https://docs.google.com",
    icon: "📝",
    mode: "tabbed",
  },
  {
    name: "Notion",
    url: "https://www.notion.so",
    icon: "🗒",
    mode: "standard",
  },
  { name: "Slack", url: "https://app.slack.com", icon: "💬", mode: "standard" },
  { name: "Linear", url: "https://linear.app", icon: "📐", mode: "standard" },
  { name: "Figma", url: "https://www.figma.com", icon: "🎨", mode: "tabbed" },
  { name: "GitHub", url: "https://github.com", icon: "🐙", mode: "tabbed" },
  {
    name: "ChatGPT",
    url: "https://chat.openai.com",
    icon: "🤖",
    mode: "standard",
  },
  { name: "Claude", url: "https://claude.ai", icon: "🧠", mode: "standard" },
  { name: "YouTube", url: "https://youtube.com", icon: "▶️", mode: "standard" },
  {
    name: "Spotify Web",
    url: "https://open.spotify.com",
    icon: "🎵",
    mode: "standard",
  },
  { name: "Twitter / X", url: "https://x.com", icon: "𝕏", mode: "standard" },
  { name: "Trello", url: "https://trello.com", icon: "📋", mode: "tabbed" },
  { name: "Airtable", url: "https://airtable.com", icon: "📊", mode: "tabbed" },
  {
    name: "WhatsApp Web",
    url: "https://web.whatsapp.com",
    icon: "💚",
    mode: "standard",
  },
  { name: "Reddit", url: "https://reddit.com", icon: "🔴", mode: "tabbed" },
  { name: "Jira", url: "https://id.atlassian.com", icon: "🔵", mode: "tabbed" },
  { name: "Plex", url: "https://app.plex.tv", icon: "🎬", mode: "standard" },
];

// ── Helpers ────────────────────────────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function hostname(url) {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return url;
  }
}

function modeClass(mode) {
  return (
    {
      standard: "badge-standard",
      tabbed: "badge-tabbed",
      incognito: "badge-incognito",
    }[mode] || "badge-standard"
  );
}

// ── Platform-aware titlebar height ────────────────────────────────────────────
function applyTitlebarHeight(platform) {
  // macOS hiddenInset overlays ~28px of content; on Windows/Linux the native
  // system title bar sits outside the client area so no extra padding is needed.
  const h = platform === "darwin" ? "28px" : "0px";
  document.documentElement.style.setProperty("--titlebar-h", h);
}

// ── Render ─────────────────────────────────────────────────────────────────────
function renderLibrary() {
  const grid = document.getElementById("appGrid");
  const empty = document.getElementById("emptyState");
  const search = document.getElementById("searchInput").value.toLowerCase();

  const filtered = apps.filter((a) => {
    const matchSearch =
      !search ||
      a.name.toLowerCase().includes(search) ||
      a.url.toLowerCase().includes(search);
    const matchFilter = currentFilter === "all" || a.mode === currentFilter;
    return matchSearch && matchFilter;
  });

  if (filtered.length === 0) {
    grid.style.display = "none";
    empty.style.display = "flex";
    return;
  }

  grid.style.display = "grid";
  empty.style.display = "none";
  grid.innerHTML = "";

  filtered.forEach((app, i) => {
    const card = document.createElement("div");
    card.className = "app-card";
    card.style.animationDelay = `${i * 0.04}s`;
    card.dataset.id = app.id;

    const iconHtml = app.iconDataUrl
      ? `<img src="${app.iconDataUrl}" alt="${app.name}" />`
      : `<span>${app.icon || "🌐"}</span>`;

    card.innerHTML = `
      <span class="app-card-badge ${modeClass(app.mode)}">${app.mode}</span>
      <div class="app-card-icon">${iconHtml}</div>
      <div class="app-card-name">${escHtml(app.name)}</div>
      <div class="app-card-url">${escHtml(hostname(app.url))}</div>
    `;

    card.addEventListener("dblclick", () => launchApp(app));
    card.addEventListener("click", () => launchApp(app));
    card.addEventListener("contextmenu", (e) => showContextMenu(e, app));
    grid.appendChild(card);
  });
}

function renderGallery() {
  const grid = document.getElementById("galleryGrid");
  grid.innerHTML = "";

  GALLERY.forEach((item) => {
    const card = document.createElement("div");
    card.className = "gallery-card";
    card.innerHTML = `
      <div class="gallery-card-icon">${item.icon}</div>
      <div class="gallery-card-info">
        <div class="gallery-card-name">${escHtml(item.name)}</div>
        <div class="gallery-card-url">${escHtml(hostname(item.url))}</div>
      </div>
      <button class="gallery-card-add" title="Add app">+</button>
    `;
    card.querySelector(".gallery-card-add").addEventListener("click", (e) => {
      e.stopPropagation();
      addFromGallery(item);
    });
    grid.appendChild(card);
  });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── App actions ────────────────────────────────────────────────────────────────
async function launchApp(app) {
  await window.webapper.launchApp(app);
}

async function deleteApp(id) {
  if (!confirm("Delete this app?")) return;
  apps = apps.filter((a) => a.id !== id);
  await window.webapper.deleteApp(id);
  renderLibrary();
}

function addFromGallery(item) {
  openModal({
    name: item.name,
    url: item.url,
    icon: item.icon,
    mode: item.mode,
  });
}

// ── Modal ──────────────────────────────────────────────────────────────────────
let modalIconDataUrl = null;

function openModal(prefill = {}) {
  editingId = prefill.id || null;
  modalIconDataUrl = prefill.iconDataUrl || null;

  document.getElementById("modalTitle").textContent = editingId
    ? "Edit App"
    : "New App";
  document.getElementById("btnSave").textContent = editingId
    ? "Save Changes"
    : "Create App";

  document.getElementById("fieldUrl").value = prefill.url || "";
  document.getElementById("fieldName").value = prefill.name || "";
  document.getElementById("fieldWhitelist").value = (
    prefill.whitelist || ["google.com", "accounts.google.com"]
  ).join("\n");
  document.getElementById("fieldWidth").value = prefill.windowWidth || 1200;
  document.getElementById("fieldHeight").value = prefill.windowHeight || 800;

  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.classList.toggle(
      "active",
      btn.dataset.mode === (prefill.mode || "standard"),
    );
  });

  updateIconPreview(prefill.icon || "🌐", prefill.iconDataUrl || null);
  switchView("library");
  document.getElementById("modalOverlay").classList.add("open");
  document.getElementById("fieldUrl").focus();
}

function closeModal() {
  document.getElementById("modalOverlay").classList.remove("open");
  editingId = null;
  modalIconDataUrl = null;
}

function updateIconPreview(emoji, dataUrl) {
  const emojiEl = document.getElementById("iconEmoji");
  const imgEl = document.getElementById("iconImg");
  if (dataUrl) {
    emojiEl.style.display = "none";
    imgEl.style.display = "block";
    imgEl.src = dataUrl;
    modalIconDataUrl = dataUrl;
  } else {
    emojiEl.style.display = "";
    imgEl.style.display = "none";
    emojiEl.textContent = emoji || "🌐";
    modalIconDataUrl = null;
  }
}

function getSelectedMode() {
  return document.querySelector(".mode-btn.active")?.dataset.mode || "standard";
}

async function saveApp() {
  const url = document.getElementById("fieldUrl").value.trim();
  const name = document.getElementById("fieldName").value.trim();

  if (!url) {
    document.getElementById("fieldUrl").focus();
    return;
  }
  if (!name) {
    document.getElementById("fieldName").focus();
    return;
  }

  let finalUrl = url;
  if (!/^https?:\/\//i.test(url)) finalUrl = "https://" + url;

  const whitelistRaw = document.getElementById("fieldWhitelist").value.trim();
  const whitelist = whitelistRaw
    ? whitelistRaw
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const appData = {
    id: editingId || uid(),
    name,
    url: finalUrl,
    icon: modalIconDataUrl
      ? null
      : document.getElementById("iconEmoji").textContent || "🌐",
    iconDataUrl: modalIconDataUrl,
    mode: getSelectedMode(),
    whitelist,
    windowWidth: parseInt(document.getElementById("fieldWidth").value) || 1200,
    windowHeight: parseInt(document.getElementById("fieldHeight").value) || 800,
    createdAt: editingId ? undefined : new Date().toISOString(),
    lastOpened: null,
  };

  if (editingId) {
    const idx = apps.findIndex((a) => a.id === editingId);
    if (idx !== -1) {
      appData.createdAt = apps[idx].createdAt;
      appData.lastOpened = apps[idx].lastOpened;
      apps[idx] = appData;
    }
  } else {
    apps.unshift(appData);
  }

  await window.webapper.saveApps(apps);
  closeModal();
  renderLibrary();
}

// ── Context menu ───────────────────────────────────────────────────────────────
function showContextMenu(e, app) {
  e.preventDefault();
  contextTarget = app;
  const menu = document.getElementById("contextMenu");
  menu.style.display = "block";
  menu.style.left = `${Math.min(e.clientX, window.innerWidth - 170)}px`;
  menu.style.top = `${Math.min(e.clientY, window.innerHeight - 110)}px`;
}

function hideContextMenu() {
  document.getElementById("contextMenu").style.display = "none";
  contextTarget = null;
}

// ── View switching ─────────────────────────────────────────────────────────────
function switchView(viewId) {
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.remove("active"));
  document.getElementById(`view-${viewId}`).classList.add("active");
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === viewId);
  });
  if (viewId === "gallery") renderGallery();
}

// ── URL → name suggestion ──────────────────────────────────────────────────────
let urlDebounce;
function suggestNameFromUrl(url) {
  clearTimeout(urlDebounce);
  urlDebounce = setTimeout(() => {
    const nameField = document.getElementById("fieldName");
    if (nameField.value) return;
    try {
      const u = new URL(url.includes("://") ? url : "https://" + url);
      const parts = u.hostname.replace("www.", "").split(".");
      if (parts[0])
        nameField.value = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    } catch {}
  }, 400);
}

// ── Init ───────────────────────────────────────────────────────────────────────
async function init() {
  // Detect platform and set titlebar height CSS variable
  currentPlatform = await window.webapper.getPlatform();
  applyTitlebarHeight(currentPlatform);

  // Also listen for push (main window sends it after load)
  window.webapper.onPlatform((p) => {
    currentPlatform = p;
    applyTitlebarHeight(p);
  });

  apps = await window.webapper.listApps();
  renderLibrary();
  renderGallery();

  // Nav
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  // New app buttons
  document
    .getElementById("btnNewApp")
    .addEventListener("click", () => openModal());
  document
    .getElementById("btnNewAppEmpty")
    .addEventListener("click", () => openModal());

  // Modal
  document.getElementById("modalClose").addEventListener("click", closeModal);
  document.getElementById("btnCancel").addEventListener("click", closeModal);
  document.getElementById("btnSave").addEventListener("click", saveApp);
  document.getElementById("modalOverlay").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Mode selector
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".mode-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  // Icon actions
  document.getElementById("btnPickIcon").addEventListener("click", async () => {
    const dataUrl = await window.webapper.pickImage();
    if (dataUrl) updateIconPreview(null, dataUrl);
  });

  document.getElementById("iconPreview").addEventListener("click", async () => {
    const dataUrl = await window.webapper.pickImage();
    if (dataUrl) updateIconPreview(null, dataUrl);
  });

  document
    .getElementById("btnFetchFavicon")
    .addEventListener("click", async () => {
      const url = document.getElementById("fieldUrl").value.trim();
      if (!url) return;
      const suggestions = await window.webapper.fetchFavicon(url);
      if (suggestions && suggestions[0]) {
        updateIconPreview(null, null);
        const imgEl = document.getElementById("iconImg");
        const emojiEl = document.getElementById("iconEmoji");
        imgEl.src = suggestions[0];
        imgEl.style.display = "block";
        emojiEl.style.display = "none";
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = 128;
          canvas.height = 128;
          canvas.getContext("2d").drawImage(img, 0, 0, 128, 128);
          try {
            modalIconDataUrl = canvas.toDataURL("image/png");
          } catch {}
        };
        img.src = suggestions[0];
      }
    });

  // URL → name auto-suggest
  document.getElementById("fieldUrl").addEventListener("input", (e) => {
    suggestNameFromUrl(e.target.value);
  });

  // Search
  document
    .getElementById("searchInput")
    .addEventListener("input", renderLibrary);

  // Filter
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".filter-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      renderLibrary();
    });
  });

  // Context menu
  document.getElementById("ctxLaunch").addEventListener("click", () => {
    if (contextTarget) launchApp(contextTarget);
    hideContextMenu();
  });
  document.getElementById("ctxEdit").addEventListener("click", () => {
    if (contextTarget) openModal(contextTarget);
    hideContextMenu();
  });
  document.getElementById("ctxDelete").addEventListener("click", () => {
    const target = contextTarget;
    hideContextMenu();
    if (target) deleteApp(target.id);
  });

  document.addEventListener("click", (e) => {
    if (!document.getElementById("contextMenu").contains(e.target))
      hideContextMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
      hideContextMenu();
    }
  });
}

init();
