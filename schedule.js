const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

let selectedDays = [];
let selectedDuration = 25;
let scheduleType = "recurring";

document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get("session", (data) => {
    if (data.session && data.session.active) {
      document.body.innerHTML = `
        <div style="
          font-family: sans-serif;
          background: #0d1117;
          color: #e6edf3;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 24px;
          gap: 16px;
        ">
          <div style="font-size:52px">🔒</div>
          <div style="font-size:20px;font-weight:600">Session in progress</div>
          <div style="font-size:14px;color:#7d8590;max-width:300px;line-height:1.6">
            You cannot edit schedules during an active study session. Stay focused.
          </div>
        </div>
      `;
      return;
    }

    // set min date to today for one-time picker
    const today = new Date().toISOString().split("T")[0];
    document.getElementById("onetime-date").min = today;
    document.getElementById("onetime-date").value = today;

    document.getElementById("type-recurring").addEventListener("click", () => switchType("recurring"));
    document.getElementById("type-onetime").addEventListener("click", () => switchType("onetime"));

    setupDayButtons();
    setupDurationButtons();
    setupAddButton();
    renderSchedules();
    showNextSession();
  });
});

function switchType(type) {
  scheduleType = type;
  document.getElementById("recurring-options").style.display = type === "recurring" ? "block" : "none";
  document.getElementById("onetime-options").style.display = type === "onetime" ? "block" : "none";
  document.getElementById("type-recurring").classList.toggle("selected", type === "recurring");
  document.getElementById("type-onetime").classList.toggle("selected", type === "onetime");
}



function setupDayButtons() {
  document.querySelectorAll("[data-day]").forEach(btn => {
    btn.addEventListener("click", () => {
      const day = parseInt(btn.dataset.day);
      if (selectedDays.includes(day)) {
        selectedDays = selectedDays.filter(d => d !== day);
        btn.classList.remove("selected");
      } else {
        selectedDays.push(day);
        btn.classList.add("selected");
      }
    });
  });
}

function setupDurationButtons() {
  document.querySelectorAll(".dur-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".dur-btn").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      selectedDuration = parseInt(btn.dataset.mins);
      document.getElementById("custom-schedule-duration").value = "";
    });
  });

  document.getElementById("custom-schedule-duration").addEventListener("input", (e) => {
    document.querySelectorAll(".dur-btn").forEach(b => b.classList.remove("selected"));
    selectedDuration = parseInt(e.target.value) || 25;
  });
}

function setupAddButton() {
  document.getElementById("add-schedule-btn").addEventListener("click", () => {
    const startTime = document.getElementById("start-time").value;
    if (!startTime) {
      alert("Please set a start time.");
      return;
    }

    const [hours, minutes] = startTime.split(":").map(Number);

    let schedule = {
      id: Date.now().toString(),
      hours,
      minutes,
      duration: selectedDuration,
      enabled: true
    };

    if (scheduleType === "recurring") {
      if (selectedDays.length === 0) {
        alert("Please select at least one day.");
        return;
      }
      schedule.type = "recurring";
      schedule.days = [...selectedDays].sort();
    } else {
      const dateVal = document.getElementById("onetime-date").value;
      if (!dateVal) {
        alert("Please select a date.");
        return;
      }
      const selectedDate = new Date(dateVal);
      if (selectedDate < new Date(new Date().toDateString())) {
        alert("Please select today or a future date.");
        return;
      }
      schedule.type = "onetime";
      schedule.date = dateVal;
    }

    chrome.storage.local.get("schedules", (data) => {
      const schedules = data.schedules || [];
      schedules.push(schedule);
      chrome.storage.local.set({ schedules }, () => {
        chrome.runtime.sendMessage({ type: "REGISTER_SCHEDULES" });
        renderSchedules();
        showNextSession();
        selectedDays = [];
        document.querySelectorAll("[data-day]").forEach(b => b.classList.remove("selected"));
      });
    });
  });
}

function deleteSchedule(id) {
  chrome.storage.local.get("schedules", (data) => {
    const schedules = (data.schedules || []).filter(s => s.id !== id);
    chrome.storage.local.set({ schedules }, () => {
      chrome.runtime.sendMessage({ type: "REGISTER_SCHEDULES" });
      renderSchedules();
      showNextSession();
    });
  });
}

function toggleSchedule(id, enabled) {
  chrome.storage.local.get("schedules", (data) => {
    const schedules = data.schedules || [];
    const idx = schedules.findIndex(s => s.id === id);
    if (idx !== -1) {
      schedules[idx].enabled = enabled;
      chrome.storage.local.set({ schedules }, () => {
        chrome.runtime.sendMessage({ type: "REGISTER_SCHEDULES" });
        showNextSession();
      });
    }
  });
}

function formatDays(days) {
  if (days.length === 7) return "Every day";
  if (JSON.stringify(days) === JSON.stringify([1, 2, 3, 4, 5])) return "Weekdays";
  if (JSON.stringify(days) === JSON.stringify([0, 6])) return "Weekends";
  return days.map(d => DAY_SHORT[d]).join(", ");
}

function formatTime(hours, minutes) {
  const h = hours % 12 || 12;
  const m = String(minutes).padStart(2, "0");
  const ampm = hours < 12 ? "AM" : "PM";
  return `${h}:${m} ${ampm}`;
}

function formatDate(dateStr) {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function renderSchedules() {
  chrome.storage.local.get("schedules", (data) => {
    const schedules = data.schedules || [];
    const container = document.getElementById("schedules-container");

    if (schedules.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="icon">🗓️</div>
          <p>No schedules yet. Add one above to auto-start sessions.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = "";
    schedules.forEach(s => {
      const item = document.createElement("div");
      item.className = "schedule-item";

      const typeLabel = s.type === "onetime"
        ? `<div style="font-size:10px;color:#9e6a03;background:#2d1f0d;padding:2px 6px;border-radius:4px;display:inline-block;margin-bottom:4px;">One-time</div>`
        : `<div style="font-size:10px;color:#388bfd;background:#0d2044;padding:2px 6px;border-radius:4px;display:inline-block;margin-bottom:4px;">Weekly</div>`;

      const dateOrDays = s.type === "onetime"
        ? `<div class="schedule-days">${formatDate(s.date)}</div>`
        : `<div class="schedule-days">${formatDays(s.days)}</div>`;

      item.innerHTML = `
        <div class="schedule-info">
          ${typeLabel}
          <div class="schedule-time">${formatTime(s.hours, s.minutes)}</div>
          ${dateOrDays}
          <div class="schedule-duration">${s.duration} minutes</div>
        </div>
        <div class="schedule-right">
          <label class="toggle">
            <input type="checkbox" ${s.enabled ? "checked" : ""} data-id="${s.id}">
            <span class="slider"></span>
          </label>
          <button class="delete-btn" data-id="${s.id}">Delete</button>
        </div>
      `;

      item.querySelector(".toggle input").addEventListener("change", (e) => {
        toggleSchedule(s.id, e.target.checked);
      });

      item.querySelector(".delete-btn").addEventListener("click", () => {
        deleteSchedule(s.id);
      });

      container.appendChild(item);
    });
  });
}

function showNextSession() {
  chrome.storage.local.get("schedules", (data) => {
    const schedules = (data.schedules || []).filter(s => s.enabled);
    const el = document.getElementById("next-session");

    if (schedules.length === 0) {
      el.classList.remove("show");
      return;
    }

    const now = new Date();
    let nextTime = null;
    let nextSchedule = null;

    for (const s of schedules) {
      if (s.type === "onetime") {
        const candidate = new Date(`${s.date}T${String(s.hours).padStart(2,"0")}:${String(s.minutes).padStart(2,"0")}:00`);
        if (candidate > now) {
          if (!nextTime || candidate < nextTime) {
            nextTime = candidate;
            nextSchedule = s;
          }
        }
      } else {
        for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
          const candidate = new Date(now);
          candidate.setDate(now.getDate() + dayOffset);
          candidate.setHours(s.hours, s.minutes, 0, 0);
          if (candidate > now && s.days.includes(candidate.getDay())) {
            if (!nextTime || candidate < nextTime) {
              nextTime = candidate;
              nextSchedule = s;
            }
            break;
          }
        }
      }
    }

    if (nextTime && nextSchedule) {
      const timeStr = formatTime(nextSchedule.hours, nextSchedule.minutes);
      const dateStr = nextTime.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
      el.textContent = `📅 Next session: ${dateStr} at ${timeStr} (${nextSchedule.duration} mins)`;
      el.classList.add("show");
    } else {
      el.classList.remove("show");
    }
  });
}