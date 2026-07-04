// ── state ────────────────────────────────────────────────
let selectedDuration = 25;
let selectedBreaks = 3;
let selectedBreakDuration = 3;
let timerInterval = null;
let breakInterval = null;
let musicPlaying = false;
let audioCtx = null;
let musicNodes = [];
let selectedMusicStyle = "lofi";
let blockedCount = 0;

// ── on popup open ────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  const port = chrome.runtime.connect({ name: "keepAlive" });
  loadSession();
  loadTodayStats();
  setupDurationButtons();
  setupBreakCountButtons();
  setupBreakDurationButtons();
  setupStartButton();
  setupBreakButton();
  setupMusicToggles();

  document.getElementById("new-session-btn").addEventListener("click", () => {
    blockedCount = 0;
    showSetupView();
  });

  document.getElementById("stats-btn").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("stats.html") });
  });

  document.getElementById("whitelist-btn").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("whitelist.html") });
  });

  document.getElementById("schedule-btn").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("schedule.html") });
  });

  chrome.storage.local.get(["musicPlaying", "musicStyle"], (data) => {
    if (data.musicPlaying) {
      musicPlaying = true;
      selectedMusicStyle = data.musicStyle || "lofi";
      const t1 = document.getElementById("music-toggle");
      const t2 = document.getElementById("music-toggle-session");
      const picker1 = document.getElementById("music-style-picker");
      const picker2 = document.getElementById("music-style-picker-session");
      if (t1) t1.checked = true;
      if (t2) t2.checked = true;
      if (picker1) picker1.style.display = "block";
      if (picker2) picker2.style.display = "block";
      document.querySelectorAll(".music-style-btn, .music-style-btn-session").forEach(btn => {
        btn.classList.toggle("selected", btn.dataset.style === selectedMusicStyle);
      });
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "BREAK_GRANTED") {
      showBreakView(message.breaksLeft);
    }
    if (message.type === "BREAK_DENIED") {
      alert("No breaks left. Stay focused.");
    }
    if (message.type === "BREAK_OVER") {
      showSessionView();
    }
    if (message.type === "SESSION_ENDED") {
      chrome.storage.local.get("session", (data) => {
        const dur = data.session?.duration || 0;
        showCompletionView(dur);
      });
    }
    if (message.type === "DISTRACTION_BLOCKED") {
      blockedCount++;
      const el = document.getElementById("blocked-count");
      if (el) el.textContent = blockedCount;
    }
    if (message.type === "SESSION_STARTED") {
      chrome.storage.local.get("session", (data) => {
        if (data.session && data.session.active) {
          showSessionView();
          startSessionTimer(data.session.startTime, data.session.duration);
          document.getElementById("breaks-count").textContent =
            data.session.maxBreaks - data.session.breaksUsed;
        }
      });
    }
  });
});

// ── load today stats ─────────────────────────────────────
function loadTodayStats() {
  chrome.storage.local.get(["todayMins", "todayDate"], (data) => {
    const today = new Date().toDateString();
    if (data.todayDate === today && data.todayMins > 0) {
      const el = document.getElementById("today-stats-bar");
      if (el) {
        el.style.display = "flex";
        document.getElementById("today-mins-display").textContent =
          `${data.todayMins} mins studied today`;
      }
    }
  });
}

// ── load session state ───────────────────────────────────
function loadSession() {
  chrome.storage.local.get("session", (data) => {
    const session = data.session;

    if (!session || !session.active) {
      showSetupView();
      return;
    }

    const endTime = session.startTime + session.duration * 60 * 1000;
    if (Date.now() >= endTime) {
      chrome.storage.local.set({ session: { active: false, onBreak: false } });
      showSetupView();
      return;
    }

    if (session.onBreak) {
      if (Date.now() >= session.breakEndTime) {
        session.onBreak = false;
        chrome.storage.local.set({ session });
        showSessionView();
        startSessionTimer(session.startTime, session.duration);
        document.getElementById("breaks-count").textContent =
          session.maxBreaks - session.breaksUsed;
        return;
      }
      showBreakView(session.maxBreaks - session.breaksUsed);
      startBreakCountdown(session.breakEndTime);
      return;
    }

    showSessionView();
    startSessionTimer(session.startTime, session.duration);
    document.getElementById("breaks-count").textContent =
      session.maxBreaks - session.breaksUsed;
  });
}

// ── duration buttons ─────────────────────────────────────
function setupDurationButtons() {
  const timeButtons = document.querySelectorAll(".dur-time-btn");

  timeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      timeButtons.forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      selectedDuration = parseInt(btn.dataset.minutes);
      document.getElementById("custom-duration").value = "";
    });
  });

  document.getElementById("custom-duration").addEventListener("input", (e) => {
    timeButtons.forEach((b) => b.classList.remove("selected"));
    selectedDuration = parseInt(e.target.value) || 25;
  });
}

// ── break count buttons ──────────────────────────────────
function setupBreakCountButtons() {
  const buttons = document.querySelectorAll(".break-count-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      selectedBreaks = parseInt(btn.dataset.count);
    });
  });
}

// ── break duration buttons ───────────────────────────────
function setupBreakDurationButtons() {
  const buttons = document.querySelectorAll(".break-dur-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      selectedBreakDuration = parseInt(btn.dataset.mins);
    });
  });
}

// ── start button ─────────────────────────────────────────
function setupStartButton() {
  document.getElementById("start-btn").addEventListener("click", () => {
    const duration = selectedDuration;
    if (!duration || duration < 1) {
      alert("Please select a duration.");
      return;
    }

    chrome.storage.local.get("session", (check) => {
      if (check.session && check.session.active) {
        alert("A session is already running. Wait for it to finish.");
        return;
      }

      const session = {
        active: true,
        startTime: Date.now(),
        duration: duration,
        breaksUsed: 0,
        maxBreaks: selectedBreaks,
        breakDuration: selectedBreakDuration,
        onBreak: false
      };

      chrome.storage.local.set({ session }, () => {
        chrome.runtime.sendMessage({
          type: "START_SESSION",
          duration,
          maxBreaks: selectedBreaks,
          breakDuration: selectedBreakDuration
        });
        showSessionView();
        startSessionTimer(session.startTime, duration);
      });
    });
  });
}

// ── break button ─────────────────────────────────────────
function setupBreakButton() {
  document.getElementById("break-btn").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "REQUEST_BREAK" });
  });
}

// ── music toggles ────────────────────────────────────────
function setupMusicToggles() {
  const t1 = document.getElementById("music-toggle");
  const t2 = document.getElementById("music-toggle-session");
  const picker1 = document.getElementById("music-style-picker");
  const picker2 = document.getElementById("music-style-picker-session");

  if (t1) {
    t1.addEventListener("change", () => {
      if (t2) t2.checked = t1.checked;
      if (picker1) picker1.style.display = t1.checked ? "block" : "none";
      if (picker2) picker2.style.display = t1.checked ? "block" : "none";
      t1.checked ? startMusic(selectedMusicStyle) : stopMusic();
    });
  }

  if (t2) {
    t2.addEventListener("change", () => {
      if (t1) t1.checked = t2.checked;
      if (picker2) picker2.style.display = t2.checked ? "block" : "none";
      if (picker1) picker1.style.display = t2.checked ? "block" : "none";
      t2.checked ? startMusic(selectedMusicStyle) : stopMusic();
    });
  }

  document.querySelectorAll(".music-style-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".music-style-btn").forEach(b => b.classList.remove("selected"));
      document.querySelectorAll(".music-style-btn-session").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      document.querySelectorAll(".music-style-btn-session").forEach(b => {
        if (b.dataset.style === btn.dataset.style) b.classList.add("selected");
      });
      selectedMusicStyle = btn.dataset.style;
      if (musicPlaying) { stopMusic(); startMusic(selectedMusicStyle); }
    });
  });

  document.querySelectorAll(".music-style-btn-session").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".music-style-btn-session").forEach(b => b.classList.remove("selected"));
      document.querySelectorAll(".music-style-btn").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      document.querySelectorAll(".music-style-btn").forEach(b => {
        if (b.dataset.style === btn.dataset.style) b.classList.add("selected");
      });
      selectedMusicStyle = btn.dataset.style;
      if (musicPlaying) { stopMusic(); startMusic(selectedMusicStyle); }
    });
  });
}

// ── show / hide views ────────────────────────────────────
function showSetupView() {
  clearInterval(timerInterval);
  clearInterval(breakInterval);
  document.getElementById("setup-view").style.display = "block";
  document.getElementById("session-view").style.display = "none";
  document.getElementById("break-view").style.display = "none";
  document.getElementById("completion-view").style.display = "none";
  document.getElementById("status-badge").textContent = "Inactive";
  document.getElementById("status-badge").className = "status";
  loadTodayStats();
}

function showSessionView() {
  clearInterval(breakInterval);
  document.getElementById("setup-view").style.display = "none";
  document.getElementById("session-view").style.display = "block";
  document.getElementById("break-view").style.display = "none";
  document.getElementById("completion-view").style.display = "none";
  document.getElementById("status-badge").textContent = "Active";
  document.getElementById("status-badge").className = "status active";
}

function showBreakView(breaksLeft) {
  clearInterval(timerInterval);
  document.getElementById("setup-view").style.display = "none";
  document.getElementById("session-view").style.display = "none";
  document.getElementById("break-view").style.display = "block";
  document.getElementById("completion-view").style.display = "none";
  document.getElementById("status-badge").textContent = "Break";
  document.getElementById("status-badge").className = "status break";

  chrome.storage.local.get("session", (data) => {
    if (data.session && data.session.breakEndTime) {
      startBreakCountdown(data.session.breakEndTime);
    }
  });
}

function showCompletionView(duration) {
  clearInterval(timerInterval);
  clearInterval(breakInterval);
  document.getElementById("setup-view").style.display = "none";
  document.getElementById("session-view").style.display = "none";
  document.getElementById("break-view").style.display = "none";
  document.getElementById("completion-view").style.display = "block";
  document.getElementById("status-badge").textContent = "Done";
  document.getElementById("status-badge").className = "status active";

  chrome.storage.local.get(["todayMins", "todayBlocked", "todayDate"], (data) => {
    const today = new Date().toDateString();
    let totalMins = duration;
    let totalBlocked = blockedCount;

    if (data.todayDate === today) {
      totalMins += data.todayMins || 0;
      totalBlocked += data.todayBlocked || 0;
    }

    chrome.storage.local.set({ todayMins: totalMins, todayBlocked: totalBlocked, todayDate: today });
    document.getElementById("completion-sub").textContent = `You studied ${duration} minutes`;
    document.getElementById("total-today").textContent = `${totalMins} mins`;
    document.getElementById("total-blocked").textContent = totalBlocked;
  });
}

// ── session timer ────────────────────────────────────────
function startSessionTimer(startTime, durationMinutes) {
  clearInterval(timerInterval);
  const endTime = startTime + durationMinutes * 60 * 1000;

  timerInterval = setInterval(() => {
    const remaining = endTime - Date.now();
    if (remaining <= 0) {
      clearInterval(timerInterval);
      document.getElementById("timer-display").textContent = "00:00";
      return;
    }
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    document.getElementById("timer-display").textContent =
      `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }, 1000);
}

// ── break countdown ──────────────────────────────────────
function startBreakCountdown(breakEndTime) {
  clearInterval(breakInterval);

  breakInterval = setInterval(() => {
    const remaining = breakEndTime - Date.now();
    if (remaining <= 0) {
      clearInterval(breakInterval);
      document.getElementById("break-timer").textContent = "0:00";
      return;
    }
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    document.getElementById("break-timer").textContent =
      `${mins}:${String(secs).padStart(2, "0")}`;
  }, 1000);
}

// ── focus music ──────────────────────────────────────────
function startMusic(style) {
  musicPlaying = true;
  chrome.runtime.sendMessage({ type: "MUSIC_TOGGLE", playing: true, style });
}

function stopMusic() {
  musicPlaying = false;
  chrome.runtime.sendMessage({ type: "MUSIC_TOGGLE", playing: false, style: selectedMusicStyle });
}