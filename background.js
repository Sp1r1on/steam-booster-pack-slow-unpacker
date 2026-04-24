let queueState = createInitialState();
let nextStepTimeout = null;
let heartbeatInterval = null;

function createInitialState() {
  return {
    running: false,
    paused: false,
    stopping: false,
    queue: [],
    total: 0,
    processed: 0,
    minDelayMs: 15000,
    maxDelayMs: 22000,
    currentItemName: "",
    currentItemIndex: 0,
    nextRunAt: 0,
    statusText: "Idle",
    lastResult: "Nothing started yet.",
    lastError: "",
    tabId: null,
    remainingDelayMs: 0
  };
}

function normalizeDelayRange(minMs, maxMs) {
  const safeMin = Number.isFinite(Number(minMs)) ? Math.max(11000, Math.round(Number(minMs))) : 15000;
  const safeMax = Number.isFinite(Number(maxMs)) ? Math.max(11000, Math.round(Number(maxMs))) : 22000;

  if (safeMin <= safeMax) {
    return { minDelayMs: safeMin, maxDelayMs: safeMax };
  }

  return { minDelayMs: safeMax, maxDelayMs: safeMin };
}

function getRandomDelayMs() {
  if (queueState.minDelayMs === queueState.maxDelayMs) {
    return queueState.minDelayMs;
  }

  const span = queueState.maxDelayMs - queueState.minDelayMs;
  return queueState.minDelayMs + Math.floor(Math.random() * (span + 1));
}

function getAverageDelayMs() {
  return Math.round((queueState.minDelayMs + queueState.maxDelayMs) / 2);
}

function getEstimatedRemainingMs() {
  const remainingItems = Math.max(0, queueState.total - queueState.processed);
  if (remainingItems <= 0) {
    return 0;
  }

  const nextWaitMs = queueState.nextRunAt
    ? Math.max(0, queueState.nextRunAt - Date.now())
    : Math.max(0, queueState.remainingDelayMs || 0);
  const additionalWaits = Math.max(0, remainingItems - 1);
  return nextWaitMs + additionalWaits * getAverageDelayMs();
}

function getStatusPayload() {
  return {
    ok: true,
    running: queueState.running,
    paused: queueState.paused,
    stopping: queueState.stopping,
    minDelayMs: queueState.minDelayMs,
    maxDelayMs: queueState.maxDelayMs,
    total: queueState.total,
    processed: queueState.processed,
    remaining: Math.max(0, queueState.total - queueState.processed),
    estimatedRemainingMs: getEstimatedRemainingMs(),
    currentItemName: queueState.currentItemName,
    currentItemIndex: queueState.currentItemIndex,
    nextRunAt: queueState.nextRunAt,
    statusText: queueState.statusText,
    lastResult: queueState.lastResult,
    lastError: queueState.lastError
  };
}

function clearTimers() {
  if (nextStepTimeout !== null) {
    clearTimeout(nextStepTimeout);
    nextStepTimeout = null;
  }

  if (heartbeatInterval !== null) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

function startHeartbeat() {
  if (heartbeatInterval !== null) {
    return;
  }

  heartbeatInterval = setInterval(async () => {
    try {
      await chrome.storage.local.set({ lastHeartbeatAt: Date.now() });
    } catch (error) {
      // Ignore heartbeat write failures.
    }
  }, 20000);
}

function resetRunFields() {
  queueState.running = false;
  queueState.paused = false;
  queueState.stopping = false;
  queueState.currentItemName = "";
  queueState.currentItemIndex = 0;
  queueState.nextRunAt = 0;
  queueState.remainingDelayMs = 0;
}

function setStatus(statusText, lastResult, lastError = "") {
  queueState.statusText = statusText;
  queueState.lastResult = lastResult;
  queueState.lastError = lastError;
}

function finishQueue() {
  const completed = queueState.processed >= queueState.total && queueState.total > 0 && !queueState.stopping;
  const manualStop = queueState.stopping;

  clearTimers();
  resetRunFields();

  if (completed) {
    setStatus("Done", `Opened ${queueState.processed} of ${queueState.total} boosters.`);
    return;
  }

  if (manualStop) {
    setStatus("Stopped", `Stopped by user. Already opened: ${queueState.processed} of ${queueState.total}.`);
    return;
  }

  setStatus("Idle", "Nothing to run.");
}

async function sendMessageToQueueTab(message) {
  if (typeof queueState.tabId !== "number") {
    throw new Error("Steam tab is not available anymore.");
  }

  return chrome.tabs.sendMessage(queueState.tabId, message);
}

async function executeNextStep() {
  nextStepTimeout = null;

  if (!queueState.running || queueState.stopping) {
    finishQueue();
    return;
  }

  if (!queueState.queue.length) {
    finishQueue();
    return;
  }

  const item = queueState.queue.shift();
  queueState.currentItemIndex = queueState.processed + 1;
  queueState.currentItemName = item.name;
  queueState.nextRunAt = 0;

  let response;
  try {
    response = await sendMessageToQueueTab({ type: "openBoosterOnPage", item });
  } catch (error) {
    clearTimers();
    resetRunFields();
    setStatus("Stopped", "Queue stopped because of an error.", "Could not reach the Steam tab.");
    return;
  }

  if (!response || response.ok !== true) {
    clearTimers();
    resetRunFields();
    setStatus(
      "Stopped",
      "Queue stopped because of an error.",
      response?.message || "Steam tab did not confirm booster opening."
    );
    return;
  }

  queueState.processed += 1;
  setStatus("Running", `Opened: ${item.name}`);

  if (!queueState.queue.length || queueState.stopping) {
    finishQueue();
    return;
  }

  if (queueState.paused) {
    queueState.nextRunAt = 0;
    queueState.remainingDelayMs = 0;
    queueState.statusText = "Paused";
    queueState.lastResult = `Paused after opening ${queueState.processed} of ${queueState.total}.`;
    return;
  }

  const nextDelayMs = getRandomDelayMs();
  queueState.remainingDelayMs = nextDelayMs;
  queueState.nextRunAt = Date.now() + nextDelayMs;
  nextStepTimeout = setTimeout(() => {
    executeNextStep().catch((error) => {
      clearTimers();
      resetRunFields();
      setStatus("Stopped", "Queue stopped because of an error.", error.message || "Unknown error");
    });
  }, nextDelayMs);
}

async function startQueue(message, sender) {
  clearTimers();

  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") {
    throw new Error("Could not determine the Steam tab.");
  }

  const normalizedRange = normalizeDelayRange(message.minDelayMs, message.maxDelayMs);
  queueState = {
    ...createInitialState(),
    running: true,
    paused: false,
    stopping: false,
    queue: Array.isArray(message.queue) ? [...message.queue] : [],
    total: Array.isArray(message.queue) ? message.queue.length : 0,
    processed: 0,
    minDelayMs: normalizedRange.minDelayMs,
    maxDelayMs: normalizedRange.maxDelayMs,
    statusText: "Running",
    lastResult: Array.isArray(message.queue) && message.queue.length
      ? `Found ${message.queue.length} boosters. Starting queue.`
      : "No booster packs found.",
    tabId
  };

  await chrome.storage.local.set({
    minDelayMs: queueState.minDelayMs,
    maxDelayMs: queueState.maxDelayMs
  });

  if (!queueState.total) {
    resetRunFields();
    setStatus("Done", "No booster packs found.");
    return getStatusPayload();
  }

  startHeartbeat();
  executeNextStep().catch((error) => {
    clearTimers();
    resetRunFields();
    setStatus("Stopped", "Queue stopped because of an error.", error.message || "Unknown error");
  });

  return getStatusPayload();
}

function stopQueue() {
  if (!queueState.running && !queueState.stopping) {
    setStatus("Idle", "No active queue.");
    return getStatusPayload();
  }

  queueState.stopping = true;
  queueState.statusText = "Stopping...";
  queueState.lastResult = `Waiting for the current step to finish, then stopping. Opened: ${queueState.processed} of ${queueState.total}.`;
  return getStatusPayload();
}

function pauseQueue() {
  if (!queueState.running || queueState.stopping) {
    setStatus("Idle", "No active queue.");
    return getStatusPayload();
  }

  if (queueState.paused) {
    return getStatusPayload();
  }

  queueState.paused = true;

  if (nextStepTimeout !== null) {
    queueState.remainingDelayMs = Math.max(0, queueState.nextRunAt - Date.now());
    clearTimeout(nextStepTimeout);
    nextStepTimeout = null;
    queueState.nextRunAt = 0;
    queueState.statusText = "Paused";
    queueState.lastResult = `Paused with ${queueState.processed} of ${queueState.total} already opened.`;
  } else {
    queueState.statusText = "Pausing...";
    queueState.lastResult = "Waiting for the current request to finish, then pausing.";
  }

  return getStatusPayload();
}

function resumeQueue() {
  if (!queueState.running || queueState.stopping) {
    setStatus("Idle", "No paused queue to resume.");
    return getStatusPayload();
  }

  if (!queueState.paused) {
    return getStatusPayload();
  }

  queueState.paused = false;
  queueState.statusText = "Running";
  queueState.lastResult = `Resumed queue at ${queueState.processed} of ${queueState.total}.`;

  const delayMs = Math.max(0, queueState.remainingDelayMs || 0);
  queueState.remainingDelayMs = 0;

  if (nextStepTimeout !== null) {
    return getStatusPayload();
  }

  if (delayMs > 0) {
    queueState.nextRunAt = Date.now() + delayMs;
    nextStepTimeout = setTimeout(() => {
      executeNextStep().catch((error) => {
        clearTimers();
        resetRunFields();
        setStatus("Stopped", "Queue stopped because of an error.", error.message || "Unknown error");
      });
    }, delayMs);
  } else {
    queueState.nextRunAt = 0;
    executeNextStep().catch((error) => {
      clearTimers();
      resetRunFields();
      setStatus("Stopped", "Queue stopped because of an error.", error.message || "Unknown error");
    });
  }

  return getStatusPayload();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  if (message.type === "getWorkerStatus") {
    sendResponse(getStatusPayload());
    return undefined;
  }

  if (message.type === "startQueue") {
    startQueue(message, sender)
      .then((status) => sendResponse(status))
      .catch((error) =>
        sendResponse({
          ok: false,
          message: error.message || "Could not start the queue."
        })
      );

    return true;
  }

  if (message.type === "stopQueue") {
    sendResponse(stopQueue());
    return undefined;
  }

  if (message.type === "pauseQueue") {
    sendResponse(pauseQueue());
    return undefined;
  }

  if (message.type === "resumeQueue") {
    sendResponse(resumeQueue());
    return undefined;
  }

  if (message.type === "setPreparing") {
    setStatus("Preparing", "Reading inventory and building the queue...");
    sendResponse(getStatusPayload());
    return undefined;
  }

  return undefined;
});
