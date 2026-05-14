let intervalId = null;
let pickMode = false;

function getSettings(callback) {
  chrome.storage.local.get({
    x: 500,
    y: 300,
    interval: 10000,
    running: false
  }, callback);
}

function doClick(x, y) {
  const el = document.elementFromPoint(x, y);

  if (!el) {
    console.log("No element at", x, y);
    return;
  }

  ["mousedown", "mouseup", "click"].forEach(type => {
    el.dispatchEvent(new MouseEvent(type, {
      view: window,
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y
    }));
  });

  console.log("Auto clicked:", x, y, el);
}

function startClicker() {
  stopClicker();

  getSettings(settings => {
    if (!settings.running) return;

    intervalId = setInterval(() => {
      getSettings(s => {
        if (s.running) {
          doClick(s.x, s.y);
        }
      });
    }, settings.interval);

    console.log("Auto clicker started");
  });
}

function stopClicker() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("Auto clicker stopped");
  }
}

chrome.storage.onChanged.addListener(() => {
  getSettings(settings => {
    if (settings.running) {
      startClicker();
    } else {
      stopClicker();
    }
  });
});

getSettings(settings => {
  if (settings.running) startClicker();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "pickCoordinate") {
    pickMode = true;
    document.body.style.cursor = "crosshair";
    console.log("Pick mode enabled. Click target coordinate.");
  }

  if (message.action === "testClick") {
    getSettings(settings => {
      doClick(settings.x, settings.y);
    });
  }
});

document.addEventListener("click", function handler(e) {
  if (!pickMode) return;

  e.preventDefault();
  e.stopPropagation();

  pickMode = false;
  document.body.style.cursor = "";

  chrome.storage.local.set({
    x: e.clientX,
    y: e.clientY
  });

  console.log("Coordinate picked:", e.clientX, e.clientY);
}, true);
