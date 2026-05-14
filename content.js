async function getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(
      {
        x: 500,
        y: 300,
        interval: 10000
      },
      resolve
    );
  });
}

async function autoClick() {
  const settings = await getSettings();

  const el = document.elementFromPoint(settings.x, settings.y);

  if (el) {
    el.dispatchEvent(new MouseEvent("click", {
      view: window,
      bubbles: true,
      cancelable: true,
      clientX: settings.x,
      clientY: settings.y
    }));

    console.log("clicked", settings.x, settings.y);
  }
}

(async () => {
  const settings = await getSettings();

  setInterval(autoClick, settings.interval);
})();
