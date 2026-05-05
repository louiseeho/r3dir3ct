const BEHAVIOR_KEY = "behaviorLog";
const MS_PER_DAY = 86400000;
const KEEP_DAYS = 90;

/**
 * Append one redirect event (atomic read-modify-write). solved starts null until verify.
 * @param {{ timestamp?: number, site: string, slug: string }} entry
 */
export async function logRedirect(entry) {
  const timestamp = typeof entry.timestamp === "number" ? entry.timestamp : Date.now();
  const d = new Date(timestamp);
  const row = {
    timestamp,
    site: entry.site,
    hour: d.getHours(),
    dayOfWeek: d.getDay(),
    slug: entry.slug,
    solved: null
  };

  const raw = await chrome.storage.local.get(BEHAVIOR_KEY);
  /** @type {any[]} */
  let log = Array.isArray(raw[BEHAVIOR_KEY]) ? [...raw[BEHAVIOR_KEY]] : [];

  log.push(row);
  const cutoff = Date.now() - KEEP_DAYS * MS_PER_DAY;
  log = log.filter((ev) => ev && typeof ev.timestamp === "number" && ev.timestamp >= cutoff);

  await chrome.storage.local.set({ [BEHAVIOR_KEY]: log });
  return timestamp;
}

/**
 * @param {string} slug
 * @param {number} redirectedAt
 * @param {boolean|null} solved
 */
export async function updateSolveStatus(slug, redirectedAt, solved) {
  const raw = await chrome.storage.local.get(BEHAVIOR_KEY);
  /** @type {any[]} */
  const log = Array.isArray(raw[BEHAVIOR_KEY]) ? [...raw[BEHAVIOR_KEY]] : [];
  let hit = false;
  for (let i = log.length - 1; i >= 0; i--) {
    const ev = log[i];
    if (ev && ev.slug === slug && ev.timestamp === redirectedAt) {
      log[i] = { ...ev, solved };
      hit = true;
      break;
    }
  }
  if (hit) {
    await chrome.storage.local.set({ [BEHAVIOR_KEY]: log });
  }
}

/**
 * Last 30 days — counts per (dayOfWeek 0–6, hour 0–23).
 * @param {any[]|undefined} log
 * @returns {number[][]} 7×24
 */
export function getHeatmapData(log) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  if (!Array.isArray(log)) {
    return grid;
  }

  const cutoff = Date.now() - 30 * MS_PER_DAY;
  for (const ev of log) {
    if (!ev || typeof ev.timestamp !== "number" || ev.timestamp < cutoff) continue;
    if (typeof ev.dayOfWeek !== "number" || typeof ev.hour !== "number") continue;
    const dow = Math.max(0, Math.min(6, ev.dayOfWeek));
    const hr = Math.max(0, Math.min(23, ev.hour));
    grid[dow][hr] += 1;
  }

  return grid;
}
