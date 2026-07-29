export function formatDynamicBetaValue(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "—";
  }
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 6 });
}

export function getDynamicBetaStatusLabel(status) {
  return {
    success: "正常",
    error: "失敗",
    never: "尚未同步",
    running: "同步中",
  }[status] || String(status || "未知");
}

export function getDynamicBetaFreshnessLabel(status) {
  return {
    fresh: "新鮮",
    delayed: "延遲",
    stale: "過期",
    never: "無資料",
    error: "同步失敗",
  }[status] || String(status || "未知");
}

const DYNAMIC_BETA_FRESHNESS_STATUSES = Object.freeze([
  "fresh",
  "delayed",
  "stale",
  "never",
  "error",
]);

const DYNAMIC_BETA_ALERT_ORDER = Object.freeze([
  "error",
  "never",
  "stale",
  "delayed",
]);

export function summarizeDynamicBetaSeries(series = []) {
  const buckets = Object.fromEntries(
    DYNAMIC_BETA_FRESHNESS_STATUSES.map((status) => [status, []]),
  );

  for (const item of series) {
    const status = item?.freshnessStatus;
    if (!Object.hasOwn(buckets, status)) {
      throw new TypeError(`不支援的 Dynamic Beta freshness status：${status}`);
    }
    buckets[status].push(item);
  }

  return {
    counts: Object.fromEntries(
      DYNAMIC_BETA_FRESHNESS_STATUSES.map((status) => [
        status,
        buckets[status].length,
      ]),
    ),
    alerts: DYNAMIC_BETA_ALERT_ORDER.flatMap((status) => buckets[status]),
    normal: buckets.fresh,
  };
}
