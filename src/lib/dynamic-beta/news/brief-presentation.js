const MISSING_LABELS = Object.freeze({
  technologyMetric: "尚未公布",
  confirmationRules: "沒有設定規則",
  technologyEarnings: "非科技財報事件",
  confidence: "未提供信心",
  optional: "未提供",
});

const STATUS_LABELS = Object.freeze({
  pending: "待核准",
  approved: "已核准",
  rejected: "已拒絕",
  published: "已發布",
  confirmed: "已確認",
  reverse: "反向",
  unconfirmed: "未確認",
  observing: "觀察中",
  insufficient_data: "資料不足",
  not_configured: "尚未設定確認規則",
});

export function knownMissingLabel(kind) {
  return MISSING_LABELS[kind] || MISSING_LABELS.optional;
}

export function formatBriefConfidence(value) {
  return value === null || value === undefined
    ? MISSING_LABELS.confidence
    : String(value);
}

export function briefStatusLabel(status) {
  return STATUS_LABELS[status] || status || "狀態未提供";
}

function presentationEvidence(source) {
  return {
    ...source,
    url: source?.canonicalUrl || source?.originalUrl || source?.url || null,
  };
}

function presentationEvent(event) {
  return {
    ...event,
    evidenceUrls: Array.isArray(event?.evidenceUrls) ? [...event.evidenceUrls] : [],
    topicIds: Array.isArray(event?.topicIds) ? [...event.topicIds] : [],
    suggestedTopicIds: Array.isArray(event?.suggestedTopicIds)
      ? [...event.suggestedTopicIds]
      : [],
    transmissionPath: Array.isArray(event?.transmissionPath)
      ? [...event.transmissionPath]
      : [],
    affectedAssets: Array.isArray(event?.affectedAssets) ? [...event.affectedAssets] : [],
    dataToConfirm: Array.isArray(event?.dataToConfirm) ? [...event.dataToConfirm] : [],
    confirmationRules: Array.isArray(event?.confirmationRules)
      ? event.confirmationRules.map((rule) => ({ ...rule }))
      : [],
    techEarnings: event?.techEarnings ? { ...event.techEarnings } : null,
  };
}

export function buildPublishedBriefPresentation(brief) {
  if (!brief) return null;
  return {
    identity: {
      kind: "published",
      briefDate: brief.briefDate || null,
      revisionId: brief.revisionId || null,
      revisionNumber: brief.revisionNumber ?? null,
      status: brief.status || "published",
    },
    analysis: {
      label: brief.analystLabel || null,
      rationale: brief.analystRationale || null,
    },
    generatedAt: brief.generatedAt || null,
    evidence: (Array.isArray(brief.evidence) ? brief.evidence : []).map(presentationEvidence),
    events: (Array.isArray(brief.events) ? brief.events : [])
      .map(presentationEvent)
      .sort((left, right) => Number(left.rank) - Number(right.rank)),
  };
}
