function setActionState(tabId, running) {
  const details = typeof tabId === "number" ? { tabId } : {};

  chrome.action.setBadgeText({
    ...details,
    text: running ? "ON" : ""
  });
  chrome.action.setBadgeBackgroundColor({
    ...details,
    color: running ? "#16a34a" : "#667085"
  });
  chrome.action.setTitle({
    ...details,
    title: running
      ? "Auto Coordinate Clicker - Running on this tab"
      : "Auto Coordinate Clicker - Stopped"
  });
}

chrome.runtime.onInstalled.addListener(() => {
  setActionState(undefined, false);
});

chrome.runtime.onStartup.addListener(() => {
  setActionState(undefined, false);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== "tabStatusChanged") return false;

  if (sender.tab && typeof sender.tab.id === "number") {
    setActionState(sender.tab.id, Boolean(message.running));
  }

  sendResponse({ ok: true });
  return false;
});

setActionState(undefined, false);
