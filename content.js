(function () {
  const EXTENSION_VERSION = chrome.runtime.getManifest().version;
  const DEFAULT_MIN_DELAY_MS = 15000;
  const DEFAULT_MAX_DELAY_MS = 22000;
  const ABSOLUTE_MIN_DELAY_MS = 11000;
  const INVENTORY_PAGE_SIZES = [2000, 1000, 500];
  const INVENTORY_SCAN_MIN_DELAY_MS = 1000;
  const INVENTORY_SCAN_MAX_DELAY_MS = 2000;
  const INVENTORY_APP_ID = "753";
  const INVENTORY_CONTEXT_ID = "6";

  const pageState = {
    steamId: "",
    minDelayMs: DEFAULT_MIN_DELAY_MS,
    maxDelayMs: DEFAULT_MAX_DELAY_MS
  };

  let panelElements = null;
  let initialized = false;
  let liveRenderTimer = null;
  let latestStatus = {
    ok: true,
    running: false,
    paused: false,
    stopping: false,
    minDelayMs: DEFAULT_MIN_DELAY_MS,
    maxDelayMs: DEFAULT_MAX_DELAY_MS,
    total: 0,
    processed: 0,
    remaining: 0,
    estimatedRemainingMs: 0,
    currentItemName: "",
    currentItemIndex: 0,
    nextRunAt: 0,
    statusText: "Idle",
    lastResult: "Nothing started yet.",
    lastError: ""
  };

  function isInventoryPage() {
    return /\/inventory(?:\/|$)/i.test(window.location.pathname);
  }

  function normalizeDelayRange(minMs, maxMs) {
    const parsedMin = Number(minMs);
    const parsedMax = Number(maxMs);
    const safeMin = Number.isFinite(parsedMin) ? Math.round(parsedMin) : DEFAULT_MIN_DELAY_MS;
    const safeMax = Number.isFinite(parsedMax) ? Math.round(parsedMax) : DEFAULT_MAX_DELAY_MS;
    const clampedMin = Math.max(ABSOLUTE_MIN_DELAY_MS, safeMin);
    const clampedMax = Math.max(ABSOLUTE_MIN_DELAY_MS, safeMax);

    if (clampedMin <= clampedMax) {
      return {
        minDelayMs: clampedMin,
        maxDelayMs: clampedMax
      };
    }

    return {
      minDelayMs: clampedMax,
      maxDelayMs: clampedMin
    };
  }

  function getRandomInventoryScanDelayMs() {
    const span = INVENTORY_SCAN_MAX_DELAY_MS - INVENTORY_SCAN_MIN_DELAY_MS;
    return INVENTORY_SCAN_MIN_DELAY_MS + Math.floor(Math.random() * (span + 1));
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function getSessionId() {
    const match = document.cookie.match(/(?:^|;\s*)sessionid=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function findFirstMatch(pattern, text) {
    const match = text.match(pattern);
    return match ? match[1] : "";
  }

  function accountIdToSteamId64(accountId) {
    try {
      const normalized = String(accountId || "").trim();
      if (!/^\d+$/.test(normalized)) {
        return "";
      }

      return (BigInt(normalized) + 76561197960265728n).toString();
    } catch (error) {
      return "";
    }
  }

  function getSteamIdFromPath() {
    const match = window.location.pathname.match(/\/profiles\/(\d+)(?:\/|$)/i);
    return match ? match[1] : "";
  }

  function getInventoryBasePath() {
    const path = window.location.pathname;
    const profileMatch = path.match(/^(\/profiles\/\d+\/)/i);
    if (profileMatch) {
      return profileMatch[1];
    }

    const customIdMatch = path.match(/^(\/id\/[^/]+\/)/i);
    if (customIdMatch) {
      return customIdMatch[1];
    }

    return "/my/";
  }

  function getBoosterOpenUrl() {
    return new URL(`${getInventoryBasePath()}ajaxunpackbooster/`, window.location.origin).toString();
  }

  function getSteamIdFromMiniProfile() {
    const candidate = document.querySelector("[data-miniprofile]");
    if (!candidate) {
      return "";
    }

    return accountIdToSteamId64(candidate.getAttribute("data-miniprofile"));
  }

  function getSteamIdFromPage() {
    if (pageState.steamId) {
      return pageState.steamId;
    }

    const fromPath = getSteamIdFromPath();
    if (fromPath) {
      pageState.steamId = fromPath;
      return fromPath;
    }

    for (const script of document.scripts) {
      const text = script.textContent || "";
      const steamId =
        findFirstMatch(/g_steamID\s*=\s*"(\d+)"/, text) ||
        findFirstMatch(/g_steamID\s*=\s*'(\d+)'/, text) ||
        findFirstMatch(/"steamid"\s*:\s*"(\d+)"/, text);

      if (/^\d{17}$/.test(steamId)) {
        pageState.steamId = steamId;
        return steamId;
      }
    }

    const fromMiniProfile = getSteamIdFromMiniProfile();
    if (fromMiniProfile) {
      pageState.steamId = fromMiniProfile;
      return fromMiniProfile;
    }

    const fallback = findFirstMatch(/g_steamID\s*=\s*"(\d+)"/, document.documentElement.innerHTML);
    if (/^\d{17}$/.test(fallback)) {
      pageState.steamId = fallback;
    }

    return pageState.steamId;
  }

  function extractBoosterAppId(description) {
    const direct = String(description.market_fee_app || "").trim();
    if (direct && direct !== INVENTORY_APP_ID) {
      return direct;
    }

    const buckets = [
      description.actions,
      description.owner_actions,
      description.market_actions,
      description.owner_descriptions,
      description.descriptions
    ];

    for (const bucket of buckets) {
      if (!Array.isArray(bucket)) {
        continue;
      }

      for (const entry of bucket) {
        const text = String(entry?.link || entry?.value || "");
        const gamecardsMatch = text.match(/gamecards\/(\d+)/i);
        if (gamecardsMatch) {
          return gamecardsMatch[1];
        }
      }
    }

    return "";
  }

  function isBoosterPack(description) {
    const text = [
      description.type,
      description.market_name,
      description.market_hash_name,
      description.name
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (text.includes("booster pack")) {
      return true;
    }

    if (!Array.isArray(description.tags)) {
      return false;
    }

    return description.tags.some((tag) => {
      const values = [tag?.name, tag?.localized_tag_name, tag?.internal_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return values.includes("booster");
    });
  }

  async function fetchJson(url) {
    const response = await fetch(url, {
      credentials: "include",
      headers: {
        Accept: "application/json"
      }
    });

    const rawText = await response.text();

    if (!response.ok) {
      const snippet = rawText.replace(/\s+/g, " ").trim().slice(0, 180);
      throw new Error(
        `Steam returned ${response.status} while reading inventory.${snippet ? ` Response: ${snippet}` : ""}`
      );
    }

    try {
      return JSON.parse(rawText);
    } catch (error) {
      throw new Error("Steam returned non-JSON inventory data.");
    }
  }

  async function fetchInventoryPage(steamId, startAssetId, count) {
    const url = new URL(`/inventory/${steamId}/${INVENTORY_APP_ID}/${INVENTORY_CONTEXT_ID}`, window.location.origin);
    url.searchParams.set("l", "english");
    url.searchParams.set("count", String(count));

    if (startAssetId) {
      url.searchParams.set("start_assetid", startAssetId);
    }

    return fetchJson(url.toString());
  }

  async function buildBoosterQueue() {
    const steamId = getSteamIdFromPage();
    if (!steamId) {
      throw new Error("Could not detect SteamID on the page. Open your own Steam Community inventory.");
    }

    const queue = [];
    let startAssetId = "";
    let page = 0;
    let workingPageSize = 0;

    while (page < 20) {
      let data = null;
      let lastError = null;

      const pageSizesToTry = workingPageSize ? [workingPageSize] : INVENTORY_PAGE_SIZES;
      for (const count of pageSizesToTry) {
        try {
          data = await fetchInventoryPage(steamId, startAssetId, count);
          workingPageSize = count;
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (!data) {
        throw lastError || new Error("Could not read inventory.");
      }

      const descriptions = Array.isArray(data.descriptions) ? data.descriptions : [];
      const assets = Array.isArray(data.assets) ? data.assets : [];
      const descriptionMap = new Map(
        descriptions.map((description) => [`${description.classid}_${description.instanceid}`, description])
      );

      for (const asset of assets) {
        const description = descriptionMap.get(`${asset.classid}_${asset.instanceid}`);
        if (!description || !isBoosterPack(description)) {
          continue;
        }

        const appId = extractBoosterAppId(description);
        if (!appId) {
          continue;
        }

        const itemName =
          description.market_name ||
          description.market_hash_name ||
          description.name ||
          `Booster ${appId}`;

        const amount = Math.max(1, Number(asset.amount || "1"));
        for (let index = 0; index < amount; index += 1) {
          queue.push({
            assetid: String(asset.assetid),
            appid: String(appId),
            name: itemName
          });
        }
      }

      const hasMore = Boolean(data.more_items);
      startAssetId = String(data.last_assetid || "");
      page += 1;

      if (!hasMore || !startAssetId) {
        break;
      }

      await sleep(getRandomInventoryScanDelayMs());
    }

    return queue;
  }

  async function postForm(url, body) {
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body
    });

    const rawText = await response.text();
    let json = null;

    try {
      json = JSON.parse(rawText);
    } catch (error) {
      json = null;
    }

    if (!response.ok) {
      throw new Error(`Steam returned ${response.status} while opening the booster.`);
    }

    if (!json || (json.success !== 1 && json.success !== true)) {
      if (json && Number(json.success) === 2) {
        throw new Error("Steam temporarily limited requests. Stopped to avoid hammering the server.");
      }

      throw new Error("Steam did not confirm booster opening.");
    }

    return json;
  }

  async function openBoosterOnPage(item) {
    const sessionId = getSessionId();
    if (!sessionId) {
      throw new Error("No sessionid cookie found. Make sure you are logged into Steam Community.");
    }

    const body = new URLSearchParams({
      sessionid: sessionId,
      appid: String(item.appid),
      communityitemid: String(item.assetid)
    });

    return postForm(getBoosterOpenUrl(), body.toString());
  }

  async function queryWorkerStatus() {
    const status = await chrome.runtime.sendMessage({ type: "getWorkerStatus" });
    if (status && status.ok) {
      latestStatus = {
        ...latestStatus,
        ...status,
        inventoryPage: isInventoryPage()
      };
      pageState.minDelayMs = latestStatus.minDelayMs;
      pageState.maxDelayMs = latestStatus.maxDelayMs;
    }

    return {
      ...latestStatus,
      inventoryPage: isInventoryPage()
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

  function formatDelayRange() {
    const minSeconds = Math.round(pageState.minDelayMs / 1000);
    const maxSeconds = Math.round(pageState.maxDelayMs / 1000);
    return `${minSeconds}-${maxSeconds} sec`;
  }

  function ensureLiveRenderTimer() {
    if (liveRenderTimer !== null) {
      return;
    }

    liveRenderTimer = window.setInterval(async () => {
      if (!panelElements) {
        return;
      }

      await queryWorkerStatus();
      renderPanel();
    }, 1000);
  }

  function createPanel() {
    if (panelElements) {
      return;
    }

    const panel = document.createElement("section");
    panel.id = "sbpu-panel";
    panel.innerHTML = `
      <h2 class="sbpu-title">Steam Booster Slow Unpacker</h2>
      <div class="sbpu-version">Version ${EXTENSION_VERSION}</div>
      <div class="sbpu-row">
        <label class="sbpu-label" for="sbpu-delay-min">Delay min</label>
        <input id="sbpu-delay-min" class="sbpu-input" type="number" min="11" step="1" value="15">
        <span>sec</span>
      </div>
      <div class="sbpu-row">
        <label class="sbpu-label" for="sbpu-delay-max">Delay max</label>
        <input id="sbpu-delay-max" class="sbpu-input" type="number" min="11" step="1" value="22">
        <span>sec</span>
      </div>
      <div class="sbpu-buttons">
        <button type="button" class="sbpu-button sbpu-start" id="sbpu-start">Start</button>
        <button type="button" class="sbpu-button sbpu-pause" id="sbpu-pause">Pause</button>
        <button type="button" class="sbpu-button sbpu-stop" id="sbpu-stop">Stop</button>
      </div>
      <div class="sbpu-meta">
        <div class="sbpu-meta-key">Status</div>
        <div class="sbpu-meta-value" id="sbpu-status">Idle</div>
        <div class="sbpu-meta-key">Queue</div>
        <div class="sbpu-meta-value" id="sbpu-queue">0 / 0</div>
        <div class="sbpu-meta-key">Delay range</div>
        <div class="sbpu-meta-value" id="sbpu-range">15-22 sec</div>
        <div class="sbpu-meta-key">Estimated left</div>
        <div class="sbpu-meta-value" id="sbpu-eta">-</div>
        <div class="sbpu-meta-key">Current</div>
        <div class="sbpu-meta-value" id="sbpu-current">-</div>
        <div class="sbpu-meta-key">Next in</div>
        <div class="sbpu-meta-value" id="sbpu-next">-</div>
        <div class="sbpu-meta-key">Last</div>
        <div class="sbpu-meta-value" id="sbpu-last">Nothing started yet.</div>
        <div class="sbpu-meta-key">Error</div>
        <div class="sbpu-meta-value" id="sbpu-error">-</div>
      </div>
      <div class="sbpu-note">Keep the Steam tab open while the queue is running.</div>
    `;

    document.body.appendChild(panel);

    panelElements = {
      panel,
      minDelayInput: panel.querySelector("#sbpu-delay-min"),
      maxDelayInput: panel.querySelector("#sbpu-delay-max"),
      startButton: panel.querySelector("#sbpu-start"),
      pauseButton: panel.querySelector("#sbpu-pause"),
      stopButton: panel.querySelector("#sbpu-stop"),
      status: panel.querySelector("#sbpu-status"),
      queue: panel.querySelector("#sbpu-queue"),
      range: panel.querySelector("#sbpu-range"),
      eta: panel.querySelector("#sbpu-eta"),
      current: panel.querySelector("#sbpu-current"),
      next: panel.querySelector("#sbpu-next"),
      last: panel.querySelector("#sbpu-last"),
      error: panel.querySelector("#sbpu-error")
    };

    panelElements.startButton.addEventListener("click", async () => {
      try {
        if (!isInventoryPage()) {
          throw new Error("Open your own Steam inventory in the browser and run the extension there.");
        }

        const normalizedRange = normalizeDelayRange(
          Number(panelElements.minDelayInput.value || "15") * 1000,
          Number(panelElements.maxDelayInput.value || "22") * 1000
        );
        pageState.minDelayMs = normalizedRange.minDelayMs;
        pageState.maxDelayMs = normalizedRange.maxDelayMs;

        await chrome.runtime.sendMessage({ type: "setPreparing" });
        await queryWorkerStatus();
        renderPanel();

        const queue = await buildBoosterQueue();
        const status = await chrome.runtime.sendMessage({
          type: "startQueue",
          queue,
          minDelayMs: pageState.minDelayMs,
          maxDelayMs: pageState.maxDelayMs
        });

        if (status && status.ok) {
          latestStatus = {
            ...latestStatus,
            ...status,
            inventoryPage: true
          };
        } else {
          latestStatus.lastError = status?.message || "Could not start the queue.";
          latestStatus.statusText = "Stopped";
        }
      } catch (error) {
        latestStatus.statusText = "Stopped";
        latestStatus.lastResult = "Could not start the queue.";
        latestStatus.lastError = error.message || "Unknown error";
      }

      renderPanel();
    });

    panelElements.stopButton.addEventListener("click", async () => {
      const status = await chrome.runtime.sendMessage({ type: "stopQueue" });
      if (status && status.ok) {
        latestStatus = {
          ...latestStatus,
          ...status,
          inventoryPage: isInventoryPage()
        };
      }

      renderPanel();
    });

    panelElements.pauseButton.addEventListener("click", async () => {
      const action = latestStatus.paused ? "resumeQueue" : "pauseQueue";
      const status = await chrome.runtime.sendMessage({ type: action });
      if (status && status.ok) {
        latestStatus = {
          ...latestStatus,
          ...status,
          inventoryPage: isInventoryPage()
        };
      }

      renderPanel();
    });

    ensureLiveRenderTimer();
    renderPanel();
  }

  function renderPanel() {
    if (!panelElements) {
      return;
    }

    panelElements.panel.classList.toggle("sbpu-hidden", !isInventoryPage());
    panelElements.minDelayInput.value = String(Math.max(11, Math.round(pageState.minDelayMs / 1000)));
    panelElements.maxDelayInput.value = String(Math.max(11, Math.round(pageState.maxDelayMs / 1000)));
    panelElements.status.textContent = latestStatus.statusText || "Idle";
    panelElements.queue.textContent = `${latestStatus.processed || 0} / ${latestStatus.total || 0}`;
    panelElements.range.textContent = formatDelayRange();
    panelElements.eta.textContent = formatDuration(latestStatus.estimatedRemainingMs || 0);
    panelElements.current.textContent = latestStatus.currentItemName || "-";
    panelElements.next.textContent = formatNextRun(latestStatus.nextRunAt || 0);
    panelElements.last.textContent = latestStatus.lastResult || "-";
    panelElements.error.textContent = latestStatus.lastError || "-";
    panelElements.startButton.disabled = latestStatus.running;
    panelElements.pauseButton.textContent = latestStatus.paused ? "Resume" : "Pause";
    panelElements.pauseButton.disabled = !latestStatus.running && !latestStatus.paused;
    panelElements.stopButton.disabled = !latestStatus.running && !latestStatus.stopping;
  }

  async function initialize() {
    if (initialized) {
      return;
    }

    initialized = true;

    const stored = await chrome.storage.local.get({
      minDelayMs: DEFAULT_MIN_DELAY_MS,
      maxDelayMs: DEFAULT_MAX_DELAY_MS
    });
    const normalizedRange = normalizeDelayRange(stored.minDelayMs, stored.maxDelayMs);
    pageState.minDelayMs = normalizedRange.minDelayMs;
    pageState.maxDelayMs = normalizedRange.maxDelayMs;

    await queryWorkerStatus();

    if (isInventoryPage()) {
      createPanel();
      renderPanel();
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || typeof message !== "object") {
        return undefined;
      }

      if (message.type === "openBoosterOnPage") {
        openBoosterOnPage(message.item)
          .then(() => sendResponse({ ok: true }))
          .catch((error) => sendResponse({ ok: false, message: error.message || "Could not open booster." }));
        return true;
      }

      if (message.type === "getStatus") {
        queryWorkerStatus()
          .then((status) => {
            renderPanel();
            sendResponse({
              ...status,
              inventoryPage: isInventoryPage()
            });
          })
          .catch((error) =>
            sendResponse({
              ok: false,
              inventoryPage: isInventoryPage(),
              message: error.message || "Could not get queue status."
            })
          );
        return true;
      }

      if (message.type === "stop") {
        chrome.runtime.sendMessage({ type: "stopQueue" })
          .then((status) => {
            latestStatus = {
              ...latestStatus,
              ...status,
              inventoryPage: isInventoryPage()
            };
            renderPanel();
            sendResponse({
              ...latestStatus,
              inventoryPage: isInventoryPage()
            });
          })
          .catch((error) =>
            sendResponse({
              ok: false,
              inventoryPage: isInventoryPage(),
              message: error.message || "Could not stop the queue."
            })
          );
        return true;
      }

      if (message.type === "pause") {
        chrome.runtime.sendMessage({ type: latestStatus.paused ? "resumeQueue" : "pauseQueue" })
          .then((status) => {
            latestStatus = {
              ...latestStatus,
              ...status,
              inventoryPage: isInventoryPage()
            };
            renderPanel();
            sendResponse({
              ...latestStatus,
              inventoryPage: isInventoryPage()
            });
          })
          .catch((error) =>
            sendResponse({
              ok: false,
              inventoryPage: isInventoryPage(),
              message: error.message || "Could not pause or resume the queue."
            })
          );
        return true;
      }

      if (message.type === "start") {
        (async () => {
          try {
            if (!isInventoryPage()) {
              throw new Error("Open your own Steam inventory in the browser and run the extension there.");
            }

            const normalized = normalizeDelayRange(message.minDelayMs, message.maxDelayMs);
            pageState.minDelayMs = normalized.minDelayMs;
            pageState.maxDelayMs = normalized.maxDelayMs;

            await chrome.runtime.sendMessage({ type: "setPreparing" });
            await queryWorkerStatus();
            renderPanel();

            const queue = await buildBoosterQueue();
            const status = await chrome.runtime.sendMessage({
              type: "startQueue",
              queue,
              minDelayMs: pageState.minDelayMs,
              maxDelayMs: pageState.maxDelayMs
            });

            latestStatus = {
              ...latestStatus,
              ...status,
              inventoryPage: true
            };

            renderPanel();
            sendResponse({
              ...latestStatus,
              inventoryPage: true
            });
          } catch (error) {
            sendResponse({
              ok: false,
              inventoryPage: isInventoryPage(),
              message: error.message || "Could not start the queue."
            });
          }
        })();

        return true;
      }

      return undefined;
    });
  }

  initialize();
})();
