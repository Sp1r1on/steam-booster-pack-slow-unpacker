const MIN_DELAY_SECONDS = 11;

const elements = {
  minDelayInput: document.getElementById("delay-min-seconds"),
  maxDelayInput: document.getElementById("delay-max-seconds"),
  startButton: document.getElementById("start-button"),
  pauseButton: document.getElementById("pause-button"),
  stopButton: document.getElementById("stop-button"),
  versionText: document.getElementById("version-text"),
  statusText: document.getElementById("status-text"),
  queueText: document.getElementById("queue-text"),
  rangeText: document.getElementById("range-text"),
  etaText: document.getElementById("eta-text"),
  currentText: document.getElementById("current-text"),
  nextText: document.getElementById("next-text"),
  lastText: document.getElementById("last-text"),
  errorText: document.getElementById("error-text")
};

elements.versionText.textContent = `Version ${chrome.runtime.getManifest().version}`;

function clampDelaySeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return MIN_DELAY_SECONDS;
  }

  return Math.max(MIN_DELAY_SECONDS, Math.round(parsed));
}

function normalizeDelayRange(minSeconds, maxSeconds) {
  const safeMin = clampDelaySeconds(minSeconds);
  const safeMax = clampDelaySeconds(maxSeconds);

  if (safeMin <= safeMax) {
    return {
      minSeconds: safeMin,
      maxSeconds: safeMax
    };
  }

  return {
    minSeconds: safeMax,
    maxSeconds: safeMin
  };
}

function formatNextRun(nextRunAt) {
  if (!nextRunAt) {
    return "-";
  }

  const seconds = Math.max(0, Math.ceil((nextRunAt - Date.now()) / 1000));
  return `${seconds} sec`;
}

function formatDuration(ms) {
  if (!ms || ms <= 0) {
    return "0 sec";
  }

  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
  }

  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }

  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds}s`);
  }

  return parts.join(" ");
}

function renderStatus(status) {
  if (!status) {
    elements.statusText.textContent = "No response from the tab.";
    elements.queueText.textContent = "-";
    elements.rangeText.textContent = "-";
    elements.etaText.textContent = "-";
    elements.currentText.textContent = "-";
    elements.nextText.textContent = "-";
    elements.lastText.textContent = "-";
    elements.errorText.textContent = "-";
    return;
  }

  if (status.minDelayMs || status.maxDelayMs) {
    const range = normalizeDelayRange(
      (status.minDelayMs || MIN_DELAY_SECONDS * 1000) / 1000,
      (status.maxDelayMs || MIN_DELAY_SECONDS * 1000) / 1000
    );
    elements.minDelayInput.value = String(range.minSeconds);
    elements.maxDelayInput.value = String(range.maxSeconds);
  }

  if (status.ok === false) {
    elements.statusText.textContent = status.inventoryPage ? "Error" : "Open Steam inventory";
    elements.queueText.textContent = "-";
    elements.rangeText.textContent = "-";
    elements.etaText.textContent = "-";
    elements.currentText.textContent = "-";
    elements.nextText.textContent = "-";
    elements.lastText.textContent = status.message || "-";
    elements.errorText.textContent = status.message || "-";
    return;
  }

  elements.statusText.textContent = status.statusText || "-";
  elements.queueText.textContent = `${status.processed || 0} / ${status.total || 0}`;
  elements.rangeText.textContent = `${Math.round((status.minDelayMs || 0) / 1000)}-${Math.round((status.maxDelayMs || 0) / 1000)} sec`;
  elements.etaText.textContent = typeof status.estimatedRemainingMs === "number" ? formatDuration(status.estimatedRemainingMs) : "-";
  elements.currentText.textContent = status.currentItemName || "-";
  elements.nextText.textContent = formatNextRun(status.nextRunAt);
  elements.lastText.textContent = status.lastResult || "-";
  elements.errorText.textContent = status.lastError || "-";
  elements.startButton.disabled = Boolean(status.running);
  elements.pauseButton.disabled = !status.running && !status.paused;
  elements.pauseButton.textContent = status.paused ? "Resume" : "Pause";
  elements.stopButton.disabled = !status.running && !status.stopping;
}

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

async function sendToActiveTab(message) {
  const tabId = await getActiveTabId();
  if (!tabId) {
    return null;
  }

  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    return null;
  }
}

async function refreshStatus() {
  const status = await sendToActiveTab({ type: "getStatus" });
  renderStatus(status);
}

elements.startButton.addEventListener("click", async () => {
  const range = normalizeDelayRange(elements.minDelayInput.value, elements.maxDelayInput.value);
  elements.minDelayInput.value = String(range.minSeconds);
  elements.maxDelayInput.value = String(range.maxSeconds);

  const status = await sendToActiveTab({
    type: "start",
    minDelayMs: range.minSeconds * 1000,
    maxDelayMs: range.maxSeconds * 1000
  });

  renderStatus(status);
});

elements.stopButton.addEventListener("click", async () => {
  const status = await sendToActiveTab({ type: "stop" });
  renderStatus(status);
});

elements.pauseButton.addEventListener("click", async () => {
  const status = await sendToActiveTab({ type: "pause" });
  renderStatus(status);
});

refreshStatus();
window.setInterval(refreshStatus, 1000);
