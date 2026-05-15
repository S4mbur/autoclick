const DEFAULT_SETTINGS = {
  x: 500,
  y: 300,
  interval: 10000
};

const xInput = document.getElementById("x");
const yInput = document.getElementById("y");
const intervalInput = document.getElementById("interval");
const statusCard = document.getElementById("statusCard");
const statusPill = document.getElementById("statusPill");
const statusTitle = document.getElementById("statusTitle");
const statusDetail = document.getElementById("statusDetail");
const feedback = document.getElementById("feedback");
const startButton = document.getElementById("start");
const stopButton = document.getElementById("stop");
const saveButton = document.getElementById("save");
const pickButton = document.getElementById("pick");
const testButton = document.getElementById("test");

let feedbackTimer = null;
let currentSettings = { ...DEFAULT_SETTINGS };
let currentTabStatus = { available: false, running: false };

function formatInterval(ms) {
  if (ms >= 1000) {
    const seconds = ms / 1000;
    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} sec`;
  }

  return `${ms} ms`;
}

function showFeedback(message, type = "") {
  window.clearTimeout(feedbackTimer);
  feedback.textContent = message;
  feedback.className = `feedback ${type}`.trim();

  if (message) {
    feedbackTimer = window.setTimeout(() => {
      feedback.textContent = "";
      feedback.className = "feedback";
    }, 2400);
  }
}

function chromeStorageGet(defaults) {
  return new Promise(resolve => {
    chrome.storage.local.get(defaults, resolve);
  });
}

function chromeStorageSet(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }

      resolve();
    });
  });
}

function getActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (!tabs[0]) {
        reject(new Error("No active tab found."));
        return;
      }

      resolve(tabs[0]);
    });
  });
}

async function sendToActiveTab(message) {
  const tab = await getActiveTab();

  try {
    return await sendMessageToTab(tab.id, message);
  } catch (error) {
    await injectContentScript(tab.id);
    return sendMessageToTab(tab.id, message);
  }
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, response => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }

      resolve(response || {});
    });
  });
}

function injectContentScript(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }

      resolve();
    });
  });
}

function readFormValues() {
  return {
    x: Number(xInput.value),
    y: Number(yInput.value),
    interval: Number(intervalInput.value)
  };
}

function validateSettings() {
  const values = readFormValues();

  if (!Number.isFinite(values.x) || values.x < 0) {
    return { ok: false, message: "X coordinate must be 0 or greater." };
  }

  if (!Number.isFinite(values.y) || values.y < 0) {
    return { ok: false, message: "Y coordinate must be 0 or greater." };
  }

  if (!Number.isFinite(values.interval) || values.interval < 50) {
    return { ok: false, message: "Interval must be at least 50 milliseconds." };
  }

  return {
    ok: true,
    values: {
      x: Math.round(values.x),
      y: Math.round(values.y),
      interval: Math.round(values.interval)
    }
  };
}

function applyPillStyle(state) {
  const styles = {
    running: {
      color: "#166534",
      borderColor: "rgba(22, 163, 74, 0.45)",
      background: "#dcfce7"
    },
    stopped: {
      color: "#991b1b",
      borderColor: "rgba(220, 38, 38, 0.34)",
      background: "#fee2e2"
    },
    unavailable: {
      color: "#92400e",
      borderColor: "rgba(217, 119, 6, 0.38)",
      background: "#fef3c7"
    }
  };

  Object.assign(statusPill.style, styles[state]);
}

function renderState() {
  const available = Boolean(currentTabStatus.available);
  const running = Boolean(currentTabStatus.running);
  const statusClass = running ? "running" : "stopped";

  statusCard.classList.toggle("running", running);
  statusCard.classList.toggle("stopped", !running && available);
  statusCard.classList.toggle("unavailable", !available);
  startButton.disabled = !available || running;
  stopButton.disabled = !available || !running;
  pickButton.disabled = !available;
  testButton.disabled = !available;

  if (!available) {
    statusPill.textContent = "Unavailable";
    statusTitle.textContent = "Page unavailable";
    statusDetail.textContent = "Open a normal web page, then try again.";
    applyPillStyle("unavailable");
    return;
  }

  statusPill.textContent = running ? "Active" : "Idle";
  statusTitle.textContent = running ? "Running on this tab" : "Stopped";
  statusDetail.textContent = running
    ? `X:${currentSettings.x} Y:${currentSettings.y} - every ${formatInterval(currentSettings.interval)}`
    : "Start to click only the current active tab.";
  applyPillStyle(statusClass);
}

async function loadSettings() {
  currentSettings = await chromeStorageGet(DEFAULT_SETTINGS);
  xInput.value = currentSettings.x;
  yInput.value = currentSettings.y;
  intervalInput.value = currentSettings.interval;
  renderState();
}

async function refreshTabStatus() {
  try {
    const response = await sendToActiveTab({ action: "getStatus" });
    currentTabStatus = {
      available: true,
      running: Boolean(response.running)
    };
  } catch (_error) {
    currentTabStatus = {
      available: false,
      running: false
    };
  }

  renderState();
}

async function saveSettings(successMessage = "Settings saved.") {
  const result = validateSettings();

  if (!result.ok) {
    showFeedback(result.message, "error");
    return null;
  }

  try {
    await chromeStorageSet(result.values);
    currentSettings = result.values;
    showFeedback(successMessage, "success");
    renderState();

    if (currentTabStatus.available && currentTabStatus.running) {
      try {
        await sendToActiveTab({
          action: "updateSettings",
          settings: currentSettings
        });
      } catch (_error) {
        await refreshTabStatus();
      }
    }

    return currentSettings;
  } catch (_error) {
    showFeedback("Settings could not be saved.", "error");
    return null;
  }
}

saveButton.addEventListener("click", () => {
  saveSettings();
});

pickButton.addEventListener("click", async () => {
  const settings = await saveSettings("Settings saved.");

  if (!settings) return;

  try {
    await sendToActiveTab({
      action: "pickCoordinate",
      settings
    });
    window.close();
  } catch (_error) {
    showFeedback("This page is not available. Reload it and try again.", "error");
    await refreshTabStatus();
  }
});

testButton.addEventListener("click", async () => {
  const settings = await saveSettings("Settings saved.");

  if (!settings) return;

  try {
    await sendToActiveTab({
      action: "testClick",
      settings
    });
    showFeedback("Test click sent to this tab.", "success");
  } catch (_error) {
    showFeedback("Test click could not be sent to this tab.", "error");
    await refreshTabStatus();
  }
});

startButton.addEventListener("click", async () => {
  const settings = await saveSettings("Settings saved.");

  if (!settings) return;

  try {
    await sendToActiveTab({
      action: "startClicker",
      settings
    });
    currentTabStatus = { available: true, running: true };
    renderState();
    showFeedback("Started on this tab only.", "success");
  } catch (_error) {
    showFeedback("Could not start on this tab. Reload it and try again.", "error");
    await refreshTabStatus();
  }
});

stopButton.addEventListener("click", async () => {
  try {
    await sendToActiveTab({ action: "stopClicker" });
    currentTabStatus = { available: true, running: false };
    renderState();
    showFeedback("Stopped on this tab.", "success");
  } catch (_error) {
    showFeedback("Could not stop this tab. It may already be inactive.", "error");
    await refreshTabStatus();
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  const watchedKeys = ["x", "y", "interval"];

  if (watchedKeys.some(key => changes[key])) {
    loadSettings();
  }
});

loadSettings().then(refreshTabStatus);
