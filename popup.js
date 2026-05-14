const xInput = document.getElementById("x");
const yInput = document.getElementById("y");
const intervalInput = document.getElementById("interval");

chrome.storage.local.get(
  {
    x: 500,
    y: 300,
    interval: 10000
  },
  data => {
    xInput.value = data.x;
    yInput.value = data.y;
    intervalInput.value = data.interval;
  }
);

document.getElementById("save").addEventListener("click", () => {
  chrome.storage.local.set({
    x: Number(xInput.value),
    y: Number(yInput.value),
    interval: Number(intervalInput.value)
  });

  alert("Saved");
});
