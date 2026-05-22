const DEFAULT_SETTINGS = {
  x: 500,
  y: 300,
  interval: 10000
};

const OVERLAY_ID = "auto-coordinate-clicker-status";
const OVERLAY_POSITION_DEFAULTS = {
  overlayLeft: null,
  overlayTop: null
};

let intervalId = null;
let pickMode = false;
let running = false;
let overlayHost = null;
let overlayMode = "running";
let overlayTimer = null;
let latestSettings = { ...DEFAULT_SETTINGS };
let overlayPositionLoaded = false;
let overlayDrag = null;

// ===== INSTANCE PROTECTION =====
if (window.__AUTOCLICKER_INSTANCE__) {
  try {
    window.__AUTOCLICKER_INSTANCE__.destroy();
  } catch (e) {
    console.log("Old instance cleanup failed:", e);
  }
}

let registeredListeners = [];
let registeredObservers = [];
let registeredRuntimeListeners = [];

function addSafeListener(target, type, handler, options) {
  target.addEventListener(type, handler, options);

  registeredListeners.push({
    target,
    type,
    handler,
    options
  });
}

function addSafeObserver(observer) {
  registeredObservers.push(observer);
}

function addSafeRuntimeMessageListener(handler) {
  chrome.runtime.onMessage.addListener(handler);
  registeredRuntimeListeners.push(handler);
}

function cleanup() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }

  registeredListeners.forEach(l => {
    try {
      l.target.removeEventListener(l.type, l.handler, l.options);
    } catch (e) {}
  });

  registeredListeners = [];

  registeredObservers.forEach(o => {
    try {
      o.disconnect();
    } catch (e) {}
  });

  registeredObservers = [];

  registeredRuntimeListeners.forEach(handler => {
    try {
      chrome.runtime.onMessage.removeListener(handler);
    } catch (e) {}
  });

  registeredRuntimeListeners = [];

  window.clearTimeout(overlayTimer);
  overlayTimer = null;
  pickMode = false;
  running = false;
  setPickCursor(false);

  try {
    if (overlayHost && overlayHost.parentNode) {
      overlayHost.parentNode.removeChild(overlayHost);
    }
  } catch (e) {}

  overlayHost = null;
  overlayDrag = null;
  overlayPositionLoaded = false;
}

function destroy() {
  cleanup();

  if (
    window.__AUTOCLICKER_INSTANCE__ &&
    window.__AUTOCLICKER_INSTANCE__.destroy === destroy
  ) {
    delete window.__AUTOCLICKER_INSTANCE__;
  }
}

window.__AUTOCLICKER_INSTANCE__ = {
  destroy
};

addSafeListener(window, "beforeunload", destroy);

function normalizeSettings(settings = {}) {
  return {
    x: Number.isFinite(Number(settings.x))
      ? Math.round(Number(settings.x))
      : DEFAULT_SETTINGS.x,
    y: Number.isFinite(Number(settings.y))
      ? Math.round(Number(settings.y))
      : DEFAULT_SETTINGS.y,
    interval: Math.max(
      50,
      Number.isFinite(Number(settings.interval))
        ? Math.round(Number(settings.interval))
        : DEFAULT_SETTINGS.interval
    )
  };
}

function getStoredSettings(callback) {
  chrome.storage.local.get(DEFAULT_SETTINGS, settings => {
    callback(normalizeSettings(settings));
  });
}

function notifyStatus() {
  chrome.runtime.sendMessage(
    {
      action: "tabStatusChanged",
      running
    },
    () => {
      chrome.runtime.lastError;
    }
  );
}

function formatInterval(ms) {
  if (ms >= 1000) {
    const seconds = ms / 1000;
    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} sec`;
  }

  return `${ms} ms`;
}

function clampOverlayPosition(left, top) {
  const rect = overlayHost?.getBoundingClientRect();
  const width = rect?.width || 272;
  const height = rect?.height || 130;
  const padding = 8;

  return {
    left: Math.min(
      Math.max(padding, Math.round(left)),
      Math.max(padding, window.innerWidth - width - padding)
    ),
    top: Math.min(
      Math.max(padding, Math.round(top)),
      Math.max(padding, window.innerHeight - height - padding)
    )
  };
}

function applyOverlayPosition(left, top, persist = false) {
  if (!overlayHost) return;

  const pos = clampOverlayPosition(left, top);
  overlayHost.style.left = `${pos.left}px`;
  overlayHost.style.top = `${pos.top}px`;
  overlayHost.style.right = "auto";

  if (persist) {
    chrome.storage.local.set({
      overlayLeft: pos.left,
      overlayTop: pos.top
    });
  }
}

function applyDefaultOverlayPosition() {
  if (!overlayHost) return;

  const rect = overlayHost.getBoundingClientRect();
  const width = rect.width || 272;
  applyOverlayPosition(window.innerWidth - width - 16, 16);
}

function loadOverlayPosition() {
  if (overlayPositionLoaded || !overlayHost) return;

  overlayPositionLoaded = true;
  chrome.storage.local.get(OVERLAY_POSITION_DEFAULTS, saved => {
    if (!overlayHost) return;

    if (
      Number.isFinite(Number(saved.overlayLeft)) &&
      Number.isFinite(Number(saved.overlayTop))
    ) {
      applyOverlayPosition(Number(saved.overlayLeft), Number(saved.overlayTop));
    } else {
      applyDefaultOverlayPosition();
    }
  });
}

function startOverlayDrag(event) {
  if (!overlayHost || event.button !== 0) return;

  event.preventDefault();
  event.stopPropagation();

  const rect = overlayHost.getBoundingClientRect();
  overlayDrag = {
    pointerId: event.pointerId,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top
  };

  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function moveOverlayDrag(event) {
  if (!overlayDrag || event.pointerId !== overlayDrag.pointerId) return;

  event.preventDefault();
  applyOverlayPosition(
    event.clientX - overlayDrag.offsetX,
    event.clientY - overlayDrag.offsetY
  );
}

function endOverlayDrag(event) {
  if (!overlayDrag || event.pointerId !== overlayDrag.pointerId) return;

  event.preventDefault();
  applyOverlayPosition(
    event.clientX - overlayDrag.offsetX,
    event.clientY - overlayDrag.offsetY,
    true
  );
  overlayDrag = null;
}

function ensureOverlay() {
  if (overlayHost && document.documentElement.contains(overlayHost)) {
    return overlayHost;
  }

  overlayHost = document.createElement("div");
  overlayHost.id = OVERLAY_ID;
  overlayHost.style.position = "fixed";
  overlayHost.style.top = "16px";
  overlayHost.style.right = "16px";
  overlayHost.style.zIndex = "2147483647";
  overlayHost.style.userSelect = "none";

  const root = overlayHost.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host {
        all: initial;
      }

      .panel {
        width: 252px;
        border: 1px solid rgba(24, 32, 51, 0.12);
        border-radius: 8px;
        padding: 10px;
        color: #182033;
        font-family: Arial, sans-serif;
        background: #ffffff;
        box-shadow: 0 14px 34px rgba(15, 23, 42, 0.22);
      }

      .panel.running {
        border-color: rgba(22, 163, 74, 0.5);
        background: #ecfdf3;
      }

      .panel.picking {
        border-color: rgba(37, 99, 235, 0.5);
        background: #eff6ff;
      }

      .panel.saved,
      .panel.tested {
        border-color: rgba(217, 119, 6, 0.5);
        background: #fffbeb;
      }

      .drag-handle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin: -2px -2px 8px;
        padding: 4px 5px;
        border-radius: 6px;
        color: #667085;
        font-size: 11px;
        font-weight: 700;
        cursor: move;
        touch-action: none;
      }

      .drag-handle:hover {
        background: rgba(15, 23, 42, 0.06);
      }

      .drag-dots {
        letter-spacing: 1px;
      }

      .top {
        display: grid;
        grid-template-columns: 12px 1fr;
        gap: 8px;
        align-items: start;
      }

      .dot {
        width: 11px;
        height: 11px;
        margin-top: 3px;
        border-radius: 50%;
        background: #16a34a;
        box-shadow: 0 0 0 4px rgba(22, 163, 74, 0.14);
        animation: pulse 1.15s ease-in-out infinite;
      }

      .picking .dot {
        background: #2563eb;
        box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.14);
      }

      .saved .dot,
      .tested .dot {
        background: #d97706;
        box-shadow: 0 0 0 4px rgba(217, 119, 6, 0.14);
        animation: none;
      }

      @keyframes pulse {
        0%, 100% {
          transform: scale(1);
        }
        50% {
          transform: scale(1.22);
        }
      }

      strong {
        display: block;
        font-size: 13px;
        line-height: 1.25;
      }

      span {
        display: block;
        margin-top: 2px;
        color: #475467;
        font-size: 12px;
        line-height: 1.35;
      }

      button {
        width: 100%;
        min-height: 32px;
        margin-top: 10px;
        border: 0;
        border-radius: 8px;
        padding: 7px 9px;
        color: #ffffff;
        font-family: Arial, sans-serif;
        font-size: 12px;
        font-weight: 700;
        background: #dc2626;
        cursor: pointer;
      }

      .picking button {
        background: #2563eb;
      }

      .saved button,
      .tested button {
        display: none;
      }
    </style>
    <div class="panel running">
      <div class="drag-handle" data-drag-handle title="Drag to move this panel">
        <span>Move panel</span>
        <span class="drag-dots">⋮⋮</span>
      </div>
      <div class="top">
        <div class="dot"></div>
        <div>
          <strong data-title>Auto Clicker is running</strong>
          <span data-detail></span>
        </div>
      </div>
      <button type="button" data-action>Stop</button>
    </div>
  `;

  const actionButton = root.querySelector("[data-action]");

  addSafeListener(actionButton, "click", event => {
    event.preventDefault();
    event.stopPropagation();

    if (overlayMode === "picking") {
      pickMode = false;
      setPickCursor(false);

      if (running) {
        updateOverlay("running", latestSettings);
      } else {
        hideOverlay();
      }

      return;
    }

    stopClicker();
  });

  const dragHandle = root.querySelector("[data-drag-handle]");
  addSafeListener(dragHandle, "pointerdown", startOverlayDrag);
  addSafeListener(dragHandle, "pointermove", moveOverlayDrag);
  addSafeListener(dragHandle, "pointerup", endOverlayDrag);
  addSafeListener(dragHandle, "pointercancel", endOverlayDrag);

  document.documentElement.appendChild(overlayHost);
  requestAnimationFrame(loadOverlayPosition);
  return overlayHost;
}

function hideOverlay() {
  window.clearTimeout(overlayTimer);
  overlayTimer = null;

  if (overlayHost) {
    overlayHost.remove();
    overlayHost = null;
    overlayPositionLoaded = false;
    overlayDrag = null;
  }
}

function updateOverlay(mode, settings = latestSettings) {
  overlayMode = mode;
  latestSettings = normalizeSettings(settings);

  const host = ensureOverlay();
  const root = host.shadowRoot;
  const panel = root.querySelector(".panel");
  const title = root.querySelector("[data-title]");
  const detail = root.querySelector("[data-detail]");
  const action = root.querySelector("[data-action]");

  panel.className = `panel ${mode}`;

  if (mode === "picking") {
    title.textContent = "Pick coordinate";
    detail.textContent = "Click the exact target point on this tab.";
    action.textContent = "Cancel";
    return;
  }

  if (mode === "saved") {
    title.textContent = "Coordinate saved";
    detail.textContent = `X:${latestSettings.x} Y:${latestSettings.y}`;
    return;
  }

  if (mode === "tested") {
    title.textContent = "Test click sent";
    detail.textContent = `X:${latestSettings.x} Y:${latestSettings.y}`;
    return;
  }

  title.textContent = "Auto Clicker is running";
  detail.textContent = `X:${latestSettings.x} Y:${latestSettings.y} - every ${formatInterval(
    latestSettings.interval
  )}`;
  action.textContent = "Stop";
}

function showTemporaryOverlay(mode, settings, duration = 1400) {
  updateOverlay(mode, settings);
  window.clearTimeout(overlayTimer);

  overlayTimer = window.setTimeout(() => {
    if (running) {
      updateOverlay("running", latestSettings);
    } else {
      hideOverlay();
    }
  }, duration);
}

function setPickCursor(enabled) {
  const cursor = enabled ? "crosshair" : "";

  if (document.body) {
    document.body.style.cursor = cursor;
  }

  document.documentElement.style.cursor = cursor;
}

function getElementAtClickPoint(x, y) {
  const previousDisplay = overlayHost ? overlayHost.style.display : "";

  if (overlayHost) {
    overlayHost.style.display = "none";
  }

  const el = document.elementFromPoint(x, y);

  if (overlayHost) {
    overlayHost.style.display = previousDisplay;
  }

  return el;
}

function showClickPulse(x, y) {
  const pulse = document.createElement("div");
  pulse.style.position = "fixed";
  pulse.style.left = `${x}px`;
  pulse.style.top = `${y}px`;
  pulse.style.width = "18px";
  pulse.style.height = "18px";
  pulse.style.marginLeft = "-9px";
  pulse.style.marginTop = "-9px";
  pulse.style.border = "3px solid #16a34a";
  pulse.style.borderRadius = "50%";
  pulse.style.background = "rgba(22, 163, 74, 0.15)";
  pulse.style.pointerEvents = "none";
  pulse.style.zIndex = "2147483646";
  pulse.style.transition = "transform 520ms ease, opacity 520ms ease";

  document.documentElement.appendChild(pulse);

  requestAnimationFrame(() => {
    pulse.style.transform = "scale(2.15)";
    pulse.style.opacity = "0";
  });

  window.setTimeout(() => pulse.remove(), 580);
}

function doClick(x, y) {
  const el = getElementAtClickPoint(x, y);

  if (!el) {
    console.log("No element at", x, y);
    return;
  }

  showClickPulse(x, y);

  ["mousedown", "mouseup", "click"].forEach(type => {
    el.dispatchEvent(
      new MouseEvent(type, {
        view: window,
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y
      })
    );
  });

  console.log("Auto clicked:", x, y, el);
}

function stopTimer() {
  if (!intervalId) return;

  window.clearInterval(intervalId);
  intervalId = null;
}

function startClicker(settings) {
  latestSettings = normalizeSettings(settings);
  running = true;
  stopTimer();
  updateOverlay("running", latestSettings);
  notifyStatus();

  intervalId = window.setInterval(() => {
    if (!running) return;

    updateOverlay("running", latestSettings);
    doClick(latestSettings.x, latestSettings.y);
  }, latestSettings.interval);

  console.log("Auto clicker started on this tab");
}

function stopClicker() {
  const wasRunning = running;

  running = false;
  stopTimer();

  if (!pickMode) {
    hideOverlay();
  }

  notifyStatus();

  if (wasRunning) {
    console.log("Auto clicker stopped on this tab");
  }
}

function updateSettings(settings) {
  latestSettings = normalizeSettings(settings);

  if (running) {
    startClicker(latestSettings);
  }
}

function handleMessage(message, _sender, sendResponse) {
  if (message.action === "getStatus") {
    sendResponse({
      ok: true,
      running,
      settings: latestSettings
    });
    return false;
  }

  if (message.action === "startClicker") {
    startClicker(message.settings);
    sendResponse({ ok: true, running });
    return false;
  }

  if (message.action === "stopClicker") {
    stopClicker();
    sendResponse({ ok: true, running });
    return false;
  }

  if (message.action === "updateSettings") {
    updateSettings(message.settings);
    sendResponse({ ok: true, running });
    return false;
  }

  if (message.action === "pickCoordinate") {
    latestSettings = normalizeSettings(message.settings || latestSettings);
    pickMode = true;
    setPickCursor(true);
    updateOverlay("picking", latestSettings);
    console.log("Pick mode enabled. Click target coordinate.");
    sendResponse({ ok: true });
    return false;
  }

  if (message.action === "testClick") {
    latestSettings = normalizeSettings(message.settings || latestSettings);
    doClick(latestSettings.x, latestSettings.y);
    showTemporaryOverlay("tested", latestSettings);
    sendResponse({ ok: true });
    return false;
  }

  return false;
}

addSafeRuntimeMessageListener(handleMessage);

function handleDocumentClick(e) {
  if (!pickMode) return;

  const path = typeof e.composedPath === "function" ? e.composedPath() : [];

  if (overlayHost && path.includes(overlayHost)) {
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  pickMode = false;
  setPickCursor(false);

  latestSettings = normalizeSettings({
    ...latestSettings,
    x: e.clientX,
    y: e.clientY
  });

  chrome.storage.local.set({
    x: latestSettings.x,
    y: latestSettings.y
  });

  showTemporaryOverlay("saved", latestSettings);
  console.log("Coordinate picked:", latestSettings.x, latestSettings.y);
}

addSafeListener(document, "click", handleDocumentClick, true);

function handleWindowResize() {
  if (!overlayHost) return;

  const rect = overlayHost.getBoundingClientRect();
  applyOverlayPosition(rect.left, rect.top, true);
}

addSafeListener(window, "resize", handleWindowResize);

getStoredSettings(settings => {
  latestSettings = settings;
  notifyStatus();
});
