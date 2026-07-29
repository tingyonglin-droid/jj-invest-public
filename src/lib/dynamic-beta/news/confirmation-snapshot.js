import { createHash } from "node:crypto";

const TERMINAL_MISSING_REASONS = new Set([
  "not_configured",
  "unknown_series",
  "unsupported_frequency",
]);

const WINDOW_STATUSES = ["confirmed", "reverse", "unconfirmed", "observing", "insufficient_data", "not_configured"];

export class ConfirmationSnapshotError extends Error {
  constructor(code) {
    super(code);
    this.name = "ConfirmationSnapshotError";
    this.code = code;
  }
}

function nullable(value) {
  return value === undefined ? null : value;
}

function validDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function normalizeObservation(observation) {
  if (!observation || typeof observation !== "object" || Array.isArray(observation)) return null;
  return {
    revisionId: nullable(observation.revisionId),
    observationDate: nullable(observation.observationDate),
    value: nullable(observation.value),
    releasedAt: nullable(observation.releasedAt),
    retrievedAt: nullable(observation.retrievedAt),
    firstSeenAt: nullable(observation.firstSeenAt),
    lastSeenAt: nullable(observation.lastSeenAt),
    sourceRealtimeStart: nullable(observation.sourceRealtimeStart),
    sourceRealtimeEnd: nullable(observation.sourceRealtimeEnd),
  };
}

function normalizeWindow(window) {
  return {
    status: nullable(window?.status),
    observation: normalizeObservation(window?.observation),
    rawMove: nullable(window?.rawMove),
    normalizedMove: nullable(window?.normalizedMove),
    reason: nullable(window?.reason),
  };
}

function normalizeRollup(rollup) {
  const counts = rollup?.counts;
  return {
    status: nullable(rollup?.status),
    reason: nullable(rollup?.reason),
    isFinal: nullable(rollup?.isFinal),
    evaluable: nullable(rollup?.evaluable),
    requiredMajority: nullable(rollup?.requiredMajority),
    counts: Object.fromEntries(WINDOW_STATUSES.map((status) => [status, nullable(counts?.[status])])),
  };
}

function normalizeRule(rule) {
  return {
    seriesId: nullable(rule?.seriesId),
    expectedDirection: nullable(rule?.expectedDirection),
    changeType: nullable(rule?.changeType),
    threshold: nullable(rule?.threshold),
    baseline: normalizeObservation(rule?.baseline),
    d1: normalizeWindow(rule?.d1),
    d3: normalizeWindow(rule?.d3),
    persistence: nullable(rule?.persistence),
  };
}

function normalizeEvents(events) {
  return (Array.isArray(events) ? events : []).map((event) => ({
    rank: nullable(event?.rank),
    headline: nullable(event?.headline),
    marketDate: nullable(event?.marketDate),
    rules: (Array.isArray(event?.rules) ? event.rules : []).map(normalizeRule),
    d1: normalizeRollup(event?.d1),
    d3: normalizeRollup(event?.d3),
    persistence: nullable(event?.persistence),
  }));
}

function pendingReason(rule) {
  if (rule?.expectedDirection === null) return null;
  if (rule?.d3?.observation) return null;
  if (TERMINAL_MISSING_REASONS.has(rule?.d3?.reason)) return null;
  return rule?.d3?.reason || "missing_observation";
}

function completionFor(events) {
  const pendingReasons = [];
  for (const event of Array.isArray(events) ? events : []) {
    for (const rule of Array.isArray(event?.rules) ? event.rules : []) {
      const reason = pendingReason(rule);
      if (reason) {
        pendingReasons.push({
          eventRank: event?.rank ?? null,
          seriesId: rule?.seriesId ?? null,
          reason,
        });
      }
    }
  }
  return { complete: pendingReasons.length === 0, pendingReasons };
}

export function buildConfirmationSnapshot({ evaluation, createdAt }) {
  if (!validDateKey(evaluation?.asOf)) throw new ConfirmationSnapshotError("INVALID_AS_OF");
  if (!validTimestamp(createdAt)) throw new ConfirmationSnapshotError("INVALID_CREATED_AT");

  const completion = completionFor(evaluation.events);
  const content = {
    briefDate: nullable(evaluation.briefDate),
    revisionId: nullable(evaluation.revisionId),
    revisionNumber: nullable(evaluation.revisionNumber),
    asOf: evaluation.asOf,
    metadata: {
      vintageMode: "latest_stored_revision_by_observation_date",
      truePointInTime: false,
    },
    completion,
    events: normalizeEvents(evaluation.events),
  };
  return {
    snapshotId: confirmationSnapshotId(content),
    snapshotRevisionNumber: null,
    ...content,
    evaluatedAt: nullable(evaluation.evaluatedAt),
    createdAt,
  };
}

export function confirmationSnapshotId(content) {
  const digest = createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 24);
  return `ncs_${digest}`;
}

export function isConfirmationSnapshotComplete(snapshot) {
  return snapshot?.completion?.complete === true;
}

export function parseStoredConfirmationSnapshot(record) {
  if (record?.committed !== "1" || typeof record?.payload !== "string") return null;
  try {
    const snapshot = JSON.parse(record.payload);
    return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot : null;
  } catch {
    return null;
  }
}
