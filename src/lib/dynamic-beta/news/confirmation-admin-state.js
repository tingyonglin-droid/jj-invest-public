import {
  confirmationLabel,
  persistenceLabel,
} from "./confirmation-view.js";
import { AdminResponseError, readAdminJson } from "../admin-http.js";

const CONFIRMATION_STATUSES = Object.freeze([
  "confirmed",
  "reverse",
  "unconfirmed",
  "observing",
  "insufficient_data",
  "not_configured",
]);

const PERSISTENCE_STATUSES = Object.freeze([
  "sustained",
  "faded",
  "reversed",
  "emerged_late",
  "unchanged",
  "observing",
  "insufficient_data",
  "not_configured",
]);

export const INITIAL_CONFIRMATION_ADMIN_STATE = Object.freeze({
  result: null,
  status: "idle",
  error: "",
  stale: false,
});

function emptyCounts(statuses) {
  return Object.fromEntries(statuses.map((status) => [status, 0]));
}

function countValues(values, statuses) {
  const counts = emptyCounts(statuses);
  for (const value of values) {
    if (Object.hasOwn(counts, value)) counts[value] += 1;
  }
  return counts;
}

function confirmationStageSummary(events, stage) {
  const counts = countValues(
    events.map((event) => event?.[stage]?.status),
    CONFIRMATION_STATUSES,
  );
  return {
    counts,
    items: CONFIRMATION_STATUSES
      .filter((status) => counts[status] > 0)
      .map((status) => ({
        status,
        label: confirmationLabel(status),
        count: counts[status],
      })),
  };
}

export function summarizeConfirmationResult(result) {
  if (!result) return null;
  const events = Array.isArray(result.events) ? result.events : [];
  const persistence = countValues(
    events.map((event) => event?.persistence),
    PERSISTENCE_STATUSES,
  );
  return {
    eventCount: events.length,
    d1: confirmationStageSummary(events, "d1"),
    d3: confirmationStageSummary(events, "d3"),
    persistence,
    persistenceItems: PERSISTENCE_STATUSES
      .filter((status) => persistence[status] > 0)
      .map((status) => ({
        status,
        label: persistenceLabel(status),
        count: persistence[status],
      })),
  };
}

function confirmationQueryForEndpoint(endpoint, {
  token,
  briefDate,
  revisionId,
  asOf,
}) {
  if (!token) {
    throw new AdminResponseError("缺少管理 token。", { kind: "authorization" });
  }
  if (revisionId && !briefDate) {
    throw new Error("Revision ID 必須搭配 Brief date。");
  }
  const params = new URLSearchParams({ token });
  if (asOf) params.set("asOf", asOf);
  if (briefDate) params.set("briefDate", briefDate);
  if (revisionId) params.set("revisionId", revisionId);
  return `/api/dynamic-beta/news/${endpoint}?${params.toString()}`;
}

export function confirmationSnapshotQuery(filters) {
  return confirmationQueryForEndpoint("confirmation-snapshots", filters);
}

export function confirmationPreviewQuery(filters) {
  return confirmationQueryForEndpoint("confirmations", filters);
}

export function confirmationAdminReducer(state, event) {
  switch (event.type) {
    case "load-started":
      return { ...state, status: "loading", error: "" };
    case "load-succeeded":
      return {
        ...state,
        result: event.result,
        status: "ready",
        error: "",
        stale: false,
      };
    case "load-failed":
      if (event.accessDenied) {
        return {
          ...state,
          result: null,
          status: "error",
          error: event.error,
          stale: false,
        };
      }
      return {
        ...state,
        status: "error",
        error: event.error,
        stale: state.result !== null,
      };
    default:
      return state;
  }
}

function isLiveConfirmationResult(payload) {
  return payload !== null
    && typeof payload === "object"
    && !Array.isArray(payload)
    && typeof payload.briefDate === "string"
    && typeof payload.revisionId === "string"
    && typeof payload.asOf === "string"
    && Array.isArray(payload.events);
}

function isConfirmationSnapshot(payload) {
  return isLiveConfirmationResult(payload)
    && typeof payload.snapshotId === "string"
    && payload.snapshotId.length > 0
    && Number.isInteger(payload.snapshotRevisionNumber)
    && payload.snapshotRevisionNumber > 0
    && Number.isInteger(payload.revisionNumber)
    && payload.revisionNumber > 0
    && typeof payload.createdAt === "string"
    && (payload.evaluatedAt === null || typeof payload.evaluatedAt === "string")
    && payload.completion !== null
    && typeof payload.completion === "object"
    && typeof payload.completion.complete === "boolean"
    && Array.isArray(payload.completion.pendingReasons)
    && payload.metadata?.vintageMode === "latest_stored_revision_by_observation_date"
    && payload.metadata?.truePointInTime === false;
}

function createConfirmationController({
  fetchImpl,
  query,
  validate,
  fallbackMessage,
  emptyOnNotFound = false,
}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Confirmation admin controller 需要 fetchImpl。");
  }
  return {
    async load(filters) {
      const response = await fetchImpl(query(filters), {
        cache: "no-store",
      });
      if (emptyOnNotFound && response.status === 404) {
        try {
          const payload = await response.clone().json();
          if (payload && typeof payload === "object" && payload.enabled !== false) {
            return null;
          }
        } catch {
          // Let readAdminJson preserve malformed-response error handling.
        }
      }
      return readAdminJson(response, {
        fallbackMessage,
        validate,
      });
    },
  };
}

export function createConfirmationSnapshotAdminController({ fetchImpl }) {
  return createConfirmationController({
    fetchImpl,
    query: confirmationSnapshotQuery,
    validate: isConfirmationSnapshot,
    fallbackMessage: "Confirmation snapshot 讀取失敗",
    emptyOnNotFound: true,
  });
}

export function createConfirmationPreviewAdminController({ fetchImpl }) {
  return createConfirmationController({
    fetchImpl,
    query: confirmationPreviewQuery,
    validate: isLiveConfirmationResult,
    fallbackMessage: "Confirmation Preview 讀取失敗",
  });
}
