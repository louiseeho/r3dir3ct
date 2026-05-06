const LEETCODE_ALL_PROBLEMS_URL = "https://leetcode.com/api/problems/all/";
const SOLVED_SLUGS_KEY = "lcSolvedSlugs";
const SOLVED_SYNC_META_KEY = "lcSolvedSyncMeta";

/**
 * Sync the full solved problem set from LeetCode for the current browser session.
 * Requires the user to be logged in on leetcode.com in this browser profile.
 *
 * @param {string} username
 * @returns {Promise<{ ok: boolean, count: number, reason?: string }>}
 */
export async function syncSolvedSetFromLeetCode(username) {
  const uname = String(username ?? "").trim();
  if (!uname) {
    return { ok: false, count: 0, reason: "missing_username" };
  }

  try {
    const res = await fetch(LEETCODE_ALL_PROBLEMS_URL, {
      method: "GET",
      credentials: "include",
      cache: "no-store"
    });

    if (!res.ok) {
      await chrome.storage.local.set({
        [SOLVED_SYNC_META_KEY]: {
          ok: false,
          reason: `http_${res.status}`,
          syncedAt: Date.now(),
          username: uname,
          count: 0
        }
      });
      return { ok: false, count: 0, reason: `http_${res.status}` };
    }

    const json = await res.json();
    const pairs = Array.isArray(json?.stat_status_pairs) ? json.stat_status_pairs : [];

    const solvedSet = new Set();
    for (const row of pairs) {
      if (!row || typeof row !== "object") continue;
      const status = String(row.status ?? "").toLowerCase();
      if (status !== "ac") continue;
      const slug = row?.stat?.question__title_slug;
      if (typeof slug === "string" && slug) {
        solvedSet.add(slug);
      }
    }

    const solvedSlugs = Array.from(solvedSet);
    await chrome.storage.local.set({
      [SOLVED_SLUGS_KEY]: solvedSlugs,
      [SOLVED_SYNC_META_KEY]: {
        ok: true,
        reason: "ok",
        syncedAt: Date.now(),
        username: uname,
        count: solvedSlugs.length
      }
    });
    return { ok: true, count: solvedSlugs.length };
  } catch {
    await chrome.storage.local.set({
      [SOLVED_SYNC_META_KEY]: {
        ok: false,
        reason: "network_error",
        syncedAt: Date.now(),
        username: uname,
        count: 0
      }
    });
    return { ok: false, count: 0, reason: "network_error" };
  }
}

/**
 * Keep local solved set fresh after a verified accepted submission.
 * @param {string} slug
 */
export async function markSolvedSlug(slug) {
  const s = String(slug ?? "").trim();
  if (!s) {
    return;
  }
  const raw = await chrome.storage.local.get([SOLVED_SLUGS_KEY]);
  const prev = Array.isArray(raw[SOLVED_SLUGS_KEY]) ? raw[SOLVED_SLUGS_KEY] : [];
  if (prev.includes(s)) {
    return;
  }
  await chrome.storage.local.set({ [SOLVED_SLUGS_KEY]: [...prev, s] });
}
