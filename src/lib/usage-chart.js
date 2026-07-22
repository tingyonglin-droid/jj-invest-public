function formatPoint(value) {
  return Number(value.toFixed(2)).toString();
}

function formatDateLabel(dateKey) {
  const [, month, day] = String(dateKey || "").split("-");
  if (!month || !day) {
    return "";
  }

  return `${Number(month)}/${Number(day)}`;
}

function createPoints(trend, field, maxY) {
  const divisor = Math.max(maxY, 1);
  const lastIndex = Math.max(trend.length - 1, 1);

  return trend
    .map((item, index) => {
      const x = trend.length === 1 ? 100 : (index / lastIndex) * 100;
      const y = 100 - ((Number(item[field]) || 0) / divisor) * 100;
      return `${formatPoint(x)},${formatPoint(y)}`;
    })
    .join(" ");
}

export function createUsageChartModel(trend) {
  const safeTrend = Array.isArray(trend) ? trend : [];
  const maxY = safeTrend.reduce(
    (max, item) => Math.max(max, Number(item.totalDevices) || 0, Number(item.totalOpens) || 0),
    0,
  );
  const first = safeTrend[0];
  const last = safeTrend[safeTrend.length - 1];

  return {
    maxY,
    devicePoints: createPoints(safeTrend, "totalDevices", maxY),
    openPoints: createPoints(safeTrend, "totalOpens", maxY),
    labels: first && last && first.date !== last.date
      ? [formatDateLabel(first.date), formatDateLabel(last.date)]
      : [formatDateLabel(first?.date)].filter(Boolean),
  };
}
