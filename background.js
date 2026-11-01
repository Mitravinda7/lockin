// ── keep service worker alive ────────────────────────────────
const keepAlivePort = {};

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "keepAlive") {
    keepAlivePort[port.sender.tab?.id || "popup"] = port;
    port.onDisconnect.addListener(() => {
      delete keepAlivePort[port.sender.tab?.id || "popup"];
    });
  }
});

function ensureAlarm(name, periodInMinutes) {
  chrome.alarms.get(name, (alarm) => {
    if (!alarm) chrome.alarms.create(name, { periodInMinutes });
  });
}

ensureAlarm("keepAlive", 0.4);
ensureAlarm("wlTrack", 0.5);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepAlive") return;
  if (alarm.name === "wlTrack") { trackWhitelistUsage(); return; }
  if (alarm.name === "scheduleCheck") checkSchedules();
  if (alarm.name === "sessionEnd") endSession();
  if (alarm.name === "breakEnd") {
    loadSessionFromStorage(() => {
      session.onBreak = false;
      saveSession();
      chrome.runtime.sendMessage({ type: "BREAK_OVER" }).catch(() => {});
      recheckAllTabs();
      chrome.storage.local.get("firedSchedules", (d) => {
        const localDate = localDateStr();
        const fired = (d.firedSchedules || []).filter(key => key.includes(localDate));
        chrome.storage.local.set({ firedSchedules: fired });
      });
    });
  }
});

// ── helpers ──────────────────────────────────────────────────
function localDateStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

function todayKey() {
  return localDateStr();
}

// ── session state ────────────────────────────────────────────
let session = {
  active: false,
  startTime: null,
  duration: 0,
  breaksUsed: 0,
  maxBreaks: 3,
  breakDuration: 3,
  onBreak: false,
  breakEndTime: null
};

let lastChecked = {};
let lastAiCheck = {};
let errorUntil = {};
let aiCallTimes = [];
let sessionLoaded = false;

function loadSessionFromStorage(callback) {
  chrome.storage.local.get("session", (data) => {
    if (data && data.session) {
      session = data.session;
      if (session.active && session.startTime && session.duration) {
        const endTime = session.startTime + session.duration * 60 * 1000;
        if (Date.now() > endTime) {
          session.active = false;
          session.onBreak = false;
          saveSession();
          console.log("LockIn: cleared expired session on startup");
        }
      }
    }
    sessionLoaded = true;
    if (callback) callback();
  });
}

loadSessionFromStorage();

function saveSession() {
  chrome.storage.local.set({ session });
}

function checkIfSessionShouldBeActive() {
  chrome.storage.local.get(["schedules", "session", "firedSchedules"], (data) => {
    const currentSession = data.session || {};
    if (currentSession.active) return;

    const schedules = (data.schedules || []).filter(s => s.enabled);
    const firedSchedules = data.firedSchedules || [];
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const localDate = localDateStr();

    for (const s of schedules) {
      const scheduleMins = s.hours * 60 + s.minutes;
      const scheduleEndMins = scheduleMins + s.duration;

      if (nowMins < scheduleMins || nowMins > scheduleEndMins) continue;

      const fireKey = `${s.id}_${localDate}`;
      if (firedSchedules.includes(fireKey)) continue;
      if (s.type === "onetime" && s.date !== localDate) continue;
      if (s.type === "recurring" && !s.days.includes(now.getDay())) continue;

      const elapsedMins = nowMins - scheduleMins;
      const remainingMins = s.duration - elapsedMins;
      if (remainingMins <= 0) continue;

      session.active = true;
      session.startTime = Date.now() - (elapsedMins * 60 * 1000);
      session.duration = s.duration;
      session.breaksUsed = 0;
      session.maxBreaks = 3;
      session.breakDuration = 3;
      session.onBreak = false;
      lastChecked = {};
      saveSession();
      chrome.alarms.clear("sessionEnd");
      chrome.alarms.create("sessionEnd", { delayInMinutes: remainingMins });
      recheckAllTabs();
      console.log(`LockIn: resuming scheduled session — ${remainingMins} mins remaining`);
      chrome.runtime.sendMessage({ type: "SESSION_STARTED" }).catch(() => {});

      firedSchedules.push(fireKey);
      chrome.storage.local.set({ firedSchedules });

      if (s.type === "onetime") {
        chrome.storage.local.get("schedules", (d) => {
          const updated = (d.schedules || []).filter(x => x.id !== s.id);
          chrome.storage.local.set({ schedules: updated });
        });
      }
      break;
    }
  });
}

checkIfSessionShouldBeActive();

// ── offscreen document for audio ─────────────────────────────
async function ensureOffscreen() {
  const existing = await chrome.offscreen.hasDocument();
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL("offscreen.html"),
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Playing focus music during study session"
    });
  }
}

async function startMusicBackground(style) {
  await ensureOffscreen();
  chrome.runtime.sendMessage({ type: "MUSIC_START", style }).catch(() => {});
}

async function stopMusicBackground() {
  try {
    const existing = await chrome.offscreen.hasDocument();
    if (existing) {
      chrome.runtime.sendMessage({ type: "MUSIC_STOP" }).catch(() => {});
    }
  } catch (e) {}
}

// ── tab updated ──────────────────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.url) return;

  const url = tab.url;
  if (url.startsWith("chrome://") || url.startsWith("chrome-extension://")) return;
  if (url.includes("claude.ai") || url.includes("blocked.html")) return;
  if (url.includes("youtube.com") && !url.includes("youtube.com/watch") && !url.includes("youtube.com/shorts")) return;

  if (changeInfo.status === "complete") {
    chrome.storage.local.get("session", (data) => {
      const s = data.session || {};
      if (!s.active || s.onBreak) return;

      Object.keys(lastChecked).forEach(key => {
        if (key.startsWith(tabId + ":")) delete lastChecked[key];
      });
      setTimeout(() => {
        chrome.tabs.get(tabId, (freshTab) => {
          if (chrome.runtime.lastError) return;
          if (!freshTab || !freshTab.url) return;
          checkTab(tabId, freshTab.title || "", freshTab.url);
        });
      }, 4000);
    });
  }
});

function describeGoogleSearch(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("google.") || u.pathname !== "/search") return null;
    const q = u.searchParams.get("q");
    if (!q) return null;
    let kind = "web search";
    if (u.searchParams.get("udm") === "50") kind = "AI Mode chat";
    else if (u.searchParams.get("tbm") === "isch" || u.searchParams.get("udm") === "2") kind = "image search";
    if (kind === "AI Mode chat") return "Google AI Mode chat";
    return `Google ${kind} for: ${q}`;
  } catch (e) {
    return null;
  }
}

// ── red block overlay ────────────────────────────────────────
function showBlockOverlay(tabId, reason) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: (reason) => {
      if (document.getElementById("lockin-alert")) return;
      const overlay = document.createElement("div");
      overlay.id = "lockin-alert";
      overlay.style.cssText = `
        position: fixed; top: 0; left: 0;
        width: 100vw; height: 100vh;
        background: rgba(220, 38, 38, 0.97);
        z-index: 2147483647;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        font-family: sans-serif; color: white; text-align: center; padding: 24px;
      `;
      overlay.innerHTML = `
        <div style="font-size:64px;margin-bottom:16px">🔒</div>
        <div style="font-size:28px;font-weight:600;margin-bottom:12px">Focus. You're supposed to be studying.</div>
        <div style="font-size:16px;opacity:0.85;margin-bottom:40px">${reason}</div>
        <button id="lockin-close" style="padding:12px 28px;background:white;color:#dc2626;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer">Close this tab</button>
        <div style="margin-top:24px;font-size:13px;opacity:0.6">Tab closes automatically in <span id="lockin-countdown">10</span> seconds</div>
      `;
      document.body.appendChild(overlay);
      try {
        const ctx = new AudioContext();
        [0, 0.3, 0.6].forEach(delay => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.frequency.value = 880; osc.type = "sine";
          gain.gain.setValueAtTime(0.4, ctx.currentTime + delay);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.25);
          osc.start(ctx.currentTime + delay);
          osc.stop(ctx.currentTime + delay + 0.25);
        });
      } catch (e) {}
      let seconds = 10;
      const countdown = setInterval(() => {
        seconds--;
        const el = document.getElementById("lockin-countdown");
        if (el) el.textContent = seconds;
        if (seconds <= 0) {
          clearInterval(countdown);
          chrome.runtime.sendMessage({ type: "CLOSE_TAB" });
        }
      }, 1000);
      document.getElementById("lockin-close").addEventListener("click", () => {
        clearInterval(countdown);
        chrome.runtime.sendMessage({ type: "CLOSE_TAB" });
      });
    },
    args: [reason]
  }).then(() => {
    console.log("LockIn: alert injected successfully");
    chrome.runtime.sendMessage({ type: "DISTRACTION_BLOCKED" }).catch(() => {});
    const key = `stats_${new Date().toDateString()}`;
    chrome.storage.local.get(key, (data) => {
      const existing = data[key] || { mins: 0, blocked: 0, sessions: 0 };
      existing.blocked += 1;
      chrome.storage.local.set({ [key]: existing });
    });
  }).catch(err => {
    console.error("LockIn: injection failed:", err);
  });
}

// ── whitelist time tracking ──────────────────────────────────
async function trackWhitelistUsage() {
  try {
    const { session: s } = await chrome.storage.local.get("session");
    if (!s || !s.active || s.onBreak) return;

    const win = await chrome.windows.getLastFocused();
    if (!win || !win.focused) return;
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
    if (!tab || !tab.url) return;

    const data = await chrome.storage.local.get(["whitelist", "wlUsage"]);
    const item = (data.whitelist || []).find(i => tab.url.includes(i.domain));
    if (!item || !item.limitMins) return;

    let usage = data.wlUsage || {};
    if (usage.day !== todayKey()) usage = { day: todayKey(), sites: {} };
    usage.sites[item.domain] = (usage.sites[item.domain] || 0) + 30;
    await chrome.storage.local.set({ wlUsage: usage });

    if (usage.sites[item.domain] >= item.limitMins * 60) {
      showBlockOverlay(tab.id, `Your ${item.limitMins}-minute daily limit for ${item.domain} is used up`);
    }
  } catch (e) {
    console.error("LockIn: whitelist tracking error:", e);
  }
}

// ── check a tab with AI ──────────────────────────────────────
async function checkTab(tabId, title, url, pageText = "") {
  const stored = await chrome.storage.local.get("session");
  const currentSession = stored.session || {};

  if (!currentSession.active || currentSession.onBreak) return;
  if (!title || !url) return;
  if (title === "Warmup Page" || url === "about:blank") return;
  if (url === "https://www.google.com/") return;

  const isAiMode = url.includes("google.com/search") && url.includes("udm=50");
  if (isAiMode && !pageText) return;

  const tabKey = `${tabId}:${url}`;

  // skip pages that recently failed
  if (errorUntil[tabKey] && Date.now() < errorUntil[tabKey]) return;

  // mark the page as "being checked" right away so parallel calls stop here
  if (isAiMode) {
    if (Date.now() - (lastAiCheck[tabId] || 0) < 20000) return;
    lastAiCheck[tabId] = Date.now();
  } else {
    if (lastChecked[tabKey]) return;
    lastChecked[tabKey] = true;
  }

  const searchDesc = describeGoogleSearch(url);
  if (searchDesc) title = searchDesc;

  // whitelist with optional daily limit
  const wlData = await chrome.storage.local.get(["whitelist", "wlUsage"]);
  const wlItem = (wlData.whitelist || []).find(i => url.includes(i.domain));
  if (wlItem) {
    const usage = wlData.wlUsage || {};
    const used = usage.day === todayKey() ? (usage.sites[wlItem.domain] || 0) : 0;
    if (!wlItem.limitMins || used < wlItem.limitMins * 60) {
      console.log("LockIn: whitelisted —", url);
      return;
    }
    showBlockOverlay(tabId, `Your ${wlItem.limitMins}-minute daily limit for ${wlItem.domain} is used up`);
    return;
  }

  // never send more than 12 AI requests per minute
  const now = Date.now();
  aiCallTimes = aiCallTimes.filter(t => now - t < 60000);
  if (aiCallTimes.length >= 12) {
    console.log("LockIn: too many AI requests, will retry shortly");
    delete lastChecked[tabKey];
    return;
  }
  aiCallTimes.push(now);

  console.log("LockIn: checking —", title);
  if (isAiMode) {
    console.log("LockIn: AI text length:", pageText.length, "|", pageText.slice(-80));
  }

  try {
    const response = await fetch("https://lockin-ai.houseeee888.workers.dev/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, url, text: isAiMode ? pageText : "" })
    });

    const result = await response.json();
    console.log("LockIn: decision for", title, "→", result.answer, result.error ? "| ERROR: " + result.error : "");

    if (result.error || !result.answer) {
      // let the page be checked again later, but wait first
      delete lastChecked[tabKey];
      errorUntil[tabKey] = Date.now() + (result.code === 429 ? 60000 : 30000);
      return;
    }

    if (result.answer === "NO") {
      showBlockOverlay(tabId, `"${title}" doesn't look like study content`);
    }
  } catch (err) {
    console.error("LockIn: worker error:", err);
    delete lastChecked[tabKey];
    errorUntil[tabKey] = Date.now() + 30000;
  }
}

// ── recheck all tabs ─────────────────────────────────────────
function recheckAllTabs() {
  lastChecked = {};
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url &&
        !tabs[0].url.startsWith("chrome://") &&
        !tabs[0].url.includes("claude.ai")) {
      checkTab(tabs[0].id, tabs[0].title || "", tabs[0].url);
    }
  });
}

// ── schedule checker ─────────────────────────────────────────
function registerScheduleAlarm() {
  ensureAlarm("scheduleCheck", 1);
}

registerScheduleAlarm();

function checkSchedules() {
  chrome.storage.local.get(["session", "schedules", "firedSchedules"], (data) => {
    const currentSession = data.session || {};
    if (currentSession.active) return;

    const schedules = (data.schedules || []).filter(s => s.enabled);
    const firedSchedules = data.firedSchedules || [];
    const now = new Date();
    const localDate = localDateStr();
    const nowMins = now.getHours() * 60 + now.getMinutes();

    for (const s of schedules) {
      const scheduleMins = s.hours * 60 + s.minutes;
      const diff = nowMins - scheduleMins;
      if (diff < 0 || diff > 2) continue;

      const fireKey = `${s.id}_${localDate}`;
      if (firedSchedules.includes(fireKey)) continue;
      if (s.type === "onetime" && s.date !== localDate) continue;
      if (s.type === "recurring" && !s.days.includes(now.getDay())) continue;

      session.active = true;
      session.startTime = Date.now();
      session.duration = s.duration;
      session.breaksUsed = 0;
      session.maxBreaks = 3;
      session.breakDuration = 3;
      session.onBreak = false;
      lastChecked = {};
      saveSession();
      chrome.alarms.clear("sessionEnd");
      chrome.alarms.create("sessionEnd", { delayInMinutes: s.duration });
      recheckAllTabs();
      console.log("LockIn: scheduled session started —", s.hours + ":" + s.minutes);
      chrome.runtime.sendMessage({ type: "SESSION_STARTED" }).catch(() => {});

      firedSchedules.push(fireKey);
      chrome.storage.local.set({ firedSchedules });

      if (s.type === "onetime") {
        chrome.storage.local.get("schedules", (d) => {
          const updated = (d.schedules || []).filter(x => x.id !== s.id);
          chrome.storage.local.set({ schedules: updated });
        });
      }

      if (firedSchedules.length > 50) {
        chrome.storage.local.set({ firedSchedules: firedSchedules.slice(-50) });
      }
      break;
    }
  });
}

// ── messages ─────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "CLOSE_TAB") {
    if (sender.tab) chrome.tabs.remove(sender.tab.id);
    return;
  }

  if (message.type === "REGISTER_SCHEDULES") {
    registerScheduleAlarm();
    return;
  }

  if (message.type === "MUSIC_TOGGLE") {
    if (message.playing) startMusicBackground(message.style);
    else stopMusicBackground();
    chrome.storage.local.set({ musicPlaying: message.playing, musicStyle: message.style });
    return;
  }

  if (message.type === "PAGE_CONTENT") {
    chrome.storage.local.get("session", (data) => {
      const s = data.session || {};
      if (!s.active || s.onBreak) return;
      if (!sender.tab) return;
      const url = message.url || "";
      if (url.includes("claude.ai") || url.includes("blocked.html") || url.startsWith("chrome")) return;
      if (url.includes("youtube.com") && !url.includes("youtube.com/watch") && !url.includes("youtube.com/shorts")) return;
      checkTab(sender.tab.id, message.title, url, message.text);
    });
    return;
  }

  if (message.type === "START_SESSION") {
    session.active = true;
    session.startTime = Date.now();
    session.duration = message.duration;
    session.breaksUsed = 0;
    session.maxBreaks = message.maxBreaks || 3;
    session.breakDuration = message.breakDuration || 3;
    session.onBreak = false;
    lastChecked = {};
    errorUntil = {};
    saveSession();
    chrome.alarms.clear("sessionEnd");
    chrome.alarms.create("sessionEnd", { delayInMinutes: message.duration });
    recheckAllTabs();
    return;
  }

  if (message.type === "REQUEST_BREAK") {
    chrome.storage.local.get("session", (data) => {
      const s = data.session || {};
      if (s.breaksUsed >= s.maxBreaks) {
        chrome.runtime.sendMessage({ type: "BREAK_DENIED" }).catch(() => {});
        return;
      }
      const breakMins = s.breakDuration || 3;
      session.onBreak = true;
      session.breaksUsed = s.breaksUsed + 1;
      session.breakEndTime = Date.now() + breakMins * 60 * 1000;
      saveSession();
      chrome.runtime.sendMessage({
        type: "BREAK_GRANTED",
        breaksLeft: s.maxBreaks - session.breaksUsed
      }).catch(() => {});
      chrome.alarms.clear("breakEnd");
      chrome.alarms.create("breakEnd", { delayInMinutes: breakMins });
    });
    return;
  }

  if (message.type === "END_SESSION") {
    endSession();
    return;
  }

  if (message.type === "CLEAR_COOLDOWN") {
    if (sender.tab) {
      Object.keys(lastChecked).forEach(key => {
        if (key.startsWith(sender.tab.id + ":")) delete lastChecked[key];
      });
      console.log("LockIn: cooldown cleared for tab", sender.tab.id);
    }
    return;
  }
});

// ── end session ──────────────────────────────────────────────
function endSession() {
  stopMusicBackground();
  chrome.storage.local.set({ musicPlaying: false });
  const key = `stats_${new Date().toDateString()}`;
  chrome.storage.local.get(key, (data) => {
    const existing = data[key] || { mins: 0, blocked: 0, sessions: 0 };
    existing.mins += session.duration || 0;
    existing.sessions += 1;
    chrome.storage.local.set({ [key]: existing });
  });
  session.active = false;
  session.onBreak = false;
  lastChecked = {};
  saveSession();
  chrome.runtime.sendMessage({ type: "SESSION_ENDED" }).catch(() => {});
}