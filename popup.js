import { pickNextProblem, getSchedulePayload } from "./schedule.js";
import { getHeatmapData } from "./behavior.js";
import { renderHeatmap, formatPeakLine } from "./heatmap.js";
import { problems } from "./problems.js";
import {
  REDIRECT_MODE_LEETCODE,
  REDIRECT_MODE_CUSTOM,
  normalizeHttpsUrl,
  describeCustomTargetShort,
  parseRedirectSettingsFromSync,
  STORAGE_REDIRECT_MODE,
  STORAGE_CUSTOM_REDIRECT_URL
} from "./redirect-settings.js";
import { attachFollowingCaret, syncAllFollowingCarets } from "./caret-follow.js";

const SYNC_KEYS = {
  blacklist: "blacklist",
  enabled: "enabled",
  lcUsername: "lcUsername",
  redirectMode: STORAGE_REDIRECT_MODE,
  customRedirectUrl: STORAGE_CUSTOM_REDIRECT_URL
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
const heatmapTooltipEl = document.getElementById("heatmap-tooltip");
const heatmapPeakEl = document.getElementById("heatmap-peak");
const queueListEl = document.getElementById("queue-list");
const queueHeaderEl = document.getElementById("queue-header");
const lcInputEl = document.getElementById("lc-username-input");
const lcSavedEl = document.getElementById("lc-saved");

const lcHelpTooltipEl = document.getElementById("lc-help-tooltip-desc");
const lcHelpTipWrapEl = document.querySelector(".lc-help-tip");
const lcHelpTipBtnEl = document.getElementById("lc-help-tip-btn");
const contentScrollerEl = document.querySelector(".content");

const redirectModeSelectEl = document.getElementById("redirect-mode-select");
const customUrlPanelEl = document.getElementById("custom-url-panel");
const customUrlInputEl = document.getElementById("custom-url-input");
const customUrlFeedbackEl = document.getElementById("custom-url-feedback");
const customTargetDisplayEl = document.getElementById("custom-target-display");
const customUrlMissingHintEl = document.getElementById("custom-url-missing");

/** @type {"main" | "heatmap" | "queue"} */
let activeView = "main";
let lcSavedTimer = null;
/** @type {boolean} */
let customUrlInputFocused = false;

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
  if (which === "queue" && redirectModeSelectEl?.value === REDIRECT_MODE_CUSTOM) {
    which = "main";
  }

  activeView = which;
  const showMain = which === "main";
  const showHeat = which === "heatmap";
  const showQ = which === "queue";
  viewMainEl.classList.toggle("panel-hidden", !showMain);
  viewHeatmapEl.classList.toggle("panel-hidden", !showHeat);
  viewQueueEl.classList.toggle("panel-hidden", !showQ);
}

function applyRedirectModeUi(mode, customHref, rawCustomInput) {
  const lcMode = mode === REDIRECT_MODE_LEETCODE;

  document.querySelectorAll(".leetcode-only").forEach((el) => {
    el.classList.toggle("panel-hidden", !lcMode);
  });

  document.querySelectorAll(".custom-only").forEach((el) => {
    el.classList.toggle("panel-hidden", lcMode);
  });

  redirectModeSelectEl.value = lcMode ? REDIRECT_MODE_LEETCODE : REDIRECT_MODE_CUSTOM;

  customUrlPanelEl.classList.toggle("panel-hidden", lcMode);
  hideCustomUrlFeedback();

  customTargetDisplayEl.textContent =
    lcMode ? "—" : describeCustomTargetShort(customHref || rawCustomInput || "");

  const missingCustomSaved = Boolean(
    mode === REDIRECT_MODE_CUSTOM &&
      !(typeof customHref === "string" && customHref.length > 0)
  );
  customUrlMissingHintEl?.classList.toggle("panel-hidden", !missingCustomSaved);

  if (!customUrlInputFocused) {
    const raw =
      typeof rawCustomInput === "string" ? rawCustomInput : customHref ? String(customHref) : "";
    customUrlInputEl.value = lcMode ? "" : raw;
  }
}

function hideCustomUrlFeedback() {
  customUrlFeedbackEl.textContent = "";
  customUrlFeedbackEl.classList.add("panel-hidden");
  customUrlFeedbackEl.classList.remove("warn");
}

async function persistCustomRedirectUrl() {
  if (redirectModeSelectEl.value !== REDIRECT_MODE_CUSTOM) {
    hideCustomUrlFeedback();
    return;
  }

  const trimmed = customUrlInputEl.value.trim();

  if (!trimmed) {
    hideCustomUrlFeedback();
    await chrome.storage.sync.set({ [STORAGE_CUSTOM_REDIRECT_URL]: "" });
    await renderMain();
    return;
  }

  const normalized = normalizeHttpsUrl(trimmed);

  if (!normalized) {
    customUrlFeedbackEl.textContent = "enter a valid https url";
    customUrlFeedbackEl.classList.remove("panel-hidden");
    customUrlFeedbackEl.classList.add("warn");
    return;
  }

  hideCustomUrlFeedback();
  await chrome.storage.sync.set({ [STORAGE_CUSTOM_REDIRECT_URL]: normalized });
  await renderMain();
}

async function clearLeetCodeSolvePipeline() {
  const all = await chrome.alarms.getAll();
  for (const alarm of all) {
    if (alarm.name.startsWith("checkSolve__")) {
      await chrome.alarms.clear(alarm.name);
    }
  }
  await chrome.storage.local.set({ pendingChecks: {} });
}

async function fetchState() {
  const [syncData, localData] = await Promise.all([
    chrome.storage.sync.get([
      SYNC_KEYS.blacklist,
      SYNC_KEYS.enabled,
      SYNC_KEYS.lcUsername,
      SYNC_KEYS.redirectMode,
      SYNC_KEYS.customRedirectUrl
    ]),
    chrome.storage.local.get([
      LOCAL_KEYS.lastSlug,
      LOCAL_KEYS.lastDifficulty,
      LOCAL_KEYS.redirectsToday,
      LOCAL_KEYS.redirectsDate,
      LOCAL_KEYS.streak
    ])
  ]);

  const { redirectMode, customRedirectUrl } = parseRedirectSettingsFromSync(syncData);
  const rawCustomUrlStored =
    typeof syncData.customRedirectUrl === "string" ? syncData.customRedirectUrl : "";

  const blacklist = Array.isArray(syncData.blacklist) ? syncData.blacklist : [];
  const enabled = syncData.enabled !== false;
  const today = getTodayISO();
  const redirectsToday = localData.redirectsDate === today ? localData.redirectsToday || 0 : 0;

  const lastSlugRaw = localData.lastRedirectSlug || "";

  let lastSlugUi = "none";
  if (
    redirectMode === REDIRECT_MODE_LEETCODE &&
    lastSlugRaw &&
    lastSlugRaw !== "__custom__"
  ) {
    lastSlugUi = lastSlugRaw;
  }

  return {
    blacklist,
    enabled,
    lcUsername: typeof syncData.lcUsername === "string" ? syncData.lcUsername : "",
    lastSlug: lastSlugUi,
    lastDifficulty: localData.lastRedirectDifficulty || "n/a",
    redirectsToday,
    streak: localData.redirectStreak || 0,
    redirectMode,
    customRedirectUrl,
    rawCustomUrlStored
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

  applyRedirectModeUi(state.redirectMode, state.customRedirectUrl, state.rawCustomUrlStored);

  if (activeView === "queue" && state.redirectMode === REDIRECT_MODE_CUSTOM) {
    showView("main");
  }

  blockedCountEl.textContent = String(state.blacklist.length);
  redirectsTodayEl.textContent = String(state.redirectsToday);

  lastSlugEl.textContent = state.lastSlug;
  streakDaysEl.textContent = `${state.streak}d`;
  if (document.activeElement !== lcInputEl) {
    lcInputEl.value = state.lcUsername;
  }

  if (state.redirectMode === REDIRECT_MODE_LEETCODE) {
    renderDifficulty(state.lastDifficulty);
  }

  renderSites(state.blacklist);
  renderToggle(state.enabled);
  syncAllFollowingCarets();
}

async function renderHeatmapPanel() {
  const raw = await chrome.storage.local.get([LOCAL_KEYS.behaviorLog]);
  const log = Array.isArray(raw.behaviorLog) ? raw.behaviorLog : [];
  const grid = getHeatmapData(log);
  renderHeatmap(heatmapCanvas, grid, heatmapTooltipEl);

  heatmapPeakEl.textContent = formatPeakLine(grid);
}

async function renderQueuePanel() {
  const payload = await getSchedulePayload();
  const records = payload.records && typeof payload.records === "object" ? payload.records : {};
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
  const syncData = await chrome.storage.sync.get([SYNC_KEYS.redirectMode]);
  if (syncData.redirectMode === REDIRECT_MODE_CUSTOM) {
    return;
  }
  const selected = await pickNextProblem();
  await chrome.tabs.create({ url: `https://leetcode.com/problems/${selected.slug}/` });
});

redirectModeSelectEl.addEventListener("change", async () => {
  const beforeRaw = await chrome.storage.sync.get([SYNC_KEYS.redirectMode]);
  const before =
    beforeRaw.redirectMode === REDIRECT_MODE_CUSTOM ? REDIRECT_MODE_CUSTOM : REDIRECT_MODE_LEETCODE;
  const next =
    redirectModeSelectEl.value === REDIRECT_MODE_CUSTOM ? REDIRECT_MODE_CUSTOM : REDIRECT_MODE_LEETCODE;

  if (next === REDIRECT_MODE_CUSTOM && before === REDIRECT_MODE_LEETCODE) {
    await clearLeetCodeSolvePipeline();
  }

  await chrome.storage.sync.set({ [STORAGE_REDIRECT_MODE]: next });
  hideCustomUrlFeedback();
  await renderMain();
});

customUrlInputEl.addEventListener("focus", () => {
  customUrlInputFocused = true;
});

customUrlInputEl.addEventListener("blur", async () => {
  customUrlInputFocused = false;
  await persistCustomRedirectUrl();
});

customUrlInputEl.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") {
    return;
  }
  event.preventDefault();
  await persistCustomRedirectUrl();
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
    changes.redirectMode ||
    changes.customRedirectUrl ||
    changes.lastRedirectSlug ||
    changes.lastRedirectDifficulty ||
    changes.redirectsToday ||
    changes.redirectsDate ||
    changes.redirectStreak ||
    changes.schedule ||
    changes.behaviorLog;

  if (!relevant) {
    return;
  }

  await refreshActiveView();
});

for (const el of [siteInputEl, customUrlInputEl, lcInputEl]) {
  const caret =
    el.nextElementSibling instanceof HTMLElement &&
    el.nextElementSibling.classList.contains("fake-caret")
      ? el.nextElementSibling
      : null;
  if (caret) {
    attachFollowingCaret(el, caret);
  }
}

/** @type {number} */
let lcTooltipHideTimer = 0;

function cancelLcTooltipHide() {
  if (lcTooltipHideTimer) {
    window.clearTimeout(lcTooltipHideTimer);
    lcTooltipHideTimer = 0;
  }
}

function hideLcHelpTooltip() {
  cancelLcTooltipHide();
  if (lcHelpTooltipEl) {
    lcHelpTooltipEl.classList.add("panel-hidden");
    lcHelpTooltipEl.style.left = "";
    lcHelpTooltipEl.style.top = "";
    lcHelpTooltipEl.style.visibility = "";
  }
  lcHelpTipBtnEl?.setAttribute("aria-expanded", "false");
}

function layoutLcHelpTooltip() {
  if (!lcHelpTooltipEl || !lcHelpTipBtnEl) {
    return;
  }

  lcHelpTooltipEl.classList.remove("panel-hidden");

  lcHelpTooltipEl.style.visibility = "hidden";
  lcHelpTooltipEl.style.left = "0";
  lcHelpTooltipEl.style.top = "0";

  requestAnimationFrame(() => {
    const br = lcHelpTipBtnEl.getBoundingClientRect();
    const pr = lcHelpTooltipEl.getBoundingClientRect();

    const M = 10;
    const gap = 8;
    let top = br.bottom + gap;
    let left = br.left + br.width / 2 - pr.width / 2;
    left = Math.max(M, Math.min(left, window.innerWidth - pr.width - M));

    if (top + pr.height > window.innerHeight - M) {
      top = br.top - pr.height - gap;
    }
    top = Math.max(M, Math.min(top, window.innerHeight - pr.height - M));

    lcHelpTooltipEl.style.left = `${Math.round(left)}px`;
    lcHelpTooltipEl.style.top = `${Math.round(top)}px`;
    lcHelpTooltipEl.style.visibility = "";
  });

  lcHelpTipBtnEl.setAttribute("aria-expanded", "true");
}

function scheduleLcTooltipHide() {
  cancelLcTooltipHide();
  lcTooltipHideTimer = window.setTimeout(() => hideLcHelpTooltip(), 160);
}

function showLcHelpTooltip() {
  cancelLcTooltipHide();
  layoutLcHelpTooltip();
}

if (lcHelpTipWrapEl && lcHelpTooltipEl && lcHelpTipBtnEl) {
  lcHelpTipWrapEl.addEventListener("mouseenter", showLcHelpTooltip);
  lcHelpTipWrapEl.addEventListener("mouseleave", scheduleLcTooltipHide);

  lcHelpTooltipEl.addEventListener("mouseenter", cancelLcTooltipHide);
  lcHelpTooltipEl.addEventListener("mouseleave", scheduleLcTooltipHide);

  lcHelpTipBtnEl.addEventListener("focus", showLcHelpTooltip);
  lcHelpTipBtnEl.addEventListener("blur", scheduleLcTooltipHide);

  contentScrollerEl?.addEventListener(
    "scroll",
    () => {
      if (lcHelpTooltipEl && !lcHelpTooltipEl.classList.contains("panel-hidden")) {
        layoutLcHelpTooltip();
      }
    },
    { passive: true }
  );

  window.addEventListener("resize", () => {
    if (lcHelpTooltipEl && !lcHelpTooltipEl.classList.contains("panel-hidden")) {
      layoutLcHelpTooltip();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      lcHelpTooltipEl &&
      !lcHelpTooltipEl.classList.contains("panel-hidden")
    ) {
      hideLcHelpTooltip();
    }
  });
}

renderMain();
showView("main");
