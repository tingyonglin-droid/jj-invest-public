const DRAFT_STATUS_LABELS = Object.freeze({
  pending: "待核准",
  approved: "已核准",
  rejected: "已拒絕",
});

function thresholdSuffix(changeType) {
  if (changeType === "percent") return "%";
  if (changeType === "basis_points") return " bps";
  return "";
}

export function approvalFailureMessage(payload) {
  if (payload?.saved !== false) return "";
  if (payload.error) return payload.error;
  const errors = Array.isArray(payload.errors)
    ? payload.errors.map((error) => String(error || "").trim()).filter(Boolean)
    : [];
  return errors.join(" ") || "晨報草稿無法發布。";
}

export function draftStatusLabel(status) {
  return DRAFT_STATUS_LABELS[status] || status || "—";
}

export function formatDraftRule(rule) {
  if (!rule || rule.threshold === null || rule.threshold === undefined) {
    return "—";
  }
  const direction = rule.expectedDirection === "up" ? "上升" : "下跌";
  return `${rule.seriesId || "—"} · ${direction}至少 ${rule.threshold}${thresholdSuffix(rule.changeType)}`;
}
