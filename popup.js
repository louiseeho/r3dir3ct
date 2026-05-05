import { problems } from "./problems.js";

const SYNC_KEYS = {
  blacklist: "blacklist",
  enabled: "enabled"
};

const LOCAL_KEYS = {
  lastSlug: "lastRedirectSlug",
  lastDifficulty: "lastRedirectDifficulty",
  redirectsToday: "redirectsToday",
  redirectsDate: "redirectsDate",
  streak: "redirectStreak"
};

const blockedCountEl = document.getElementById("blocked-count");
const redirectsTodayEl = document.getElementById("redirects-today");
const lastSlugEl = document.getElementById("last-slug");
const lastDifficultyEl = document.getElementById("last-difficulty");
const streakDaysEl = document.getElementById("streak-days");
const sitesListEl = document.getElementById("sites-list");
const siteInputEl = document.getElementById("site-input");
const toggleStateEl = document.getElementById("toggle-state");
const randomLinkEl = document.getElementById("random-link");

function getTodayISO() {
  return new Date().toISOString().split("T")[0];
}

function normalizeDomain(input) {
  return input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function randomProblem(excludedSlug = null) {
  const pool = problems.filter((problem) => problem.slug !== excludedSlug);
  const source = pool.length > 0 ? pool : problems;
  return source[Math.floor(Math.random() * source.length)];
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

async function fetchState() {
  const [syncData, localData] = await Promise.all([
    chrome.storage.sync.get([SYNC_KEYS.blacklist, SYNC_KEYS.enabled]),
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
      await render();
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

async function render() {
  const state = await fetchState();

  blockedCountEl.textContent = String(state.blacklist.length);
  redirectsTodayEl.textContent = String(state.redirectsToday);
  lastSlugEl.textContent = state.lastSlug;
  streakDaysEl.textContent = `${state.streak}d`;

  renderDifficulty(state.lastDifficulty);
  renderSites(state.blacklist);
  renderToggle(state.enabled);
}

toggleStateEl.addEventListener("click", async () => {
  const data = await chrome.storage.sync.get([SYNC_KEYS.enabled]);
  const next = data.enabled === false;
  await chrome.storage.sync.set({ enabled: next });
  await render();
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

  await render();
});

randomLinkEl.addEventListener("click", async () => {
  const localData = await chrome.storage.local.get([LOCAL_KEYS.lastSlug]);
  const selected = randomProblem(localData.lastRedirectSlug || null);
  await chrome.tabs.create({ url: `https://leetcode.com/problems/${selected.slug}/` });
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== "sync" && areaName !== "local") {
    return;
  }
  if (
    changes.blacklist ||
    changes.enabled ||
    changes.lastRedirectSlug ||
    changes.lastRedirectDifficulty ||
    changes.redirectsToday ||
    changes.redirectsDate ||
    changes.redirectStreak
  ) {
    await render();
  }
});

render();
