// ── keep service worker alive ────────────────────────────────
function connectToBackground() {
  const port = chrome.runtime.connect({ name: "keepAlive" });
  port.onDisconnect.addListener(() => {
    setTimeout(connectToBackground, 5000);
  });
}
connectToBackground();

console.log("LockIn content.js loaded on:", window.location.href);

// ── auto-report page content ─────────────────────────────────
let reportInterval = null;

function startReporting() {
  // wait 4 seconds for page title to fully load
  setTimeout(reportContent, 4000);
  reportInterval = setInterval(reportContent, 8000);
}

function reportContent() {
  const title = document.title || "";
  const url = window.location.href;

  if (url.startsWith("chrome://") || url.startsWith("chrome-extension://")) return;

  // don't report if title is just "YouTube" — wait for real title to load
  if (title === "YouTube") return;

  const bodyText = document.body ? document.body.innerText || "" : "";

  chrome.runtime.sendMessage({
    type: "PAGE_CONTENT",
    title,
    url,
    text: bodyText.slice(0, 800)
  }).catch(() => {});
}

if (document.readyState === "complete") {
  startReporting();
} else {
  window.addEventListener("load", startReporting);
}

let lastUrl = window.location.href;
setInterval(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    clearInterval(reportInterval);
    // tell background to clear cooldown for this tab
    chrome.runtime.sendMessage({ type: "CLEAR_COOLDOWN" }).catch(() => {});
    setTimeout(startReporting, 4000);
  }
}, 1000);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SHOW_ALERT") {
    showAlert(message.reason);
    sendResponse({ ok: true });
  }
  return true;
});

function showAlert(reason) {
  if (document.getElementById("lockin-alert")) return;

  const overlay = document.createElement("div");
  overlay.id = "lockin-alert";
  overlay.style.cssText = `
    position: fixed;
    top: 0; left: 0;
    width: 100vw; height: 100vh;
    background: rgba(220, 38, 38, 0.97);
    z-index: 2147483647;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-family: sans-serif;
    color: white;
    text-align: center;
    padding: 24px;
  `;

  overlay.innerHTML = `
    <div style="font-size: 64px; margin-bottom: 16px;">🔒</div>
    <div style="font-size: 28px; font-weight: 600; margin-bottom: 12px;">Focus. You're supposed to be studying.</div>
    <div style="font-size: 16px; opacity: 0.85; margin-bottom: 40px;">${reason}</div>
    <button id="lockin-close" style="
      padding: 12px 28px;
      background: white;
      color: #dc2626;
      border: none;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
    ">Close this tab</button>
    <div style="margin-top: 24px; font-size: 13px; opacity: 0.6;">Tab closes automatically in <span id="lockin-countdown">10</span> seconds</div>
  `;

  document.body.appendChild(overlay);
  playAlertSound();

  let seconds = 10;
  const countdown = setInterval(() => {
    seconds--;
    const el = document.getElementById("lockin-countdown");
    if (el) el.textContent = seconds;
    if (seconds <= 0) {
      clearInterval(countdown);
      chrome.runtime.sendMessage({ type: "CLOSE_TAB" }).catch(() => {});
    }
  }, 1000);

  document.getElementById("lockin-close").addEventListener("click", () => {
    clearInterval(countdown);
    chrome.runtime.sendMessage({ type: "CLOSE_TAB" }).catch(() => {});
  });
}

function playAlertSound() {
  try {
    const ctx = new AudioContext();
    [0, 0.3, 0.6].forEach(delay => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.4, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.25);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.25);
    });
  } catch (e) {}
}