const rawID = new URLSearchParams(location.search).get("appId") || "";
let ID = rawID;

if (!window.toolbarAPI) {
    document.getElementById("title").textContent = "PRELOAD MISSING";
    throw new Error("No preload");
}

try {
    window.toolbarAPI.log("Parsed ID:", ID, "location:", location.search);
} catch (e) {
    console.error("Failed to log", e);
}

const backBtn = document.getElementById("back");
const fwdBtn = document.getElementById("fwd");
const reloadBtn = document.getElementById("reload");
const reloadIcon = document.getElementById("ri");
const titleEl = document.getElementById("title");
const bar = document.getElementById("bar");

// Adapt left padding based on platform:
// macOS hiddenInset needs 80px to clear traffic-light buttons.
// Windows/Linux have a native title bar above; no offset needed.
window.toolbarAPI.getPlatform().then(platform => {
    if (platform === "darwin") {
        bar.style.paddingLeft = "80px";
    } else {
        bar.style.paddingLeft = "10px";
    }
}).catch(e => window.toolbarAPI.log("GetPlatform Error:", e.message));

function applyState(s) {
    window.toolbarAPI.log("applyState called with", JSON.stringify(s || null));
    if (!s) return;
    if (!ID && s.id) ID = s.id;
    if (s.id !== ID) return;
    if (s.canBack !== undefined) backBtn.disabled = !s.canBack;
    if (s.canForward !== undefined) fwdBtn.disabled = !s.canForward;
    if (s.loading === true) reloadIcon.classList.add("spin");
    else if (s.loading === false)
        reloadIcon.classList.remove("spin");
    if (s.title) titleEl.textContent = s.title;
}

backBtn.addEventListener("click", () => window.toolbarAPI.back(ID));
fwdBtn.addEventListener("click", () => window.toolbarAPI.forward(ID));
reloadBtn.addEventListener("click", () => window.toolbarAPI.reload(ID));

window.toolbarAPI.onState(applyState);

window.toolbarAPI.getInfo(ID).then(info => {
    window.toolbarAPI.log("getInfo returned", JSON.stringify(info || null));
    if (info) titleEl.textContent = info.name;
}).catch(e => window.toolbarAPI.log("getInfo Error:", e.message));

window.toolbarAPI.getState(ID).then(applyState).catch(e => window.toolbarAPI.log("getState Error:", e.message));
