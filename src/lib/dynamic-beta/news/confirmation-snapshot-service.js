import {
  buildConfirmationSnapshot,
  isConfirmationSnapshotComplete,
} from "./confirmation-snapshot.js";

const SAFE_FAILURE_CODES = new Set([
  "EVALUATION_FAILED",
  "IDENTITY_MISMATCH",
  "SNAPSHOT_BUILD_FAILED",
  "SNAPSHOT_SAVE_FAILED",
]);

function validDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function subtractUtcDays(value, count) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - count);
  return date.toISOString().slice(0, 10);
}

function snapshotServiceError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function briefIdentity(brief) {
  return {
    briefDate: brief.briefDate,
    revisionId: brief.revisionId,
  };
}

function resultFor(brief, status, code = undefined) {
  return {
    ...briefIdentity(brief),
    status,
    ...(code ? { code } : {}),
  };
}

function logFailure(logger, brief, code) {
  try {
    logger?.error?.({
      event: "confirmation_snapshot_failed",
      ...briefIdentity(brief),
      code,
    });
  } catch {
    // Logging must not interrupt snapshots for later briefs.
  }
}

function logRunFailure(logger, code) {
  try {
    logger?.error?.({ event: "confirmation_snapshot_run_failed", code });
  } catch {
    // Logging must not replace the fixed service error.
  }
}

function errorCode(error, fallback) {
  return SAFE_FAILURE_CODES.has(error?.code)
    ? error.code
    : fallback;
}

function overallStatus({ selected, failed }) {
  if (failed === 0) return "success";
  return failed === selected ? "error" : "partial";
}

export function createConfirmationSnapshotService({
  newsRepository,
  confirmationService,
  snapshotRepository,
  now = () => new Date(),
  logger = null,
} = {}) {
  async function evaluateAndSave({ briefDate, revisionId, asOf } = {}) {
    let evaluation;
    try {
      evaluation = await confirmationService.evaluate({ briefDate, revisionId, asOf });
    } catch {
      throw snapshotServiceError("EVALUATION_FAILED");
    }
    if (evaluation?.briefDate !== briefDate || evaluation?.revisionId !== revisionId) {
      throw snapshotServiceError("IDENTITY_MISMATCH");
    }
    let snapshot;
    try {
      snapshot = buildConfirmationSnapshot({
        evaluation,
        createdAt: now().toISOString(),
      });
    } catch (error) {
      if (error?.code === "IDENTITY_MISMATCH") throw snapshotServiceError("IDENTITY_MISMATCH");
      throw snapshotServiceError("SNAPSHOT_BUILD_FAILED");
    }
    let saved;
    try {
      saved = await snapshotRepository.saveSnapshot(snapshot);
    } catch {
      throw snapshotServiceError("SNAPSHOT_SAVE_FAILED");
    }
    return { ...saved, complete: snapshot.completion.complete };
  }

  return {
    evaluateAndSave,

    async run({ asOf = null, lookbackDays = 10 } = {}) {
      if (!validDateKey(asOf)) throw snapshotServiceError("INVALID_AS_OF");
      if (!Number.isInteger(lookbackDays) || lookbackDays < 0 || lookbackDays > 30) {
        throw snapshotServiceError("INVALID_LOOKBACK_DAYS");
      }
      if (!newsRepository || !confirmationService || !snapshotRepository) {
        throw snapshotServiceError("UNCONFIGURED_REPOSITORY");
      }

      const since = subtractUtcDays(asOf, lookbackDays);
      let recent;
      try {
        recent = await newsRepository.readRecentBriefs({ limit: 200 });
      } catch {
        logRunFailure(logger, "BRIEF_READ_FAILED");
        throw snapshotServiceError("BRIEF_READ_FAILED");
      }
      if (!Array.isArray(recent)) {
        logRunFailure(logger, "BRIEF_READ_FAILED");
        throw snapshotServiceError("BRIEF_READ_FAILED");
      }
      const selected = recent
        .filter((brief) => validDateKey(brief?.briefDate)
          && typeof brief?.revisionId === "string"
          && brief.revisionId.length > 0
          && Number.isInteger(brief?.revisionNumber)
          && brief.revisionNumber > 0
          && brief.briefDate >= since
          && brief.briefDate <= asOf)
        .sort((left, right) => left.briefDate.localeCompare(right.briefDate)
          || left.revisionNumber - right.revisionNumber
          || left.revisionId.localeCompare(right.revisionId));
      const results = [];
      const counts = {
        skippedComplete: 0,
        inserted: 0,
        revised: 0,
        unchanged: 0,
        failed: 0,
      };

      for (const brief of selected) {
        let latest;
        try {
          latest = await snapshotRepository.readLatestSnapshot(briefIdentity(brief));
        } catch {
          counts.failed += 1;
          const code = "SNAPSHOT_READ_FAILED";
          results.push(resultFor(brief, "error", code));
          logFailure(logger, brief, code);
          continue;
        }
        if (isConfirmationSnapshotComplete(latest)) {
          counts.skippedComplete += 1;
          results.push(resultFor(brief, "skipped_complete"));
          continue;
        }

        try {
          const saved = await evaluateAndSave({ ...briefIdentity(brief), asOf });
          if (!Object.hasOwn(counts, saved.status) || saved.status === "failed") {
            throw snapshotServiceError("SNAPSHOT_SAVE_FAILED");
          }
          counts[saved.status] += 1;
          results.push(resultFor(brief, saved.status));
        } catch (error) {
          counts.failed += 1;
          const code = errorCode(error, "EVALUATION_FAILED");
          results.push(resultFor(brief, "error", code));
          logFailure(logger, brief, code);
        }
      }

      return {
        status: overallStatus({ selected: selected.length, failed: counts.failed }),
        selected: selected.length,
        ...counts,
        results,
      };
    },
  };
}
