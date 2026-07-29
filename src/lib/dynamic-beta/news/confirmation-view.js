const CONFIRMATION_LABELS = Object.freeze({
  confirmed: "已確認",
  reverse: "反向",
  unconfirmed: "未確認",
  observing: "觀察中",
  insufficient_data: "資料不足",
  not_configured: "尚未設定確認規則",
});

const PERSISTENCE_LABELS = Object.freeze({
  sustained: "持續",
  faded: "消退",
  reversed: "反轉",
  emerged_late: "延後確認",
  unchanged: "未改變",
  observing: "觀察中",
  insufficient_data: "資料不足",
  not_configured: "尚未設定確認規則",
});

function formatNumber(value) {
  return Number(value).toFixed(2).replace(/\.00$/, "");
}

export function confirmationLabel(status) {
  return CONFIRMATION_LABELS[status] || status || "—";
}

export function persistenceLabel(status) {
  return PERSISTENCE_LABELS[status] || status || "—";
}

export function formatConfirmationMove(value, changeType) {
  if (value === null || value === undefined) {
    return "—";
  }
  const suffix = changeType === "percent"
    ? "%"
    : changeType === "basis_points"
      ? " bps"
      : "";
  return `${formatNumber(value)}${suffix}`;
}

export function formatConfirmationObservation(observation) {
  if (!observation || observation.value === null || observation.value === undefined) {
    return "—";
  }
  return `${formatNumber(observation.value)} · ${observation.observationDate || "—"}`;
}

export function formatRuleExpectation(rule) {
  if (!rule || rule.threshold === null || rule.threshold === undefined) {
    return "—";
  }
  const direction = rule.expectedDirection === "up" ? "上漲" : "下跌";
  return `${direction}至少 ${formatConfirmationMove(rule.threshold, rule.changeType)}`;
}
