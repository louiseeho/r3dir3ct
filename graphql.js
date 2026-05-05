const GRAPHQL_URL = "https://leetcode.com/graphql";

/**
 * @returns {null | { solved: boolean, quality: number }} quality 5=fast, 3=slow, 0=dodged; null=unknown
 */
export async function checkSolved(username, slug, redirectedAt) {
  if (!username || !slug || typeof redirectedAt !== "number") {
    return null;
  }

  const query = `
    query recentAcSubmissions($username: String!, $limit: Int!) {
      recentAcSubmissionList(username: $username, limit: $limit) {
        titleSlug
        timestamp
      }
    }
  `;

  try {
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query,
        variables: { username: String(username).trim(), limit: 10 },
        operationName: "recentAcSubmissions"
      })
    });

    if (!res.ok) {
      return null;
    }

    const json = await res.json();
    if (!json || json.errors?.length || !json.data?.recentAcSubmissionList) {
      return null;
    }

    const list = json.data.recentAcSubmissionList;
    if (!Array.isArray(list)) {
      return null;
    }

    let bestMs = null;
    for (const item of list) {
      if (!item || item.titleSlug !== slug) continue;
      let ts = typeof item.timestamp === "number" ? item.timestamp : parseInt(String(item.timestamp), 10);
      if (!Number.isFinite(ts)) continue;
      const ms = ts < 1e12 ? ts * 1000 : ts;
      if (ms <= redirectedAt) continue;
      if (bestMs === null || ms < bestMs) {
        bestMs = ms;
      }
    }

    if (bestMs === null) {
      return { solved: false, quality: 0 };
    }

    const elapsedMs = bestMs - redirectedAt;
    const fast = elapsedMs < 5 * 60 * 1000;
    return { solved: true, quality: fast ? 5 : 3 };
  } catch {
    return null;
  }
}
