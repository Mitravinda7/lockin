document.addEventListener("DOMContentLoaded", () => {
  loadStats();
});

function loadStats() {
  chrome.storage.local.get(null, (allData) => {
    const today = new Date();
    const days = [];

    // build last 7 days
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const dateStr = date.toDateString();
      const key = `stats_${dateStr}`;

      days.push({
        dateStr,
        label: i === 0 ? "Today" : getDayLabel(date),
        isToday: i === 0,
        mins: allData[key]?.mins || 0,
        blocked: allData[key]?.blocked || 0,
        sessions: allData[key]?.sessions || 0
      });
    }

    renderSummary(days);
    renderChart(days);
    renderLogs(days);
  });
}

function getDayLabel(date) {
  return date.toLocaleDateString("en-US", { weekday: "short" });
}

function renderSummary(days) {
  const totalMins = days.reduce((sum, d) => sum + d.mins, 0);
  const totalSessions = days.reduce((sum, d) => sum + d.sessions, 0);
  const totalBlocked = days.reduce((sum, d) => sum + d.blocked, 0);

  document.getElementById("total-week-mins").textContent = totalMins;
  document.getElementById("total-sessions").textContent = totalSessions;
  document.getElementById("total-blocked").textContent = totalBlocked;
}

function renderChart(days) {
  const chart = document.getElementById("chart");
  const labels = document.getElementById("chart-labels");
  const maxMins = Math.max(...days.map(d => d.mins), 1);

  chart.innerHTML = "";
  labels.innerHTML = "";

  days.forEach(day => {
    const heightPct = (day.mins / maxMins) * 100;

    const wrap = document.createElement("div");
    wrap.className = "bar-wrap";

    const value = document.createElement("div");
    value.className = "bar-value";
    value.textContent = day.mins > 0 ? `${day.mins}m` : "";

    const bar = document.createElement("div");
    bar.className = `bar${day.isToday ? " today" : ""}${day.mins === 0 ? " empty" : ""}`;
    bar.style.height = `${Math.max(heightPct, 2)}%`;

    const label = document.createElement("div");
    label.className = `bar-day${day.isToday ? " today" : ""}`;
    label.textContent = day.label;

    wrap.appendChild(value);
    wrap.appendChild(bar);
    wrap.appendChild(label);
    chart.appendChild(wrap);
  });
}

function renderLogs(days) {
  const container = document.getElementById("day-logs");
  const reversed = [...days].reverse();
  const hasData = days.some(d => d.mins > 0);

  if (!hasData) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📚</div>
        <p>No study sessions yet. Start your first session!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = "";

  reversed.forEach(day => {
    const row = document.createElement("div");
    row.className = "log-row";

    const dateEl = document.createElement("div");
    dateEl.className = `log-date${day.isToday ? " today" : ""}`;
    dateEl.textContent = day.isToday ? "Today" : day.dateStr.slice(0, 10);

    const statsEl = document.createElement("div");
    statsEl.className = "log-stats";

    if (day.mins > 0) {
      const minsEl = document.createElement("div");
      minsEl.className = "log-mins";
      minsEl.textContent = `${day.mins} mins`;
      statsEl.appendChild(minsEl);
    }

    if (day.blocked > 0) {
      const blockedEl = document.createElement("div");
      blockedEl.className = "log-blocked";
      blockedEl.textContent = `${day.blocked} blocked`;
      statsEl.appendChild(blockedEl);
    }

    if (day.mins === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.style.cssText = "font-size:12px;color:#484f58";
      emptyEl.textContent = "No study";
      statsEl.appendChild(emptyEl);
    }

    row.appendChild(dateEl);
    row.appendChild(statsEl);
    container.appendChild(row);
  });
}