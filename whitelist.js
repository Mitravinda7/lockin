let pendingSite = null;

document.addEventListener("DOMContentLoaded", () => {
  // block editing during active session
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
            You cannot edit the whitelist during an active study session. Stay focused.
          </div>
        </div>
      `;
    }
  });
  renderWhitelist();
  setupAddButton();
});

function setupAddButton() {
  const input = document.getElementById("site-input");
  const addBtn = document.getElementById("add-btn");
  const confirmBtn = document.getElementById("confirm-btn");
  const cancelBtn = document.getElementById("cancel-btn");

  addBtn.addEventListener("click", () => {
    const raw = input.value.trim().toLowerCase();
    if (!raw) return;

    // clean up the input
    const domain = raw
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0];

    if (!domain.includes(".")) {
      alert("Please enter a valid domain like coursera.org");
      return;
    }

    checkAndAdd(domain);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addBtn.click();
  });

  confirmBtn.addEventListener("click", () => {
    if (pendingSite) {
      addToWhitelist(pendingSite);
      pendingSite = null;
    }
    hideWarning();
  });

  cancelBtn.addEventListener("click", () => {
    pendingSite = null;
    hideWarning();
  });
}

async function checkAndAdd(domain) {
  const addBtn = document.getElementById("add-btn");
  const checking = document.getElementById("checking");

  addBtn.disabled = true;
  checking.classList.add("show");
  hideWarning();

  try {
    const response = await fetch("https://lockin-ai.houseeee888.workers.dev/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: domain,
        url: `https://${domain}`
      })
    });

    const result = await response.json();
    const isEducational = result.answer === "YES";

    if (isEducational) {
      addToWhitelist(domain);
    } else {
      pendingSite = domain;
      showWarning(domain);
    }

  } catch (err) {
    // if check fails just add it
    addToWhitelist(domain);
  }

  addBtn.disabled = false;
  checking.classList.remove("show");
}

function showWarning(domain) {
  const warningBox = document.getElementById("warning-box");
  const warningText = document.getElementById("warning-text");
  warningText.textContent = `"${domain}" looks like it might be entertainment or non-educational content. Are you sure you want to allow it during study sessions?`;
  warningBox.classList.add("show");
}

function hideWarning() {
  document.getElementById("warning-box").classList.remove("show");
}

function addToWhitelist(domain) {
  chrome.storage.local.get("whitelist", (data) => {
    const list = data.whitelist || [];
    if (list.find(item => item.domain === domain)) {
      alert(`${domain} is already in your whitelist.`);
      return;
    }
    list.push({ domain, addedAt: new Date().toLocaleDateString() });
    chrome.storage.local.set({ whitelist: list }, () => {
      document.getElementById("site-input").value = "";
      renderWhitelist();
    });
  });
}

function removeFromWhitelist(domain) {
  chrome.storage.local.get("whitelist", (data) => {
    const list = (data.whitelist || []).filter(item => item.domain !== domain);
    chrome.storage.local.set({ whitelist: list }, renderWhitelist);
  });
}

function renderWhitelist() {
  chrome.storage.local.get("whitelist", (data) => {
    const list = data.whitelist || [];
    const container = document.getElementById("whitelist-container");

    if (list.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="icon">✅</div>
          <p>No sites whitelisted yet. Add sites the AI wrongly blocks.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = "";
    list.forEach(item => {
      const row = document.createElement("div");
      row.className = "whitelist-item";
      row.innerHTML = `
        <div class="site-info">
          <div class="site-domain">${item.domain}</div>
          <div class="site-added">Added ${item.addedAt}</div>
        </div>
        <button class="remove-btn" data-domain="${item.domain}">Remove</button>
      `;
      row.querySelector(".remove-btn").addEventListener("click", () => {
        removeFromWhitelist(item.domain);
      });
      container.appendChild(row);
    });
  });
}