const DAY_MS = 24 * 60 * 60 * 1000;

function utcDate(value) {
  if (value instanceof Date) {
    return new Date(Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate(),
    ));
  }
  return new Date(`${value}T00:00:00.000Z`);
}

function completedWeekdays(from, through) {
  let count = 0;
  const cursor = utcDate(from);
  const end = utcDate(through);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor <= end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      count += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

function daysAfterObservationMonth(observationDate, asOf) {
  const observation = utcDate(observationDate);
  const nextObservationMonthEnd = new Date(Date.UTC(
    observation.getUTCFullYear(),
    observation.getUTCMonth() + 2,
    0,
  ));
  return Math.max(
    0,
    Math.floor((utcDate(asOf) - nextObservationMonthEnd) / DAY_MS),
  );
}

export function evaluateDynamicBetaFreshness({
  series,
  observationDate,
  updateStatus,
  asOf = new Date(),
}) {
  if (updateStatus === "error") {
    return {
      status: "error",
      age: null,
      freshThreshold: null,
      staleThreshold: null,
      reason: "最近一次同步失敗。",
    };
  }
  if (!observationDate) {
    return {
      status: "never",
      age: null,
      freshThreshold: null,
      staleThreshold: null,
      reason: "尚無可用 observation。",
    };
  }

  const policy = series?.freshnessPolicy || {
    kind: "weekdays",
    fresh: 2,
    delayed: 4,
  };
  const age = policy.kind === "month_end_days"
    ? daysAfterObservationMonth(observationDate, asOf)
    : completedWeekdays(observationDate, asOf);
  const unit = policy.kind === "month_end_days" ? "日" : "個工作日";
  if (age <= policy.fresh) {
    return {
      status: "fresh",
      age,
      freshThreshold: policy.fresh,
      staleThreshold: policy.delayed,
      reason: `落後 ${age} ${unit}，仍在正常更新窗口內。`,
    };
  }
  if (age <= policy.delayed) {
    return {
      status: "delayed",
      age,
      freshThreshold: policy.fresh,
      staleThreshold: policy.delayed,
      reason: `落後 ${age} ${unit}，已超過正常窗口但未達過期門檻。`,
    };
  }
  return {
    status: "stale",
    age,
    freshThreshold: policy.fresh,
    staleThreshold: policy.delayed,
    reason: `落後 ${age} ${unit}，已超過 ${policy.delayed} ${unit}門檻。`,
  };
}
