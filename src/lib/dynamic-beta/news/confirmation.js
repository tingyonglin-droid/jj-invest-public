import { getDynamicBetaSeries } from "../catalog.js";

const STATUSES = Object.freeze([
  "confirmed",
  "reverse",
  "unconfirmed",
  "observing",
  "insufficient_data",
  "not_configured",
]);
const EVALUABLE_STATUSES = new Set(["confirmed", "reverse", "unconfirmed"]);

function usableHistory(history, asOf) {
  return (Array.isArray(history) ? history : [])
    .filter((item) => item?.observationDate <= asOf && Number.isFinite(Number(item?.value)))
    .map((item) => ({ ...item, value: Number(item.value) }))
    .sort((left, right) => left.observationDate.localeCompare(right.observationDate));
}

function calculateMove(changeType, baseline, observation) {
  if (changeType === "percent") {
    if (!Number.isFinite(baseline) || baseline === 0) return null;
    return (observation / baseline - 1) * 100;
  }
  if (changeType === "basis_points") return (observation - baseline) * 100;
  return observation - baseline;
}

function normalizeMove(rawMove, rule) {
  return rule.expectedDirection === "down" ? -rawMove : rawMove;
}

function classifyMove(rawMove, rule) {
  if (!Number.isFinite(rawMove)) return "insufficient_data";
  const directionalMove = normalizeMove(rawMove, rule);
  if (directionalMove >= rule.threshold) return "confirmed";
  if (directionalMove <= -rule.threshold) return "reverse";
  return "unconfirmed";
}

function freshEnough(freshnessStatus) {
  const status = typeof freshnessStatus === "object"
    ? freshnessStatus?.status
    : freshnessStatus;
  return status === "fresh" || status === "delayed";
}

function unavailableWindow(reason) {
  return {
    status: "insufficient_data",
    observation: null,
    rawMove: null,
    normalizedMove: null,
    reason,
  };
}

function evaluateWindow({ observation, baseline, rule, freshnessStatus }) {
  if (!baseline) return unavailableWindow("missing_baseline");
  if (!observation) {
    if (freshEnough(freshnessStatus)) {
      return {
        status: "observing",
        observation: null,
        rawMove: null,
        normalizedMove: null,
        reason: "awaiting_observation",
      };
    }
    return unavailableWindow("missing_observation");
  }

  const rawMove = calculateMove(rule.changeType, baseline.value, observation.value);
  if (!Number.isFinite(rawMove)) {
    return {
      ...unavailableWindow("invalid_baseline"),
      observation,
    };
  }
  const normalizedMove = normalizeMove(rawMove, rule);
  return {
    status: classifyMove(rawMove, rule),
    observation,
    rawMove,
    normalizedMove,
    reason: null,
  };
}

function insufficientRuleResult(rule, reason) {
  const window = unavailableWindow(reason);
  return {
    seriesId: rule.seriesId,
    expectedDirection: rule.expectedDirection,
    changeType: rule.changeType,
    threshold: rule.threshold,
    baseline: null,
    d1: window,
    d3: { ...window },
    persistence: "insufficient_data",
  };
}

function notConfiguredRuleResult(seriesId) {
  const window = {
    status: "not_configured",
    observation: null,
    rawMove: null,
    normalizedMove: null,
    reason: "not_configured",
  };
  return {
    seriesId,
    expectedDirection: null,
    changeType: null,
    threshold: null,
    baseline: null,
    d1: window,
    d3: { ...window },
    persistence: "not_configured",
  };
}

export function evaluateConfirmationRule({
  rule,
  marketDate,
  history,
  asOf,
  freshnessStatus,
}) {
  const rows = usableHistory(history, asOf);
  const baseline = rows.filter((item) => item.observationDate < marketDate).at(-1) || null;
  const observations = rows.filter((item) => item.observationDate >= marketDate);
  const d1 = evaluateWindow({
    observation: observations[0] || null,
    baseline,
    rule,
    freshnessStatus,
  });
  const d3 = evaluateWindow({
    observation: observations[2] || null,
    baseline,
    rule,
    freshnessStatus,
  });

  return {
    seriesId: rule.seriesId,
    expectedDirection: rule.expectedDirection,
    changeType: rule.changeType,
    threshold: rule.threshold,
    baseline,
    d1,
    d3,
    persistence: describeConfirmationPersistence(d1.status, d3.status),
  };
}

export function describeConfirmationPersistence(d1Status, d3Status) {
  const d1Directional = d1Status === "confirmed" || d1Status === "reverse";
  const d3Directional = d3Status === "confirmed" || d3Status === "reverse";
  if (d1Directional && d1Status === d3Status) return "sustained";
  if (d1Directional && d3Status === "unconfirmed") return "faded";
  if (d1Directional && d3Directional) return "reversed";
  if (d1Status === "unconfirmed" && d3Directional) return "emerged_late";
  if (d1Status === "unconfirmed" && d3Status === "unconfirmed") return "unchanged";
  if (d1Status === "not_configured" || d3Status === "not_configured") return "not_configured";
  if (d1Status === "insufficient_data" || d3Status === "insufficient_data") {
    return "insufficient_data";
  }
  return "observing";
}

export function rollupConfirmation(ruleResults, window) {
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  for (const result of Array.isArray(ruleResults) ? ruleResults : []) {
    const status = result?.[window]?.status;
    if (Object.hasOwn(counts, status)) counts[status] += 1;
  }
  const evaluable = [...EVALUABLE_STATUSES]
    .reduce((total, status) => total + counts[status], 0);
  const requiredMajority = Math.floor(evaluable / 2) + 1;
  const isFinal = counts.observing === 0;
  if (counts.confirmed >= requiredMajority && requiredMajority > 0) {
    return { status: "confirmed", reason: "majority_confirmed", isFinal, evaluable, requiredMajority, counts };
  }
  if (counts.reverse >= requiredMajority && requiredMajority > 0) {
    return { status: "reverse", reason: "majority_reverse", isFinal, evaluable, requiredMajority, counts };
  }
  if (evaluable) {
    return {
      status: "unconfirmed",
      reason: counts.confirmed && counts.reverse ? "split_signals" : "no_threshold_met",
      isFinal,
      evaluable,
      requiredMajority,
      counts,
    };
  }
  if (counts.observing) {
    return { status: "observing", reason: "awaiting_observations", isFinal, evaluable, requiredMajority, counts };
  }
  if (counts.insufficient_data) {
    return { status: "insufficient_data", reason: "insufficient_data", isFinal, evaluable, requiredMajority, counts };
  }
  if (counts.not_configured) {
    return { status: "not_configured", reason: "not_configured", isFinal, evaluable, requiredMajority, counts };
  }
  return { status: "insufficient_data", reason: "no_rules", isFinal, evaluable, requiredMajority, counts };
}

export function evaluateEventConfirmation({
  event,
  briefDate,
  histories,
  freshnessBySeries,
  asOf,
}) {
  const marketDate = event.marketDate || briefDate;
  const configuredRules = Array.isArray(event.confirmationRules) ? event.confirmationRules : [];
  const rules = configuredRules.map((rule) => {
    const series = getDynamicBetaSeries(rule.seriesId);
    if (!series) return insufficientRuleResult(rule, "unknown_series");
    if (series.freshnessPolicy?.kind !== "weekdays") {
      return insufficientRuleResult(rule, "unsupported_frequency");
    }
    return evaluateConfirmationRule({
      rule,
      marketDate,
      history: histories?.[rule.seriesId],
      asOf,
      freshnessStatus: freshnessBySeries?.[rule.seriesId],
    });
  });
  const configuredIds = new Set(configuredRules.map((rule) => rule?.seriesId));
  for (const seriesId of Array.isArray(event.dataToConfirm) ? event.dataToConfirm : []) {
    if (!configuredIds.has(seriesId)) rules.push(notConfiguredRuleResult(seriesId));
  }

  const d1 = rollupConfirmation(rules, "d1");
  const d3 = rollupConfirmation(rules, "d3");
  return {
    rank: event.rank,
    headline: event.headline,
    marketDate,
    rules,
    d1,
    d3,
    persistence: describeConfirmationPersistence(d1.status, d3.status),
  };
}
