import { pickNextProblem, getSrsPayload } from "./srs.js";
import { getHeatmapData } from "./behavior.js";
import { renderHeatmap, formatPeakLine } from "./heatmap.js";
import { problems } from "./problems.js";

const SYNC_KEYS = {
  blacklist: "blacklist",
  enabled: "enabled",
  lcUsername: "lcUsername"
};

const LOCAL_KEYS = {
  lastSlug: "lastRedirectSlug",
  lastDifficulty: "lastRedirectDifficulty",
  redirectsToday: "redirectsToday",
  redirectsDate: "redirectsDate",
  streak: "redirectStreak",
  behaviorLog: "behaviorLog"
};

const difficultyFor = (slug) => problems.find((p) => p.slug === slug)?.difficulty || "Medium";

const blockedCountEl = document.getElementById("blocked-count");
const redirectsTodayEl = document.getElementById("redirects-today");
const lastSlugEl = document.getElementById("last-slug");
const lastDifficultyEl = document.getElementById("last-difficulty");
const streakDaysEl = document.getElementById("streak-days");
const sitesListEl = document.getElementById("sites-list");
const siteInputEl = document.getElementById("site-input");
const toggleStateEl = document.getElementById("toggle-state");
const randomLinkEl = document.getElementById("random-link");

const viewMainEl = document.getElementById("view-main");
const viewHeatmapEl = document.getElementById("view-heatmap");
const viewQueueEl = document.getElementById("view-queue");
const tabHeatmapBtn = document.getElementById("tab-heatmap");
const tabQueueBtn = document.getElementById("tab-queue");
const heatmapBackBtn = document.getElementById("heatmap-back");
const queueBackBtn = document.getElementById("queue-back");
const heatmapCanvas = document.getElementById("heatmap-canvas");
const heatmapPeakEl = document.getElementById("heatmap-peak");
const queueListEl = document.getElementById("queue-list");
const queueHeaderEl = document.getElementById("queue-header");
const lcInputEl = document.getElementById("lc-username-input");
const lcSavedEl = document.getElementById("lc-saved");

/** @type {"main" | "heatmap" | "queue"} */
let activeView = "main";
let lcSavedTimer = null;

function getTodayISO() {
  return new Date().toISOString().split("T")[0];
}

function normalizeDomain(input) {
  return input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function renderDifficulty(value) {
  const difficulty = value || "n/a";
  lastDifficultyEl.textContent = difficulty;
  lastDifficultyEl.classList.remove("easy", "medium", "hard", "val");

  if (difficulty === "Easy") {
    lastDifficultyEl.classList.add("easy");
  } else if (difficulty === "Medium") {
    lastDifficultyEl.classList.add("medium");
  } else if (difficulty === "Hard") {
    lastDifficultyEl.classList.add("hard");
  } else {
    lastDifficultyEl.classList.add("val");
  }
}

function showView(which) {
  activeView = which;
  const showMain = which === "main";
  const showHeat = which === "heatmap";
  const showQ = which === "queue";
  viewMainEl.classList.toggle("panel-hidden", !showMain);
  viewHeatmapEl.classList.toggle("panel-hidden", !showHeat);
  viewQueueEl.classList.toggle("panel-hidden", !showQ);
}

async function fetchState() {
  const [syncData, localData] = await Promise.all([
    chrome.storage.sync.get([SYNC_KEYS.blacklist, SYNC_KEYS.enabled, SYNC_KEYS.lcUsername]),
    chrome.storage.local.get([
      LOCAL_KEYS.lastSlug,
      LOCAL_KEYS.lastDifficulty,
      LOCAL_KEYS.redirectsToday,
      LOCAL_KEYS.redirectsDate,
      LOCAL_KEYS.streak
    ])
  ]);

  const blacklist = Array.isArray(syncData.blacklist) ? syncData.blacklist : [];
  const enabled = syncData.enabled !== false;
  const today = getTodayISO();
  const redirectsToday = localData.redirectsDate === today ? localData.redirectsToday || 0 : 0;

  return {
    blacklist,
    enabled,
    lcUsername: typeof syncData.lcUsername === "string" ? syncData.lcUsername : "",
    lastSlug: localData.lastRedirectSlug || "none",
    lastDifficulty: localData.lastRedirectDifficulty || "n/a",
    redirectsToday,
    streak: localData.redirectStreak || 0
  };
}

function renderSites(blacklist) {
  sitesListEl.innerHTML = "";

  blacklist.forEach((site) => {
    const row = document.createElement("div");
    row.className = "site-row";

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-btn";
    removeBtn.type = "button";
    removeBtn.textContent = "[×]";
    removeBtn.title = `Remove ${site}`;
    removeBtn.addEventListener("click", async () => {
      const data = await chrome.storage.sync.get([SYNC_KEYS.blacklist]);
      const existing = Array.isArray(data.blacklist) ? data.blacklist : [];
      const next = existing.filter((item) => item !== site);
      await chrome.storage.sync.set({ blacklist: next });
      await renderMain();
    });

    const siteName = document.createElement("span");
    siteName.className = "site-name";
    siteName.textContent = site;

    row.append(removeBtn, siteName);
    sitesListEl.appendChild(row);
  });
}

function renderToggle(enabled) {
  toggleStateEl.textContent = enabled ? "[ACTIVE]" : "[PAUSED]";
  toggleStateEl.classList.toggle("active", enabled);
  toggleStateEl.classList.toggle("paused", !enabled);
}

async function renderMain() {
  const state = await fetchState();

  blockedCountEl.textContent = String(state.blacklist.length);
  redirectsTodayEl.textContent = String(state.redirectsToday);
  lastSlugEl.textContent = state.lastSlug;
  streakDaysEl.textContent = `${state.streak}d`;
  if (document.activeElement !== lcInputEl) {
    lcInputEl.value = state.lcUsername;
  }

  renderDifficulty(state.lastDifficulty);
  renderSites(state.blacklist);
  renderToggle(state.enabled);
}

async function renderHeatmapPanel() {
  const raw = await chrome.storage.local.get([LOCAL_KEYS.behaviorLog]);
  const log = Array.isArray(raw.behaviorLog) ? raw.behaviorLog : [];
  const grid = getHeatmapData(log);
  renderHeatmap(heatmapCanvas, grid);
  heatmapPeakEl.textContent = formatPeakLine(grid);
}

async function renderQueuePanel() {
  const srs = await getSrsPayload();
  const records = srs.records && typeof srs.records === "object" ? srs.records : {};
  const now = Date.now();

  const scheduled = Object.entries(records)
    .filter(([, rec]) => rec && typeof rec.nextDue === "number")
    .map(([slug, rec]) => ({
      slug,
      rec,
      overdue: rec.nextDue <= now
    }));

  scheduled.sort((a, b) => {
    if (a.overdue && !b.overdue) return -1;
    if (!a.overdue && b.overdue) return 1;
    return a.rec.nextDue - b.rec.nextDue;
  });

  queueHeaderEl.textContent = `due problems (${scheduled.length})`;
  queueListEl.innerHTML = "";

  scheduled.forEach(({ slug, rec, overdue }) => {
    const row = document.createElement("div");
    row.className = "queue-row";

    const mark = document.createElement("span");
    mark.textContent = overdue ? "[!] " : "[ ] ";
    mark.className = overdue ? "queue-mark-bang" : "queue-mark-slot";

    const slugSpan = document.createElement("span");
    slugSpan.textContent = slug;
    slugSpan.className = overdue ? "queue-slug-overdue" : "queue-slug-soon";

    const diff = difficultyFor(slug);
    const diffSpan = document.createElement("span");
    diffSpan.textContent = ` [${diff}]`;
    if (diff === "Easy") diffSpan.classList.add("easy");
    else if (diff === "Medium") diffSpan.classList.add("medium");
    else diffSpan.classList.add("hard");

    const meta = document.createElement("span");
    meta.className = "muted-inline";
    let dueText;
    if (overdue) {
      dueText = "due now";
    } else {
      const days = Math.max(1, Math.ceil((rec.nextDue - now) / 86400000));
      dueText = `due in ${days}d`;
    }
    const dodged = typeof rec.dodgedCount === "number" ? rec.dodgedCount : 0;
    meta.textContent = ` · ${dueText} · dodged ${dodged}x`;

    row.append(mark, slugSpan, diffSpan, meta);
    queueListEl.appendChild(row);
  });
}

async function refreshActiveView() {
  if (activeView === "main") {
    await renderMain();
  } else if (activeView === "heatmap") {
    await renderHeatmapPanel();
  } else if (activeView === "queue") {
    await renderQueuePanel();
  }
}

toggleStateEl.addEventListener("click", async () => {
  const data = await chrome.storage.sync.get([SYNC_KEYS.enabled]);
  const next = data.enabled === false;
  await chrome.storage.sync.set({ enabled: next });
  await renderMain();
});

siteInputEl.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") {
    return;
  }

  const normalized = normalizeDomain(siteInputEl.value);
  siteInputEl.value = "";

  if (!normalized) {
    return;
  }

  const data = await chrome.storage.sync.get([SYNC_KEYS.blacklist]);
  const existing = Array.isArray(data.blacklist) ? data.blacklist : [];

  if (!existing.includes(normalized)) {
    await chrome.storage.sync.set({ blacklist: [...existing, normalized] });
  }

  await renderMain();
});

randomLinkEl.addEventListener("click", async () => {
  const selected = await pickNextProblem();
  await chrome.tabs.create({ url: `https://leetcode.com/problems/${selected.slug}/` });
});

tabHeatmapBtn.addEventListener("click", async () => {
  showView("heatmap");
  await renderHeatmapPanel();
});

tabQueueBtn.addEventListener("click", async () => {
  showView("queue");
  await renderQueuePanel();
});

heatmapBackBtn.addEventListener("click", async () => {
  showView("main");
  await renderMain();
});

queueBackBtn.addEventListener("click", async () => {
  showView("main");
  await renderMain();
});

lcInputEl.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") {
    return;
  }
  const v = lcInputEl.value.trim();
  await chrome.storage.sync.set({ lcUsername: v });
  lcSavedEl.classList.remove("panel-hidden");
  if (lcSavedTimer) clearTimeout(lcSavedTimer);
  lcSavedTimer = setTimeout(() => {
    lcSavedEl.classList.add("panel-hidden");
    lcSavedTimer = null;
  }, 2000);
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== "sync" && areaName !== "local") {
    return;
  }
  const relevant =
    changes.blacklist ||
    changes.enabled ||
    changes.lcUsername ||
    changes.lastRedirectSlug ||
    changes.lastRedirectDifficulty ||
    changes.redirectsToday ||
    changes.redirectsDate ||
    changes.redirectStreak ||
    changes.srs ||
    changes.behaviorLog;

  if (!relevant) {
    return;
  }

  await refreshActiveView();
});

renderMain();
showView("main");
