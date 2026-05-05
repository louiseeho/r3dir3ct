import { problems } from "./problems.js";

const SRS_KEY = "srs";

const difficultyBySlug = new Map(problems.map((p) => [p.slug, p.difficulty]));

function emptySrs() {
  return {
    records: {},
    totalRedirects: 0,
    lastSlug: ""
  };
}

function getDifficulty(slug) {
  return difficultyBySlug.get(slug) || "Medium";
}

function pickWeightedDifficulty(totalRedirects) {
  let pEasy;
  let pMedium;
  if (totalRedirects <= 10) {
    pEasy = 0.7;
    pMedium = 0.25;
  } else if (totalRedirects <= 30) {
    pEasy = 0.4;
    pMedium = 0.45;
  } else {
    pEasy = 0.15;
    pMedium = 0.45;
  }
  const r = Math.random();
  if (r < pEasy) return "Easy";
  if (r < pEasy + pMedium) return "Medium";
  return "Hard";
}

function filterByDifficulty(slugs, difficulty) {
  return slugs.filter((slug) => getDifficulty(slug) === difficulty);
}

function pickRandomAvoiding(slugs, excludeSlug) {
  const pool = excludeSlug ? slugs.filter((s) => s !== excludeSlug) : slugs.slice();
  const source = pool.length > 0 ? pool : slugs;
  const slug = source[Math.floor(Math.random() * source.length)];
  return { slug, difficulty: getDifficulty(slug) };
}

/**
 * @param {string | undefined} ruleChainExclude When building multiple redirect rules,
 * exclude this slug from the *random* branch so adjacent rules differ. Omit to use SRS lastSlug.
 * @returns {Promise<{ slug: string, difficulty: string }>}
 */
export async function pickNextProblem(ruleChainExclude) {
  const raw = await chrome.storage.local.get(SRS_KEY);
  const srs = raw[SRS_KEY] && typeof raw[SRS_KEY] === "object" ? raw[SRS_KEY] : emptySrs();
  const records = srs.records && typeof srs.records === "object" ? srs.records : {};
  const lastSlug = typeof srs.lastSlug === "string" ? srs.lastSlug : "";
  const totalRedirects = typeof srs.totalRedirects === "number" ? srs.totalRedirects : 0;
  const now = Date.now();
  const randomExclude = ruleChainExclude !== undefined ? ruleChainExclude : lastSlug;

  const allSlugs = problems.map((p) => p.slug);
  const due = [];
  for (const slug of allSlugs) {
    const rec = records[slug];
    if (!rec || typeof rec.nextDue !== "number") continue;
    if (rec.nextDue <= now) {
      due.push({ slug, ef: typeof rec.ef === "number" ? rec.ef : 2.5 });
    }
  }

  if (due.length > 0) {
    let pool = due;
    if (randomExclude) {
      const filtered = due.filter((d) => d.slug !== randomExclude);
      pool = filtered.length > 0 ? filtered : due;
    }
    pool.sort((a, b) => a.ef - b.ef || a.slug.localeCompare(b.slug));
    const slug = pool[0].slug;
    return { slug, difficulty: getDifficulty(slug) };
  }

  const targetDiff = pickWeightedDifficulty(totalRedirects);
  let candidates = filterByDifficulty(allSlugs, targetDiff);
  if (candidates.length === 0) {
    candidates = allSlugs;
  }
  return pickRandomAvoiding(candidates, randomExclude || null);
}

/**
 * After a redirect is recorded: bump totals and ensure a stub record exists.
 */
export async function noteRedirectForSrs(slug) {
  const raw = await chrome.storage.local.get(SRS_KEY);
  const srs = raw[SRS_KEY] && typeof raw[SRS_KEY] === "object" ? { ...emptySrs(), ...raw[SRS_KEY] } : emptySrs();
  srs.records = srs.records && typeof srs.records === "object" ? { ...srs.records } : {};
  const now = Date.now();
  const prev = srs.records[slug];
  if (!prev) {
    srs.records[slug] = {
      slug,
      interval: 0,
      ef: 2.5,
      nextDue: null,
      seenCount: 0,
      solvedCount: 0,
      dodgedCount: 0,
      lastSeen: now
    };
  } else {
    srs.records[slug] = {
      ...prev,
      slug,
      lastSeen: now
    };
  }
  srs.totalRedirects = (typeof srs.totalRedirects === "number" ? srs.totalRedirects : 0) + 1;
  srs.lastSlug = slug;
  await chrome.storage.local.set({ srs });
}

/**
 * SM-2 update after GraphQL verify. quality null → no SRS change (unknown).
 * @param {string} slug
 * @param {number | null | undefined} quality 5=solved fast, 3=solved slow, 0=dodged
 */
export async function updateRecord(slug, quality) {
  if (quality === null || quality === undefined || Number.isNaN(quality)) {
    return;
  }

  const raw = await chrome.storage.local.get(SRS_KEY);
  const srs = raw[SRS_KEY] && typeof raw[SRS_KEY] === "object" ? { ...emptySrs(), ...raw[SRS_KEY] } : emptySrs();
  srs.records = srs.records && typeof srs.records === "object" ? { ...srs.records } : {};
  const now = Date.now();
  let rec = srs.records[slug];
  if (!rec) {
    rec = {
      slug,
      interval: 0,
      ef: 2.5,
      nextDue: null,
      seenCount: 0,
      solvedCount: 0,
      dodgedCount: 0,
      lastSeen: now
    };
  }

  let { interval, ef, seenCount, solvedCount, dodgedCount } = rec;
  ef = typeof ef === "number" ? ef : 2.5;
  interval = typeof interval === "number" ? interval : 0;
  seenCount = typeof seenCount === "number" ? seenCount : 0;
  solvedCount = typeof solvedCount === "number" ? solvedCount : 0;
  dodgedCount = typeof dodgedCount === "number" ? dodgedCount : 0;

  const prevInterval = interval;

  if (quality >= 3) {
    solvedCount += 1;
    seenCount += 1;

    if (seenCount === 1) {
      interval = 1;
    } else if (seenCount === 2) {
      interval = 6;
    } else {
      interval = Math.max(1, Math.round(prevInterval * ef));
    }
  } else {
    dodgedCount += 1;
    seenCount = 0;
    interval = 1;
  }

  ef = ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  ef = Math.max(ef, 1.3);

  rec = {
    ...rec,
    slug,
    interval,
    ef,
    seenCount,
    solvedCount,
    dodgedCount,
    nextDue: now + interval * 86400000,
    lastSeen: now
  };
  srs.records[slug] = rec;
  await chrome.storage.local.set({ srs });
}

export async function getSrsPayload() {
  const raw = await chrome.storage.local.get(SRS_KEY);
  return raw[SRS_KEY] && typeof raw[SRS_KEY] === "object" ? raw[SRS_KEY] : emptySrs();
}
