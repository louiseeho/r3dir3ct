import { pickNextProblem, noteRedirectForSchedule, updateRecord, ensureScheduleBlobSeeded } from "./schedule.js";
import { checkSolved } from "./graphql.js";
import { logRedirect, updateSolveStatus } from "./behavior.js";
import {
  parseRedirectSettingsFromSync,
  isAlreadyOnRedirectDestination,
  REDIRECT_MODE_CUSTOM,
  STORAGE_REDIRECT_MODE,
  STORAGE_CUSTOM_REDIRECT_URL
} from "./redirect-settings.js";
import { messages as shameMessages } from "./messages.js";

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
  enabled: "enabled",
  redirectMode: STORAGE_REDIRECT_MODE,
  customRedirectUrl: STORAGE_CUSTOM_REDIRECT_URL,
  shameLevel: "shameLevel"
};

const STORAGE_LOCAL_KEYS = {
  lastSlug: "lastRedirectSlug",
  lastDifficulty: "lastRedirectDifficulty",
  todayCount: "redirectsToday",
  todayDate: "redirectsDate",
  streak: "redirectStreak",
  lastRedirectDay: "lastRedirectDay",
  pendingChecks: "pendingChecks",
  dodgesToday: "dodgesToday",
  streakDays: "streakDays",
  shameOverlay: "shameOverlay"
};

const tabRedirectGuard = new Map();

function normalizeShameLevel(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return 2;
  }
  return Math.min(5, Math.max(1, Math.round(n)));
}

function applyShamePlaceholders(text, dodge, streak) {
  return String(text)
    .replace(/DODGE_COUNT/g, String(dodge))
    .replace(/STREAK/g, String(streak));
}

function pickRandomShameQuotedMessage(level, dodge, streak) {
  const lv = normalizeShameLevel(level);
  const bank = shameMessages[lv] || shameMessages[2];
  const raw = bank[Math.floor(Math.random() * bank.length)];
  return `"${applyShamePlaceholders(raw, dodge, streak)}"`;
}

function leetcodeProblemUrl(slug) {
  return `https://leetcode.com/problems/${slug}/`;
}

function getTodayISO() {
  return new Date().toISOString().split("T")[0];
}

function extractSiteHostname(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function canonicalizeDomain(input) {
  const raw = String(input ?? "").trim().toLowerCase();
  if (!raw) {
    return "";
  }

  // Accept entries like "https://www.example.com/path" and reduce to hostname.
  const noScheme = raw.replace(/^[a-z]+:\/\//i, "");
  const hostOnly = noScheme.replace(/^www\./i, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "");
  return hostOnly.replace(/^\.+|\.+$/g, "");
}

/**
 * True if `host` equals `blocked` or is a subdomain of it (e.g. ca.shein.com / m.shein.com for shein.com).
 * Domains should be hostnames only (no scheme/path), lowercased.
 */
function hostnameMatchesBlockedEntry(host, blocked) {
  const h = host.toLowerCase();
  const b = canonicalizeDomain(blocked);
  if (!b) {
    return false;
  }
  return h === b || h.endsWith(`.${b}`);
}

async function getSettings() {
  const syncData = await chrome.storage.sync.get([
    STORAGE_SYNC_KEYS.blacklist,
    STORAGE_SYNC_KEYS.enabled,
    STORAGE_SYNC_KEYS.redirectMode,
    STORAGE_SYNC_KEYS.customRedirectUrl
  ]);

  const { redirectMode, customRedirectUrl } = parseRedirectSettingsFromSync(syncData);

  return {
    blacklist: Array.isArray(syncData.blacklist) ? syncData.blacklist : DEFAULT_BLACKLIST,
    enabled: syncData.enabled !== false,
    redirectMode,
    customRedirectUrl
  };
}

async function updateRules() {
  const {
    blacklist,
    enabled,
    redirectMode,
    customRedirectUrl
  } = await getSettings();

  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existingRules.map((rule) => rule.id);

  const customOk =
    redirectMode === REDIRECT_MODE_CUSTOM &&
    typeof customRedirectUrl === "string" &&
    customRedirectUrl.length > 0;

  if (!enabled || blacklist.length === 0 || (redirectMode === REDIRECT_MODE_CUSTOM && !customOk)) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds });
    return;
  }

  const addRules = [];
  let ruleId = 0;

  if (redirectMode === REDIRECT_MODE_CUSTOM) {
    for (let index = 0; index < blacklist.length; index++) {
      const domain = canonicalizeDomain(blacklist[index]);
      if (!domain) {
        continue;
      }

      ruleId += 1;
      addRules.push({
        id: ruleId,
        priority: 1,
        action: {
          type: "redirect",
          redirect: {
            url: customRedirectUrl
          }
        },
        condition: {
          requestDomains: [domain],
          resourceTypes: ["main_frame"]
        }
      });
    }
  } else {
    const localData = await chrome.storage.local.get([STORAGE_LOCAL_KEYS.lastSlug]);
    let chainExclude = localData.lastRedirectSlug || undefined;

    for (let index = 0; index < blacklist.length; index++) {
      const domain = canonicalizeDomain(blacklist[index]);
      if (!domain) {
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const selected = await pickNextProblem(chainExclude);
      chainExclude = selected.slug;

      ruleId += 1;
      addRules.push({
        id: ruleId,
        priority: 1,
        action: {
          type: "redirect",
          redirect: {
            url: leetcodeProblemUrl(selected.slug)
          }
        },
        condition: {
          requestDomains: [domain],
          resourceTypes: ["main_frame"]
        }
      });
    }
  }

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      addRules
    });
  } catch (err) {
    console.error("r3dir3ct: updateDynamicRules failed", err);
  }
}

async function initializeDefaults() {
  const syncData = await chrome.storage.sync.get([
    STORAGE_SYNC_KEYS.blacklist,
    STORAGE_SYNC_KEYS.enabled,
    STORAGE_SYNC_KEYS.shameLevel
  ]);

  const syncPatch = {};
  if (!Array.isArray(syncData.blacklist) || syncData.blacklist.length === 0) {
    syncPatch.blacklist = DEFAULT_BLACKLIST;
  }
  if (typeof syncData.enabled !== "boolean") {
    syncPatch.enabled = true;
  }
  const sl = syncData.shameLevel;
  if (typeof sl !== "number" || sl < 1 || sl > 5) {
    syncPatch.shameLevel = 2;
  }
  if (Object.keys(syncPatch).length > 0) {
    await chrome.storage.sync.set(syncPatch);
  }

  const localData = await chrome.storage.local.get([
    STORAGE_LOCAL_KEYS.todayCount,
    STORAGE_LOCAL_KEYS.todayDate,
    STORAGE_LOCAL_KEYS.streak,
    STORAGE_LOCAL_KEYS.dodgesToday,
    STORAGE_LOCAL_KEYS.streakDays
  ]);
  const today = getTodayISO();
  const localPatch = {};
  if (typeof localData.redirectsToday !== "number") {
    localPatch.redirectsToday = 0;
  }
  if (localData.redirectsDate !== today) {
    localPatch.redirectsDate = today;
    localPatch.redirectsToday = 0;
    localPatch.dodgesToday = 0;
  }
  if (typeof localData.redirectStreak !== "number") {
    localPatch.redirectStreak = 0;
  }
  if (typeof localData.dodgesToday !== "number" && localPatch.dodgesToday === undefined) {
    const seed =
      typeof localData.redirectsToday === "number" ? localData.redirectsToday : (localPatch.redirectsToday ?? 0);
    localPatch.dodgesToday = seed;
  }
  if (typeof localData.streakDays !== "number" && localPatch.streakDays === undefined) {
    const seedStreak =
      typeof localData.redirectStreak === "number" ? localData.redirectStreak : (localPatch.redirectStreak ?? 0);
    localPatch.streakDays = seedStreak;
  }
  await ensureScheduleBlobSeeded();
  if (Object.keys(localPatch).length > 0) {
    await chrome.storage.local.set(localPatch);
  }
}

async function redirectTabIfStillOnBlockedSite(tabId, blacklist, redirectSettings, destinationUrl) {
  await new Promise((r) => setTimeout(r, 75));

  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return;
  }

  const current = tab.url || "";
  if (!current.startsWith("http")) {
    return;
  }

  let host;
  try {
    host = new URL(current).hostname.toLowerCase();
  } catch {
    return;
  }

  if (isAlreadyOnRedirectDestination(current, redirectSettings)) {
    return;
  }

  const stillBlocked = blacklist.some((blocked) => hostnameMatchesBlockedEntry(host, blocked));
  if (!stillBlocked) {
    return;
  }

  try {
    await chrome.tabs.update(tabId, { url: destinationUrl });
  } catch {
    // Ignore (e.g. missing permission for privileged tabs).
  }
}

async function trackRedirectAttempt(tabId, url) {
  const redirectSettings = await getSettings();
  const { blacklist, enabled, redirectMode, customRedirectUrl } = redirectSettings;

  if (!enabled) {
    return;
  }

  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return;
  }

  const isBlocked = blacklist.some((blocked) => hostnameMatchesBlockedEntry(hostname, blocked));
  if (!isBlocked) {
    return;
  }

  if (redirectMode === REDIRECT_MODE_CUSTOM) {
    if (!customRedirectUrl) {
      return;
    }

    const localLite = await chrome.storage.local.get([
      STORAGE_LOCAL_KEYS.todayCount,
      STORAGE_LOCAL_KEYS.todayDate,
      STORAGE_LOCAL_KEYS.streak,
      STORAGE_LOCAL_KEYS.lastRedirectDay
    ]);

    const redirectedAt = Date.now();
    const today = getTodayISO();
    const previousDate = localLite.redirectsDate;
    const todayCount = previousDate === today ? (localLite.redirectsToday || 0) + 1 : 1;

    let streak = localLite.redirectStreak || 0;
    const lastRedirectDay = localLite.lastRedirectDay;

    if (lastRedirectDay !== today) {
      if (!lastRedirectDay) {
        streak = 1;
      } else {
        const lastDate = new Date(lastRedirectDay);
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        streak =
          lastDate.toISOString().split("T")[0] === yesterday.toISOString().split("T")[0] ? streak + 1 : 1;
      }
    }

    const site = extractSiteHostname(url);

    await chrome.storage.local.set({
      redirectsToday: todayCount,
      redirectsDate: today,
      dodgesToday: todayCount,
      streakDays: streak,
      lastRedirectSlug: "__custom__",
      lastRedirectDifficulty: "n/a",
      redirectStreak: streak,
      lastRedirectDay: today
    });

    await redirectTabIfStillOnBlockedSite(tabId, blacklist, redirectSettings, customRedirectUrl);

    await logRedirect({ timestamp: redirectedAt, site, slug: "__custom__" });
    await updateRules();
    return;
  }

  const shameSync = await chrome.storage.sync.get([STORAGE_SYNC_KEYS.shameLevel]);
  const shameLevel = normalizeShameLevel(shameSync.shameLevel);

  const localData = await chrome.storage.local.get([
    STORAGE_LOCAL_KEYS.lastSlug,
    STORAGE_LOCAL_KEYS.todayCount,
    STORAGE_LOCAL_KEYS.todayDate,
    STORAGE_LOCAL_KEYS.streak,
    STORAGE_LOCAL_KEYS.lastRedirectDay,
    STORAGE_LOCAL_KEYS.pendingChecks
  ]);

  const selected = await pickNextProblem();
  const destinationUrl = leetcodeProblemUrl(selected.slug);

  const redirectedAt = Date.now();
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

  const site = extractSiteHostname(url);
  const shameText = pickRandomShameQuotedMessage(shameLevel, todayCount, streak);

  await chrome.storage.local.set({
    redirectsToday: todayCount,
    redirectsDate: today,
    dodgesToday: todayCount,
    streakDays: streak,
    lastRedirectSlug: selected.slug,
    lastRedirectDifficulty: selected.difficulty,
    redirectStreak: streak,
    lastRedirectDay: today,
    [STORAGE_LOCAL_KEYS.shameOverlay]: {
      slug: selected.slug,
      text: shameText,
      ts: redirectedAt
    }
  });

  await logRedirect({ timestamp: redirectedAt, site, slug: selected.slug });
  await noteRedirectForSchedule(selected.slug);

  const alarmName = `checkSolve__${selected.slug}__${redirectedAt}`;
  const pendingMap =
    localData.pendingChecks && typeof localData.pendingChecks === "object"
      ? { ...localData.pendingChecks }
      : {};
  pendingMap[alarmName] = { slug: selected.slug, redirectedAt };
  await chrome.storage.local.set({ pendingChecks: pendingMap });

  await chrome.alarms.create(alarmName, { delayInMinutes: 15 });

  await redirectTabIfStillOnBlockedSite(tabId, blacklist, redirectSettings, destinationUrl);

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
  if (
    changes.blacklist ||
    changes.enabled ||
    changes.redirectMode ||
    changes.customRedirectUrl ||
    changes.shameLevel
  ) {
    await updateRules();
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith("checkSolve__")) {
    return;
  }

  const localRaw = await chrome.storage.local.get([STORAGE_LOCAL_KEYS.pendingChecks]);
  const pendingMap =
    localRaw.pendingChecks && typeof localRaw.pendingChecks === "object"
      ? { ...localRaw.pendingChecks }
      : {};
  const payload = pendingMap[alarm.name];
  delete pendingMap[alarm.name];
  await chrome.storage.local.set({ pendingChecks: pendingMap });

  if (
    !payload ||
    typeof payload.slug !== "string" ||
    payload.slug === "__custom__" ||
    typeof payload.redirectedAt !== "number"
  ) {
    return;
  }

  const syncUser = await chrome.storage.sync.get(["lcUsername"]);
  const username = typeof syncUser.lcUsername === "string" ? syncUser.lcUsername.trim() : "";
  if (!username) {
    return;
  }

  const outcome = await checkSolved(username, payload.slug, payload.redirectedAt);
  if (outcome === null) {
    return;
  }

  await updateSolveStatus(payload.slug, payload.redirectedAt, outcome.solved);
  await updateRecord(payload.slug, outcome.quality);
});

chrome.action.onClicked.addListener(async () => {
  const pageUrl = chrome.runtime.getURL("popup.html");
  const existing = await chrome.tabs.query({ url: pageUrl });
  if (existing.length > 0) {
    const tab = existing[0];
    if (typeof tab.id === "number" && typeof tab.windowId === "number") {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url: pageUrl });
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  // Often `changeInfo.url` is missing; `tabs.get` has the navigated URL reliably.
  if (
    changeInfo.url === undefined &&
    changeInfo.status !== "loading" &&
    changeInfo.status !== "complete"
  ) {
    return;
  }

  let candidateUrl = changeInfo.url || "";
  if (!candidateUrl && (changeInfo.status === "loading" || changeInfo.status === "complete")) {
    try {
      const tab = await chrome.tabs.get(tabId);
      candidateUrl = tab.url || "";
    } catch {
      return;
    }
  }

  const settings = await getSettings();
  if (!candidateUrl || isAlreadyOnRedirectDestination(candidateUrl, settings)) {
    return;
  }

  const now = Date.now();
  const lastSeen = tabRedirectGuard.get(tabId) || 0;
  if (now - lastSeen < 800) {
    return;
  }
  tabRedirectGuard.set(tabId, now);

  await trackRedirectAttempt(tabId, candidateUrl);
});
