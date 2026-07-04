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

chrome.alarms.get("keepAlive", (alarm) => {
  if (!alarm) {
    chrome.alarms.create("keepAlive", { periodInMinutes: 0.4 });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepAlive") return;
  if (alarm.name === "scheduleCheck") checkSchedules();
  if (alarm.name === "sessionEnd") endSession();
  if (alarm.name === "breakEnd") {
    session.onBreak = false;
    saveSession();
    chrome.runtime.sendMessage({ type: "BREAK_OVER" }).catch(() => {});
    recheckAllTabs();
  }
});

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

chrome.storage.local.get("session", (data) => {
  if (data && data.session) session = data.session;
});

function saveSession() {
  chrome.storage.local.set({ session });
}

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
  if (!session.active || session.onBreak) return;
  if (!tab.url) return;

  const url = tab.url;
  if (url.startsWith("chrome://") || url.startsWith("chrome-extension://")) return;
  if (url.includes("claude.ai") || url.includes("blocked.html")) return;
  if (url.includes("youtube.com") && !url.includes("youtube.com/watch") && !url.includes("youtube.com/shorts")) return;

  if (changeInfo.status === "complete") {
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
  }
});

// ── check a tab with AI ──────────────────────────────────────
async function checkTab(tabId, title, url) {
  if (!session.active || session.onBreak) return;
  if (!title || !url) return;

  const tabKey = `${tabId}:${url}`;
  if (lastChecked[tabKey]) return;

  const whitelistData = await chrome.storage.local.get("whitelist");
  const whitelist = whitelistData.whitelist || [];
  const isWhitelisted = whitelist.some(item => url.includes(item.domain));
  if (isWhitelisted) {
    console.log("LockIn: whitelisted —", url);
    return;
  }

  lastChecked[tabKey] = true;
  console.log("LockIn: checking —", title);

  try {
    const response = await fetch("https://lockin-ai.houseeee888.workers.dev/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, url })
    });

    const result = await response.json();
    console.log("LockIn: decision for", title, "→", result.answer);

    if (result.error) {
      if (result.code === 429) {
        console.log("LockIn: rate limited, will retry");
        delete lastChecked[tabKey];
        setTimeout(() => checkTab(tabId, title, url), 60000);
      }
      return;
    }

    if (result.answer === "NO") {
      console.log("LockIn: injecting alert to tab", tabId);
      const reason = `"${title}" doesn't look like study content`;
      chrome.scripting.executeScript({
        target: { tabId: tabId },
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
          } catch(e) {}
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
        const today = new Date().toDateString();
        const key = `stats_${today}`;
        chrome.storage.local.get(key, (data) => {
          const existing = data[key] || { mins: 0, blocked: 0, sessions: 0 };
          existing.blocked += 1;
          chrome.storage.local.set({ [key]: existing });
        });
      }).catch(err => {
        console.error("LockIn: injection failed:", err);
      });
    }

  } catch (err) {
    console.error("LockIn: worker error:", err);
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
  chrome.alarms.get("scheduleCheck", (alarm) => {
    if (!alarm) {
      chrome.alarms.create("scheduleCheck", { periodInMinutes: 1 });
    }
  });
}

registerScheduleAlarm();

function checkSchedules() {
  if (session.active) return;

  chrome.storage.local.get("schedules", (data) => {
    const schedules = (data.schedules || []).filter(s => s.enabled);
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    for (const s of schedules) {
      let shouldFire = false;

      if (s.type === "onetime") {
        const todayStr = now.toISOString().split("T")[0];
        if (s.date === todayStr && s.hours === currentHour && s.minutes === currentMinute) {
          shouldFire = true;
        }
      } else {
        if (s.days.includes(now.getDay()) && s.hours === currentHour && s.minutes === currentMinute) {
          shouldFire = true;
        }
      }

      if (shouldFire) {
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
        console.log("LockIn: scheduled session started");
        chrome.runtime.sendMessage({ type: "SESSION_STARTED" }).catch(() => {});

        if (s.type === "onetime") {
          chrome.storage.local.get("schedules", (d) => {
            const updated = (d.schedules || []).filter(x => x.id !== s.id);
            chrome.storage.local.set({ schedules: updated });
          });
        }
        break;
      }
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
    if (message.playing) {
      startMusicBackground(message.style);
    } else {
      stopMusicBackground();
    }
    chrome.storage.local.set({ musicPlaying: message.playing, musicStyle: message.style });
    return;
  }

  if (message.type === "PAGE_CONTENT") {
    if (!session.active || session.onBreak) return;
    if (!sender.tab) return;
    const url = message.url || "";
    if (url.includes("claude.ai") || url.includes("blocked.html") || url.startsWith("chrome")) return;
    if (url.includes("youtube.com") && !url.includes("youtube.com/watch") && !url.includes("youtube.com/shorts")) return;
    checkTab(sender.tab.id, message.title, url);
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
    saveSession();
    chrome.alarms.clear("sessionEnd");
    chrome.alarms.create("sessionEnd", { delayInMinutes: message.duration });
    recheckAllTabs();
    return;
  }

  if (message.type === "REQUEST_BREAK") {
    if (session.breaksUsed >= session.maxBreaks) {
      chrome.runtime.sendMessage({ type: "BREAK_DENIED" }).catch(() => {});
      return;
    }
    const breakMins = session.breakDuration || 3;
    session.onBreak = true;
    session.breaksUsed++;
    session.breakEndTime = Date.now() + breakMins * 60 * 1000;
    saveSession();
    chrome.runtime.sendMessage({
      type: "BREAK_GRANTED",
      breaksLeft: session.maxBreaks - session.breaksUsed
    }).catch(() => {});
    chrome.alarms.clear("breakEnd");
    chrome.alarms.create("breakEnd", { delayInMinutes: breakMins });
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
  const today = new Date().toDateString();
  const key = `stats_${today}`;
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