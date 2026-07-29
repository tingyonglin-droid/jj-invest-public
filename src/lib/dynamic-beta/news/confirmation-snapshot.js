import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

const TERMINAL_MISSING_REASONS = new Set([
  "not_configured",
  "unknown_series",
  "unsupported_frequency",
]);

const WINDOW_STATUSES = ["confirmed", "reverse", "unconfirmed", "observing", "insufficient_data", "not_configured"];
const CHANGE_TYPES = new Set(["percent", "absolute", "basis_points"]);
const DIRECTIONS = new Set(["up", "down"]);
const PERSISTENCE_STATUSES = new Set([
  "sustained",
  "faded",
  "reversed",
  "emerged_late",
  "unchanged",
  "not_configured",
  "insufficient_data",
  "observing",
]);
const WINDOW_REASONS = new Set([
  "missing_baseline",
  "awaiting_observation",
  "missing_observation",
  "invalid_baseline",
  "unknown_series",
  "unsupported_frequency",
  "not_configured",
]);
const ROLLUP_REASONS = new Set([
  "majority_confirmed",
  "majority_reverse",
  "split_signals",
  "no_threshold_met",
  "awaiting_observations",
  "insufficient_data",
  "not_configured",
  "no_rules",
]);
const SNAPSHOT_KEYS = [
  "snapshotId",
  "snapshotRevisionNumber",
  "briefDate",
  "revisionId",
  "revisionNumber",
  "asOf",
  "metadata",
  "completion",
  "events",
  "evaluatedAt",
  "createdAt",
];
const METADATA_KEYS = ["vintageMode", "truePointInTime"];
const COMPLETION_KEYS = ["complete", "pendingReasons"];
const PENDING_REASON_KEYS = ["eventRank", "seriesId", "reason"];
const EVENT_KEYS = ["rank", "headline", "marketDate", "rules", "d1", "d3", "persistence"];
const RULE_KEYS = ["seriesId", "expectedDirection", "changeType", "threshold", "baseline", "d1", "d3", "persistence"];
const WINDOW_KEYS = ["status", "observation", "rawMove", "normalizedMove", "reason"];
const OBSERVATION_KEYS = [
  "revisionId",
  "observationDate",
  "value",
  "releasedAt",
  "retrievedAt",
  "firstSeenAt",
  "lastSeenAt",
  "sourceRealtimeStart",
  "sourceRealtimeEnd",
];
const ROLLUP_KEYS = ["status", "reason", "isFinal", "evaluable", "requiredMajority", "counts"];

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

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  if (!isRecord(value)) return false;
  const actualKeys = Reflect.ownKeys(value);
  return actualKeys.length === expectedKeys.length
    && expectedKeys.every((key) => Object.hasOwn(value, key));
}

function isNullableEnum(value, values) {
  return value === null || values.has(value);
}

function isNullableFiniteNumber(value) {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isNullableNonNegativeInteger(value) {
  return value === null || (Number.isInteger(value) && value >= 0);
}

function isNullableTimestamp(value) {
  return value === null || validTimestamp(value);
}

function isNullableDateKey(value) {
  return value === null || validDateKey(value);
}

function isNullableNonEmptyString(value) {
  return value === null || (typeof value === "string" && value.trim().length > 0);
}

function isValidObservation(observation) {
  if (observation === null) return true;
  return hasExactKeys(observation, OBSERVATION_KEYS)
    && isNullableNonEmptyString(observation.revisionId)
    && validDateKey(observation.observationDate)
    && typeof observation.value === "number"
    && Number.isFinite(observation.value)
    && isNullableTimestamp(observation.releasedAt)
    && isNullableTimestamp(observation.retrievedAt)
    && isNullableTimestamp(observation.firstSeenAt)
    && isNullableTimestamp(observation.lastSeenAt)
    && isNullableDateKey(observation.sourceRealtimeStart)
    && isNullableDateKey(observation.sourceRealtimeEnd);
}

function isValidWindow(window) {
  return hasExactKeys(window, WINDOW_KEYS)
    && (window.status === null || WINDOW_STATUSES.includes(window.status))
    && isValidObservation(window.observation)
    && isNullableFiniteNumber(window.rawMove)
    && isNullableFiniteNumber(window.normalizedMove)
    && isNullableEnum(window.reason, WINDOW_REASONS);
}

function isValidCounts(counts) {
  return hasExactKeys(counts, WINDOW_STATUSES)
    && WINDOW_STATUSES.every((status) => isNullableNonNegativeInteger(counts[status]));
}

function isValidRollup(rollup) {
  return hasExactKeys(rollup, ROLLUP_KEYS)
    && WINDOW_STATUSES.includes(rollup.status)
    && isNullableEnum(rollup.reason, ROLLUP_REASONS)
    && (rollup.isFinal === null || typeof rollup.isFinal === "boolean")
    && isNullableNonNegativeInteger(rollup.evaluable)
    && isNullableNonNegativeInteger(rollup.requiredMajority)
    && isValidCounts(rollup.counts);
}

function isValidRule(rule) {
  return hasExactKeys(rule, RULE_KEYS)
    && typeof rule.seriesId === "string"
    && rule.seriesId.trim().length > 0
    && isNullableEnum(rule.expectedDirection, DIRECTIONS)
    && isNullableEnum(rule.changeType, CHANGE_TYPES)
    && (rule.threshold === null
      || (typeof rule.threshold === "number" && Number.isFinite(rule.threshold) && rule.threshold > 0))
    && isValidObservation(rule.baseline)
    && isValidWindow(rule.d1)
    && isValidWindow(rule.d3)
    && PERSISTENCE_STATUSES.has(rule.persistence);
}

function isValidEvent(event) {
  return hasExactKeys(event, EVENT_KEYS)
    && Number.isInteger(event.rank)
    && event.rank > 0
    && typeof event.headline === "string"
    && event.headline.trim().length > 0
    && validDateKey(event.marketDate)
    && Array.isArray(event.rules)
    && event.rules.every(isValidRule)
    && isValidRollup(event.d1)
    && isValidRollup(event.d3)
    && PERSISTENCE_STATUSES.has(event.persistence);
}

function isValidCompletion(completion) {
  return hasExactKeys(completion, COMPLETION_KEYS)
    && typeof completion.complete === "boolean"
    && Array.isArray(completion.pendingReasons)
    && completion.pendingReasons.every((pending) => (
      hasExactKeys(pending, PENDING_REASON_KEYS)
      && Number.isInteger(pending.eventRank)
      && pending.eventRank > 0
      && typeof pending.seriesId === "string"
      && pending.seriesId.trim().length > 0
      && WINDOW_REASONS.has(pending.reason)
    ));
}

function hasExactBriefIdentity(value) {
  return validDateKey(value?.briefDate)
    && typeof value?.revisionId === "string"
    && value.revisionId.length > 0
    && Number.isInteger(value?.revisionNumber)
    && value.revisionNumber > 0;
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
  if (!hasExactBriefIdentity(evaluation)) throw new ConfirmationSnapshotError("IDENTITY_MISMATCH");
  if (!validDateKey(evaluation?.asOf)) throw new ConfirmationSnapshotError("INVALID_AS_OF");
  if (!validTimestamp(createdAt)) throw new ConfirmationSnapshotError("INVALID_CREATED_AT");

  const events = normalizeEvents(evaluation.events);
  const completion = completionFor(events);
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
    events,
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
  try {
    const committed = record?.committed;
    const payload = record?.payload;
    if (committed !== "1" || typeof payload !== "string") return null;
    const snapshot = JSON.parse(payload);
    if (!isStoredSnapshot(snapshot)) return null;
    return snapshot;
  } catch {
    return null;
  }
}

function isStoredSnapshot(snapshot) {
  if (!hasExactKeys(snapshot, SNAPSHOT_KEYS)) return false;
  if (!hasExactBriefIdentity(snapshot) || !validDateKey(snapshot.asOf)) return false;
  if (!validTimestamp(snapshot.createdAt)) return false;
  if (snapshot.evaluatedAt !== null && !validTimestamp(snapshot.evaluatedAt)) return false;
  if (snapshot.snapshotRevisionNumber !== null
    && (!Number.isInteger(snapshot.snapshotRevisionNumber) || snapshot.snapshotRevisionNumber < 1)) {
    return false;
  }
  if (!hasExactKeys(snapshot.metadata, METADATA_KEYS)
    || snapshot.metadata.vintageMode !== "latest_stored_revision_by_observation_date"
    || snapshot.metadata?.truePointInTime !== false) {
    return false;
  }
  if (!Array.isArray(snapshot.events)
    || !snapshot.events.every(isValidEvent)
    || !isValidCompletion(snapshot.completion)) {
    return false;
  }

  const metadata = {
    vintageMode: "latest_stored_revision_by_observation_date",
    truePointInTime: false,
  };
  const events = normalizeEvents(snapshot.events);
  const completion = completionFor(events);
  const content = {
    briefDate: snapshot.briefDate,
    revisionId: snapshot.revisionId,
    revisionNumber: snapshot.revisionNumber,
    asOf: snapshot.asOf,
    metadata,
    completion,
    events,
  };
  return isDeepStrictEqual(metadata, snapshot.metadata)
    && isDeepStrictEqual(events, snapshot.events)
    && isDeepStrictEqual(completion, snapshot.completion)
    && snapshot.snapshotId === confirmationSnapshotId(content);
}
