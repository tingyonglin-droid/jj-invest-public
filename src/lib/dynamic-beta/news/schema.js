import { canonicalizeNewsUrl, normalizeNewsEvidence } from "./normalize.js";
import { NEWS_TOPIC_IDS, suggestNewsTopics } from "./topics.js";
import { getDynamicBetaSeries } from "../catalog.js";

export const NEWS_ANALYST_LABELS = Object.freeze([
  "risk_on",
  "risk_elevated",
  "high_alert",
  "systemic_risk",
]);

export const NEWS_SOURCE_TIERS = Object.freeze([
  "primary",
  "reputable_media",
  "secondary",
  "unknown",
]);

const CONFIRMATION_DIRECTIONS = Object.freeze(["up", "down"]);
const CONFIRMATION_CHANGE_TYPES = Object.freeze([
  "percent",
  "absolute",
  "basis_points",
]);

function cleanText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function cleanTextArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanText).filter(Boolean))];
}

function validDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeTimestamp(value, name, errors) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) {
    errors.push(`${name} 必須是有效時間。`);
    return null;
  }
  return parsed.toISOString();
}

function nullableNumber(value, path, errors) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${path} 必須是數字或 null。`);
    return null;
  }
  return value;
}

function normalizeTechEarnings(value, path, errors) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path} 必須是物件或 null。`);
    return null;
  }
  const comparison = value.capexGrowingFasterThanFcf;
  if (comparison !== null && comparison !== undefined && typeof comparison !== "boolean") {
    errors.push(`${path}.capexGrowingFasterThanFcf 必須是 boolean 或 null。`);
  }
  return {
    company: cleanText(value.company) || null,
    revenueGrowthPct: nullableNumber(value.revenueGrowthPct, `${path}.revenueGrowthPct`, errors),
    aiCloudGrowthPct: nullableNumber(value.aiCloudGrowthPct, `${path}.aiCloudGrowthPct`, errors),
    capexGrowthPct: nullableNumber(value.capexGrowthPct, `${path}.capexGrowthPct`, errors),
    freeCashFlowGrowthPct: nullableNumber(value.freeCashFlowGrowthPct, `${path}.freeCashFlowGrowthPct`, errors),
    capexGrowingFasterThanFcf:
      comparison === true || comparison === false ? comparison : null,
  };
}

function normalizeConfirmationRules(value, path, dataToConfirm, errors) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`${path} 必須是陣列。`);
    return [];
  }
  const seen = new Set();
  return value.map((rule, index) => {
    const rulePath = `${path}[${index}]`;
    const seriesId = cleanText(rule?.seriesId);
    const expectedDirection = cleanText(rule?.expectedDirection);
    const changeType = cleanText(rule?.changeType);
    const threshold = rule?.threshold;
    if (!getDynamicBetaSeries(seriesId)) errors.push(`${rulePath}.seriesId 未知：${seriesId}。`);
    if (seen.has(seriesId)) errors.push(`${path}.seriesId 不可重複：${seriesId}。`);
    seen.add(seriesId);
    if (!dataToConfirm.includes(seriesId)) {
      errors.push(`${rulePath}.seriesId 必須同時存在於 dataToConfirm。`);
    }
    if (!CONFIRMATION_DIRECTIONS.includes(expectedDirection)) {
      errors.push(`${rulePath}.expectedDirection 必須是 up 或 down。`);
    }
    if (!CONFIRMATION_CHANGE_TYPES.includes(changeType)) {
      errors.push(`${rulePath}.changeType 必須是 percent、absolute 或 basis_points。`);
    }
    if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold <= 0) {
      errors.push(`${rulePath}.threshold 必須是大於 0 的有限數字。`);
    }
    return { seriesId, expectedDirection, changeType, threshold };
  });
}

export function validateMorningBriefPayload(input, { now = new Date().toISOString() } = {}) {
  const errors = [];
  const warnings = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, errors: ["payload 必須是 JSON 物件。"], warnings, value: null };
  }

  if (!validDateKey(input.briefDate)) {
    errors.push("briefDate 必須使用有效的 YYYY-MM-DD。");
  }
  if (!NEWS_ANALYST_LABELS.includes(input.analystLabel)) {
    errors.push(`analystLabel 必須是：${NEWS_ANALYST_LABELS.join(", ")}。`);
  }
  const generatedAt = normalizeTimestamp(input.generatedAt || now, "generatedAt", errors);

  const rawEvidence = Array.isArray(input.evidence) ? input.evidence : [];
  if (!Array.isArray(input.evidence)) errors.push("evidence 必須是陣列。");
  const normalizedEvidence = [];
  rawEvidence.forEach((item, index) => {
    try {
      const normalized = normalizeNewsEvidence(item, now);
      if (!NEWS_SOURCE_TIERS.includes(normalized.sourceTier)) {
        errors.push(`evidence[${index}].sourceTier 不在允許清單。`);
      }
      normalizedEvidence.push(normalized);
    } catch (error) {
      errors.push(`evidence[${index}]：${error instanceof Error ? error.message.trim() : "格式錯誤。"}`);
    }
  });
  const knownEvidenceUrls = new Set(
    normalizedEvidence.map((item) => item.canonicalUrl),
  );

  const rawEvents = Array.isArray(input.events) ? input.events : [];
  if (rawEvents.length !== 5) errors.push("events 必須剛好包含 5 個事件。");
  const events = rawEvents.map((item, index) => {
    const path = `events[${index}]`;
    const topics = cleanTextArray(item?.topicIds);
    const unknownTopics = topics.filter((topic) => !NEWS_TOPIC_IDS.includes(topic));
    if (unknownTopics.length) {
      errors.push(`${path}.topicIds 包含未知主題：${unknownTopics.join(", ")}。`);
    }
    if (!topics.length) errors.push(`${path}.topicIds 至少需要一個主題。`);
    if (typeof item?.confidence !== "number" || item.confidence < 0 || item.confidence > 1) {
      errors.push(`${path}.confidence 必須介於 0 與 1。`);
    }

    const headline = cleanText(item?.headline);
    const summary = cleanText(item?.summary);
    const interpretation = cleanText(item?.interpretation);
    if (!headline) errors.push(`${path}.headline 不可為空。`);
    if (!summary) errors.push(`${path}.summary 不可為空。`);
    if (!interpretation) errors.push(`${path}.interpretation 不可為空。`);

    const suggestedTopicIds = suggestNewsTopics(`${headline} ${summary}`);
    const missingSuggestions = suggestedTopicIds.filter((topic) => !topics.includes(topic));
    if (missingSuggestions.length) {
      warnings.push(`${path} 可考慮主題：${missingSuggestions.join(", ")}。`);
    }

    const evidenceUrls = cleanTextArray(item?.evidenceUrls).map((url) => {
      try {
        return canonicalizeNewsUrl(url);
      } catch {
        errors.push(`${path}.evidenceUrls 包含無效 URL。`);
        return null;
      }
    }).filter(Boolean);
    if (!evidenceUrls.length) errors.push(`${path}.evidenceUrls 至少需要一個 URL。`);
    for (const url of evidenceUrls) {
      if (!knownEvidenceUrls.has(url)) {
        errors.push(`${path}.evidenceUrls 引用了 evidence 中不存在的 URL：${url}。`);
      }
    }

    const dataToConfirm = cleanTextArray(item?.dataToConfirm);
    const marketDate = cleanText(item?.marketDate) || input.briefDate;
    if (!validDateKey(marketDate)) {
      errors.push(`${path}.marketDate 必須使用有效的 YYYY-MM-DD。`);
    }
    const confirmationRules = normalizeConfirmationRules(
      item?.confirmationRules,
      `${path}.confirmationRules`,
      dataToConfirm,
      errors,
    );
    const confirmedSeriesIds = new Set(confirmationRules.map((rule) => rule.seriesId));
    for (const seriesId of dataToConfirm) {
      if (!confirmedSeriesIds.has(seriesId)) {
        warnings.push(`${path}.dataToConfirm ${seriesId} 尚未設定確認規則。`);
      }
    }

    return {
      rank: Number(item?.rank),
      headline,
      summary,
      topicIds: topics,
      suggestedTopicIds,
      evidenceUrls,
      transmissionPath: cleanTextArray(item?.transmissionPath),
      affectedAssets: cleanTextArray(item?.affectedAssets),
      dataToConfirm,
      marketDate,
      confirmationRules,
      interpretation,
      confidence:
        typeof item?.confidence === "number" && item.confidence >= 0 && item.confidence <= 1
          ? item.confidence
          : null,
      techEarnings: normalizeTechEarnings(item?.techEarnings, `${path}.techEarnings`, errors),
    };
  });

  const ranks = events.map((item) => item.rank);
  if (events.length === 5 && JSON.stringify(ranks) !== JSON.stringify([1, 2, 3, 4, 5])) {
    errors.push("events.rank 必須依序為 1 到 5。");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    value: errors.length === 0
      ? {
          briefDate: input.briefDate,
          generatedAt,
          analystLabel: input.analystLabel,
          analystRationale: cleanText(input.analystRationale) || null,
          evidence: normalizedEvidence,
          events,
        }
      : null,
  };
}
