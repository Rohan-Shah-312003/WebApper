/**
 * extensions.js
 *
 * Chrome extension support for Webapper.
 *
 * Flow:
 *   1. User pastes a Chrome Web Store URL
 *   2. We fetch the .crx from Google's update API
 *   3. Unpack the .crx into a directory (CRX3 format)
 *   4. Load it via session.loadExtension()
 *   5. Persist the unpacked path so it reloads on next launch
 *
 * Limitations:
 *   - Only Manifest V2 and V3 extensions that don't use Chrome-specific APIs
 *     (like chrome.tabs.create with openerTabId) will work fully.
 *   - Extensions requiring Native Messaging or Chrome Sign-In won't work.
 *   - Content scripts and background scripts work fine (covers uBlock, SponsorBlock).
 */

const { session } = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");
const { app } = require("electron");

// Where we store unpacked extensions
const EXT_DIR = path.join(app.getPath("userData"), "extensions");
const EXT_DATA_PATH = path.join(app.getPath("userData"), "extensions.json");

// ── Persistence ────────────────────────────────────────────────────────────────
function loadExtensionData() {
  try {
    if (fs.existsSync(EXT_DATA_PATH))
      return JSON.parse(fs.readFileSync(EXT_DATA_PATH, "utf8"));
  } catch {}
  return [];
}

function saveExtensionData(exts) {
  fs.writeFileSync(EXT_DATA_PATH, JSON.stringify(exts, null, 2));
}

// ── CRX download ───────────────────────────────────────────────────────────────
// Google's update endpoint for fetching .crx files
function getCrxUrl(extensionId) {
  return (
    `https://clients2.google.com/service/update2/crx` +
    `?response=redirect` +
    `&acceptformat=crx2,crx3` +
    `&prodversion=120.0.0.0` +
    `&x=id%3D${extensionId}%26installsource%3Dondemand%26uc`
  );
}

function httpsGet(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error("Too many redirects"));
    https
      .get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          return resolve(httpsGet(res.headers.location, redirectCount + 1));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

// ── CRX3 unpacker ─────────────────────────────────────────────────────────────
// CRX3 format:
//   [0-3]   magic: "Cr24"
//   [4-7]   version: 3 (uint32 LE)
//   [8-11]  header size (uint32 LE)
//   [12..]  protobuf header (we skip it)
//   [12+headerSize..] ZIP data

function unpackCrx(crxBuffer, destDir) {
  const magic = crxBuffer.slice(0, 4).toString("ascii");
  if (magic !== "Cr24") throw new Error("Not a valid CRX file (bad magic)");

  const version = crxBuffer.readUInt32LE(4);
  let zipOffset;

  if (version === 3) {
    const headerSize = crxBuffer.readUInt32LE(8);
    zipOffset = 12 + headerSize;
  } else if (version === 2) {
    const pubKeyLen = crxBuffer.readUInt32LE(8);
    const sigLen = crxBuffer.readUInt32LE(12);
    zipOffset = 16 + pubKeyLen + sigLen;
  } else {
    throw new Error(`Unsupported CRX version: ${version}`);
  }

  const zipBuffer = crxBuffer.slice(zipOffset);

  // Write zip to temp file then extract with Node's built-in or jszip
  const tmpZip = path.join(EXT_DIR, "_tmp.zip");
  fs.writeFileSync(tmpZip, zipBuffer);

  // Extract using the system unzip or our own implementation
  extractZip(tmpZip, destDir);
  try {
    fs.unlinkSync(tmpZip);
  } catch {}
}

// ZIP extractor using Central Directory — handles data descriptors correctly.
function extractZip(zipPath, destDir) {
  const zlib = require("zlib");
  const buf = fs.readFileSync(zipPath);
  fs.mkdirSync(destDir, { recursive: true });

  // Find End of Central Directory (scan from end)
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("No EOCD record — not a valid ZIP");

  const cdCount = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  let cdPos = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(cdPos) !== 0x02014b50)
      throw new Error("Bad central directory entry at offset " + cdPos);

    const compression = buf.readUInt16LE(cdPos + 10);
    const compSize = buf.readUInt32LE(cdPos + 20);
    const fileNameLen = buf.readUInt16LE(cdPos + 28);
    const extraLen = buf.readUInt16LE(cdPos + 30);
    const commentLen = buf.readUInt16LE(cdPos + 32);
    const localOffset = buf.readUInt32LE(cdPos + 42);
    const fileName = buf
      .slice(cdPos + 46, cdPos + 46 + fileNameLen)
      .toString("utf8");
    cdPos += 46 + fileNameLen + extraLen + commentLen;

    // Sanitise — normalise backslashes, strip leading slashes & traversal
    const parts = fileName
      .split(/[\\/]/)
      .filter((p) => p && p !== ".." && p !== ".");
    if (parts.length === 0) continue;
    const safeName = parts.join("/") + (fileName.endsWith("/") ? "/" : "");
    const fullPath = path.join(destDir, safeName);

    if (safeName.endsWith("/")) {
      fs.mkdirSync(fullPath, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    // Local file header: skip to actual data (extra field length can differ from CD)
    const localFnLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localFnLen + localExtraLen;
    const compData = buf.slice(dataOffset, dataOffset + compSize);

    if (compression === 0) {
      fs.writeFileSync(fullPath, compData);
    } else if (compression === 8) {
      fs.writeFileSync(fullPath, zlib.inflateRawSync(compData));
    } else {
      console.warn(
        "Skipping " + fileName + ": unsupported compression " + compression,
      );
    }
  }
}
// ── Extension ID from Web Store URL ───────────────────────────────────────────
function extractExtensionId(input) {
  // Handles:
  //   https://chrome.google.com/webstore/detail/name/EXTENSION_ID
  //   https://chromewebstore.google.com/detail/name/EXTENSION_ID
  //   just the raw ID (32 lowercase letters)
  const idMatch = input.match(/\/([a-z]{32})(?:[/?]|$)/);
  if (idMatch) return idMatch[1];
  if (/^[a-z]{32}$/.test(input.trim())) return input.trim();
  return null;
}

// ── Patch extension for Electron compatibility ────────────────────────────────
// Wrap chrome.contextMenus and other unsupported APIs in existence checks
// so the background script doesn't throw on startup.
function patchExtensionForElectron(extDir) {
  const bgPath = path.join(extDir, "background.js");
  if (!fs.existsSync(bgPath)) return;
  try {
    let bg = fs.readFileSync(bgPath, "utf8");
    // Only patch if not already patched
    if (bg.includes("__webapper_patched__")) return;
    const patch = `
// __webapper_patched__
// Stub out Chrome APIs that don't exist in Electron to prevent startup errors
if (typeof chrome !== "undefined") {
  if (!chrome.contextMenus) chrome.contextMenus = { create:()=>{}, onClicked:{ addListener:()=>{} }, removeAll:()=>{} };
  if (!chrome.browserAction) chrome.browserAction = { setIcon:()=>{}, setBadgeText:()=>{}, setBadgeBackgroundColor:()=>{}, onClicked:{ addListener:()=>{} } };
  if (!chrome.action) chrome.action = { setIcon:()=>{}, setBadgeText:()=>{}, setBadgeBackgroundColor:()=>{}, onClicked:{ addListener:()=>{} } };
  if (!chrome.webNavigation) chrome.webNavigation = { onCommitted:{ addListener:()=>{} }, onCompleted:{ addListener:()=>{} } };
  if (!chrome.notifications) chrome.notifications = { create:()=>{}, clear:()=>{}, onClicked:{ addListener:()=>{} } };
}
`;
    fs.writeFileSync(bgPath, patch + bg);
  } catch (e) {
    console.warn("Could not patch background.js:", e.message);
  }
}

// ── Install extension ──────────────────────────────────────────────────────────
async function installExtension(storeUrlOrId) {
  const id = extractExtensionId(storeUrlOrId);
  if (!id)
    throw new Error(
      "Could not extract extension ID from the URL. Make sure it's a valid Chrome Web Store link.",
    );

  // Check if already installed
  const existing = loadExtensionData();
  if (existing.find((e) => e.id === id)) {
    throw new Error("Extension is already installed.");
  }

  fs.mkdirSync(EXT_DIR, { recursive: true });

  // Download CRX
  const crxUrl = getCrxUrl(id);
  let crxBuffer;
  try {
    crxBuffer = await httpsGet(crxUrl);
  } catch (err) {
    throw new Error(`Failed to download extension: ${err.message}`);
  }

  if (crxBuffer.length < 16) {
    throw new Error(
      "Downloaded file is too small — extension may not exist or is not publicly available.",
    );
  }

  // Unpack CRX
  const extDestDir = path.join(EXT_DIR, id);
  try {
    if (fs.existsSync(extDestDir)) fs.rmSync(extDestDir, { recursive: true });
    unpackCrx(crxBuffer, extDestDir);
  } catch (err) {
    throw new Error(`Failed to unpack extension: ${err.message}`);
  }

  // Patch extension background.js for Electron compatibility
  patchExtensionForElectron(extDestDir);

  // Read manifest for name/description
  let manifest = {};
  try {
    const mPath = path.join(extDestDir, "manifest.json");
    manifest = JSON.parse(fs.readFileSync(mPath, "utf8"));
  } catch {}

  const extName = manifest.name?.replace(/__MSG_\w+__/, "").trim() || id;
  const extDesc = manifest.description?.replace(/__MSG_\w+__/, "").trim() || "";
  const extVersion = manifest.version || "?";
  const manifestVersion = manifest.manifest_version || 2;
  const iconPath = getManifestIconPath(manifest, extDestDir);

  // MV3 service workers don't run in Electron — warn but still install
  // (content scripts still work, which covers ad blockers & SponsorBlock)
  const mv3Warning =
    manifestVersion >= 3
      ? "Manifest V3 — toolbar popup and background scripts are limited, but content scripts (ad blocking, page modification) work fine."
      : null;

  // Load into all existing sessions
  await loadExtensionIntoSessions(extDestDir);

  // Persist
  const record = {
    id,
    name: extName,
    description: extDesc,
    version: extVersion,
    manifestVersion,
    mv3Warning,
    iconPath,
    dir: extDestDir,
    installedAt: new Date().toISOString(),
  };
  const updated = [...existing, record];
  saveExtensionData(updated);

  return record;
}

// ── Get best icon from manifest ────────────────────────────────────────────────
function getManifestIconPath(manifest, extDir) {
  const icons = manifest.icons || {};
  const sizes = Object.keys(icons)
    .map(Number)
    .sort((a, b) => b - a);
  if (sizes.length === 0) return null;
  const best = icons[sizes[0]];
  const full = path.join(extDir, best);
  return fs.existsSync(full) ? full : null;
}

// ── Load extension into a session ─────────────────────────────────────────────
async function loadExtensionIntoSession(ses, extDir) {
  try {
    await ses.loadExtension(extDir, { allowFileAccess: true });
  } catch (err) {
    console.warn(`Failed to load extension from ${extDir}:`, err.message);
  }
}

// Load into default session + all known partitions
const loadedPartitions = new Set();

async function loadExtensionIntoSessions(extDir) {
  // Only load into partitions that have active web app sessions
  for (const partition of loadedPartitions) {
    try {
      const ses = session.fromPartition(partition);
      let alreadyLoaded = new Set();
      try {
        alreadyLoaded = new Set(ses.getAllExtensions().map((e) => e.id));
      } catch {}
      const extId = path.basename(extDir);
      if (!alreadyLoaded.has(extId)) {
        await loadExtensionIntoSession(ses, extDir);
      }
    } catch {}
  }
}

// Called from main.js when a new partition is created (web app launch)
async function loadAllExtensionsIntoPartition(partition) {
  loadedPartitions.add(partition);
  const exts = loadExtensionData();
  const ses = session.fromPartition(partition);
  // Check which extensions are already loaded in this session
  let alreadyLoaded = new Set();
  try {
    const loaded = ses.getAllExtensions();
    alreadyLoaded = new Set(loaded.map((e) => e.id));
  } catch {}
  for (const ext of exts) {
    if (fs.existsSync(ext.dir) && !alreadyLoaded.has(ext.id)) {
      await loadExtensionIntoSession(ses, ext.dir);
    }
  }
}

// ── Boot: validate extension dirs, patch existing extensions ────────────────
async function initExtensions() {
  const exts = loadExtensionData();
  const valid = exts.filter((ext) => fs.existsSync(ext.dir));
  if (valid.length !== exts.length) {
    saveExtensionData(valid);
  }
  // Patch any already-installed extensions that were installed before patching existed
  for (const ext of valid) {
    patchExtensionForElectron(ext.dir);
  }
  // Extensions are loaded per-partition when apps open (loadAllExtensionsIntoPartition).
  // We do NOT load into defaultSession to avoid double-loading and MV3 noise.
}

// ── Remove extension ───────────────────────────────────────────────────────────
async function removeExtension(id) {
  const exts = loadExtensionData();
  const ext = exts.find((e) => e.id === id);
  if (!ext) throw new Error("Extension not found.");

  // Remove from all sessions
  try {
    const loaded = session.defaultSession.getAllExtensions();
    const match = loaded.find((e) => e.id === id);
    if (match) await session.defaultSession.removeExtension(id);
  } catch {}

  for (const partition of loadedPartitions) {
    try {
      const ses = session.fromPartition(partition);
      await ses.removeExtension(id);
    } catch {}
  }

  // Delete files
  try {
    if (fs.existsSync(ext.dir)) fs.rmSync(ext.dir, { recursive: true });
  } catch {}

  saveExtensionData(exts.filter((e) => e.id !== id));
}

module.exports = {
  installExtension,
  removeExtension,
  loadAllExtensionsIntoPartition,
  initExtensions,
  loadExtensionData,
};
