export const STORAGE_REDIRECT_MODE = "redirectMode";
export const STORAGE_CUSTOM_REDIRECT_URL = "customRedirectUrl";
export const STORAGE_SITE_LIST_MODE = "siteListMode";
export const STORAGE_BLOCKED_DOMAINS = "blockedDomains";
export const STORAGE_ALLOWED_DOMAINS = "allowedDomains";

export const REDIRECT_MODE_LEETCODE = "leetcode";
export const REDIRECT_MODE_CUSTOM = "custom";
export const SITE_LIST_MODE_BLACKLIST = "blacklist";
export const SITE_LIST_MODE_WHITELIST = "whitelist";

const LEETCODE_PROBLEM_PREFIX = "https://leetcode.com/problems/";

/**
 * @param {unknown} raw
 * @returns {string | null} normalized https URL href or null
 */
export function normalizeHttpsUrl(raw) {
  const s = String(raw ?? "").trim();
  if (!s) {
    return null;
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;

  try {
    const u = new URL(withScheme);
    if (u.protocol !== "https:") {
      return null;
    }
    if (!u.hostname) {
      return null;
    }
    return u.href;
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, unknown>} syncData chrome.storage.sync slice
 */
export function parseRedirectSettingsFromSync(syncData) {
  const mode =
    syncData.redirectMode === REDIRECT_MODE_CUSTOM ? REDIRECT_MODE_CUSTOM : REDIRECT_MODE_LEETCODE;
  const siteListMode =
    syncData.siteListMode === SITE_LIST_MODE_WHITELIST
      ? SITE_LIST_MODE_WHITELIST
      : SITE_LIST_MODE_BLACKLIST;
  const blockedDomains = Array.isArray(syncData[STORAGE_BLOCKED_DOMAINS])
    ? syncData[STORAGE_BLOCKED_DOMAINS]
    : Array.isArray(syncData.blacklist)
      ? syncData.blacklist
      : [];
  const allowedDomains = Array.isArray(syncData[STORAGE_ALLOWED_DOMAINS]) ? syncData[STORAGE_ALLOWED_DOMAINS] : [];
  const rawCustom = typeof syncData.customRedirectUrl === "string" ? syncData.customRedirectUrl : "";
  const customRedirectUrl =
    mode === REDIRECT_MODE_CUSTOM ? normalizeHttpsUrl(rawCustom) || "" : "";
  return { redirectMode: mode, customRedirectUrl, siteListMode, blockedDomains, allowedDomains };
}

/**
 * User is already on the post-redirect destination; do not intercept again.
 * @param {string} currentUrl
 * @param {{ redirectMode: string, customRedirectUrl: string }} settings
 */
export function isAlreadyOnRedirectDestination(currentUrl, settings) {
  if (!currentUrl.startsWith("http")) {
    return true;
  }

  if (settings.redirectMode === REDIRECT_MODE_LEETCODE) {
    return currentUrl.startsWith(LEETCODE_PROBLEM_PREFIX);
  }

  const target = settings.customRedirectUrl;
  if (!target) {
    return false;
  }

  try {
    const cur = new URL(currentUrl);
    const tgt = new URL(target);
    if (cur.origin !== tgt.origin) {
      return false;
    }

    const p = tgt.pathname;
    if (cur.pathname === p) {
      return true;
    }
    const prefix = p.endsWith("/") ? p : `${p}/`;
    return cur.pathname.startsWith(prefix);
  } catch {
    return false;
  }
}

export function describeCustomTargetShort(urlString) {
  const n = normalizeHttpsUrl(urlString);
  if (!n) {
    return "—";
  }
  try {
    const u = new URL(n);
    const tail = `${u.pathname}${u.search}` || "/";
    const host = u.hostname.replace(/^www\./i, "");
    const full = `${host}${tail}`;
    return full.length > 56 ? `${full.slice(0, 53)}…` : full;
  } catch {
    return "—";
  }
}
