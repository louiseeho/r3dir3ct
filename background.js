import { problems } from "./problems.js";

const DEFAULT_BLACKLIST = [
  "reddit.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "facebook.com",
  "youtube.com",
  "tiktok.com"
];

const STORAGE_SYNC_KEYS = {
  blacklist: "blacklist",
  enabled: "enabled"
};

const STORAGE_LOCAL_KEYS = {
  lastSlug: "lastRedirectSlug",
  lastDifficulty: "lastRedirectDifficulty",
  todayCount: "redirectsToday",
  todayDate: "redirectsDate",
  streak: "redirectStreak",
  lastRedirectDay: "lastRedirectDay"
};

const tabRedirectGuard = new Map();

function getTodayISO() {
  return new Date().toISOString().split("T")[0];
}

function normalizeDomain(value) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function getRandomProblem(excludedSlug = null) {
  const pool = problems.filter((problem) => problem.slug !== excludedSlug);
  const source = pool.length > 0 ? pool : problems;
  return source[Math.floor(Math.random() * source.length)];
}

async function getSettings() {
  const syncData = await chrome.storage.sync.get([
    STORAGE_SYNC_KEYS.blacklist,
    STORAGE_SYNC_KEYS.enabled
  ]);

  return {
    blacklist: Array.isArray(syncData.blacklist) ? syncData.blacklist : DEFAULT_BLACKLIST,
    enabled: syncData.enabled !== false
  };
}

async function updateRules() {
  const { blacklist, enabled } = await getSettings();
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existingRules.map((rule) => rule.id);

  if (!enabled || blacklist.length === 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds });
    return;
  }

  const localData = await chrome.storage.local.get([STORAGE_LOCAL_KEYS.lastSlug]);
  let previousSlug = localData.lastRedirectSlug || null;

  const addRules = blacklist.map((domain, index) => {
    const selected = getRandomProblem(previousSlug);
    previousSlug = selected.slug;

    return {
      id: index + 1,
      priority: 1,
      action: {
        type: "redirect",
        redirect: {
          url: `https://leetcode.com/problems/${selected.slug}/`
        }
      },
      condition: {
        urlFilter: `*${domain}*`,
        resourceTypes: ["main_frame"]
      }
    };
  });

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules
  });
}

async function initializeDefaults() {
  const syncData = await chrome.storage.sync.get([
    STORAGE_SYNC_KEYS.blacklist,
    STORAGE_SYNC_KEYS.enabled
  ]);

  const syncPatch = {};
  if (!Array.isArray(syncData.blacklist) || syncData.blacklist.length === 0) {
    syncPatch.blacklist = DEFAULT_BLACKLIST;
  }
  if (typeof syncData.enabled !== "boolean") {
    syncPatch.enabled = true;
  }
  if (Object.keys(syncPatch).length > 0) {
    await chrome.storage.sync.set(syncPatch);
  }

  const localData = await chrome.storage.local.get([
    STORAGE_LOCAL_KEYS.todayCount,
    STORAGE_LOCAL_KEYS.todayDate,
    STORAGE_LOCAL_KEYS.streak
  ]);
  const today = getTodayISO();
  const localPatch = {};
  if (typeof localData.redirectsToday !== "number") {
    localPatch.redirectsToday = 0;
  }
  if (localData.redirectsDate !== today) {
    localPatch.redirectsDate = today;
    localPatch.redirectsToday = 0;
  }
  if (typeof localData.redirectStreak !== "number") {
    localPatch.redirectStreak = 0;
  }
  if (Object.keys(localPatch).length > 0) {
    await chrome.storage.local.set(localPatch);
  }
}

async function trackRedirectAttempt(url) {
  const { blacklist, enabled } = await getSettings();
  if (!enabled) {
    return;
  }

  const isBlocked = blacklist.some((domain) => url.includes(domain));
  if (!isBlocked) {
    return;
  }

  const localData = await chrome.storage.local.get([
    STORAGE_LOCAL_KEYS.lastSlug,
    STORAGE_LOCAL_KEYS.todayCount,
    STORAGE_LOCAL_KEYS.todayDate,
    STORAGE_LOCAL_KEYS.streak,
    STORAGE_LOCAL_KEYS.lastRedirectDay
  ]);

  const selected = getRandomProblem(localData.lastRedirectSlug || null);
  const today = getTodayISO();
  const previousDate = localData.redirectsDate;
  const todayCount = previousDate === today ? (localData.redirectsToday || 0) + 1 : 1;

  let streak = localData.redirectStreak || 0;
  const lastRedirectDay = localData.lastRedirectDay;

  if (lastRedirectDay !== today) {
    if (!lastRedirectDay) {
      streak = 1;
    } else {
      const lastDate = new Date(lastRedirectDay);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      streak = lastDate.toISOString().split("T")[0] === yesterday.toISOString().split("T")[0] ? streak + 1 : 1;
    }
  }

  await chrome.storage.local.set({
    redirectsToday: todayCount,
    redirectsDate: today,
    lastRedirectSlug: selected.slug,
    lastRedirectDifficulty: selected.difficulty,
    redirectStreak: streak,
    lastRedirectDay: today
  });

  await updateRules();
}

chrome.runtime.onInstalled.addListener(async () => {
  await initializeDefaults();
  await updateRules();
});

chrome.runtime.onStartup.addListener(async () => {
  await initializeDefaults();
  await updateRules();
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== "sync") {
    return;
  }
  if (changes.blacklist || changes.enabled) {
    await updateRules();
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  const candidateUrl = changeInfo.url || "";
  if (!candidateUrl || candidateUrl.startsWith("https://leetcode.com/problems/")) {
    return;
  }

  const now = Date.now();
  const lastSeen = tabRedirectGuard.get(tabId) || 0;
  if (now - lastSeen < 800) {
    return;
  }
  tabRedirectGuard.set(tabId, now);

  await trackRedirectAttempt(candidateUrl);
});
