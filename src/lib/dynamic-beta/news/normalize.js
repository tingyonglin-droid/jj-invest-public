import { createHash } from "node:crypto";

const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
]);

function digest(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function normalizedText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function fingerprintText(value) {
  return normalizedText(value).toLocaleLowerCase("en-US");
}

function normalizeOptionalTimestamp(value, fieldName) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} 必須是有效時間。`);
  }
  return parsed.toISOString();
}

export function canonicalizeNewsUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("新聞 URL 無效。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("新聞 URL 必須使用 http 或 https。");
  }

  url.hash = "";
  for (const parameter of [...url.searchParams.keys()]) {
    if (parameter.toLowerCase().startsWith("utm_") || TRACKING_PARAMETERS.has(parameter.toLowerCase())) {
      url.searchParams.delete(parameter);
    }
  }
  url.searchParams.sort();
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.toString().replace(/\/$/, "");
}

export function normalizeNewsEvidence(input, retrievedAt = new Date().toISOString()) {
  const originalUrl = String(input?.url || "").trim();
  const canonicalUrl = canonicalizeNewsUrl(originalUrl);
  const title = normalizedText(input?.title);
  const summary = normalizedText(input?.summary) || null;
  const sourceName = normalizedText(input?.sourceName);
  if (!title) throw new Error("新聞標題不可為空。 ");
  if (!sourceName) throw new Error("新聞來源名稱不可為空。");

  const normalizedRetrievedAt = normalizeOptionalTimestamp(retrievedAt, "retrievedAt");
  const publishedAt = normalizeOptionalTimestamp(input?.publishedAt, "publishedAt");
  const contentFingerprint = digest(
    JSON.stringify([fingerprintText(title), fingerprintText(summary)]),
  );
  const evidenceId = `ev_${digest(canonicalUrl)}`;
  const revisionId = `evr_${digest(JSON.stringify([
    evidenceId,
    contentFingerprint,
    publishedAt,
  ]))}`;

  return {
    evidenceId,
    revisionId,
    canonicalUrl,
    originalUrl,
    sourceName,
    sourceTier: normalizedText(input?.sourceTier) || "unknown",
    title,
    summary,
    publishedAt,
    retrievedAt: normalizedRetrievedAt,
    contentFingerprint,
  };
}
