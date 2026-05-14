const xInput = document.getElementById("x");
const yInput = document.getElementById("y");
const intervalInput = document.getElementById("interval");

function loadSettings() {
  chrome.storage.local.get({
    x: 500,
    y: 300,
    interval: 10000,
    running: false
  }, data => {
    xInput.value = data.x;
    yInput.value = data.y;
    intervalInput.value = data.interval;
  });
}

function saveSettings(extra = {}) {
  chrome.storage.local.set({
    x: Number(xInput.value),
    y: Number(yInput.value),
    interval: Number(intervalInput.value),
    ...extra
  });
}

function sendToActiveTab(message) {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, message);
  });
}

document.getElementById("save").addEventListener("click", () => {
  saveSettings();
});

document.getElementById("pick").addEventListener("click", () => {
  sendToActiveTab({ action: "pickCoordinate" });
  window.close();
});

document.getElementById("test").addEventListener("click", () => {
  saveSettings();
  sendToActiveTab({ action: "testClick" });
});

document.getElementById("start").addEventListener("click", () => {
  saveSettings({ running: true });
});

document.getElementById("stop").addEventListener("click", () => {
  chrome.storage.local.set({ running: false });
});

chrome.storage.onChanged.addListener(loadSettings);

loadSettings();
