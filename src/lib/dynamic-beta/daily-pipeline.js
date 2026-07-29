const LOCK_CONTENTION_MESSAGE = "Dynamic Beta 資料同步已在執行中。";
const STAGE_STATUSES = new Set(["success", "partial", "error"]);

const EMPTY_AUTOMATIC_COUNTS = Object.freeze({
  total: 0,
  succeeded: 0,
  failed: 0,
});
const EMPTY_MACROMICRO_COUNTS = Object.freeze({
  inserted: 0,
  revised: 0,
  unchanged: 0,
});
const EMPTY_SNAPSHOT_COUNTS = Object.freeze({
  selected: 0,
  skippedComplete: 0,
  inserted: 0,
  revised: 0,
  unchanged: 0,
  failed: 0,
});

function safeCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function safeResultStatus(result) {
  try {
    return STAGE_STATUSES.has(result?.status) ? result.status : null;
  } catch {
    return null;
  }
}

function automaticSyncSummary(result) {
  let results = [];
  try {
    results = Array.isArray(result?.results) ? result.results : [];
  } catch {
    results = [];
  }
  const total = results.length;
  const succeeded = results.reduce((count, item) => {
    try {
      return count + (item?.status === "success" ? 1 : 0);
    } catch {
      return count;
    }
  }, 0);
  const status = safeResultStatus(result);
  return {
    name: "automatic-sync",
    status: status || "error",
    code: status === "success"
      ? null
      : status === "partial"
        ? "AUTOMATIC_SYNC_PARTIAL"
        : status === "error"
          ? "AUTOMATIC_SYNC_FAILED"
          : "AUTOMATIC_SYNC_INVALID_RESULT",
    counts: {
      total,
      succeeded,
      failed: total - succeeded,
    },
  };
}

function macroMicroSummary(result) {
  const status = safeResultStatus(result);
  let inserted = 0;
  let revised = 0;
  let unchanged = 0;
  try {
    inserted = safeCount(result?.inserted);
    revised = safeCount(result?.revised);
    unchanged = safeCount(result?.unchanged);
  } catch {
    // Keep fixed zero counts for hostile or malformed service results.
  }
  return {
    name: "macromicro-ingest",
    status: status || "error",
    code: status === "success"
      ? null
      : status === "partial"
        ? "MACROMICRO_INGEST_PARTIAL"
        : status === "error"
          ? "MACROMICRO_SOURCE_FAILED"
          : "MACROMICRO_INVALID_RESULT",
    counts: { inserted, revised, unchanged },
  };
}

function confirmationSnapshotSummary(result) {
  const status = safeResultStatus(result);
  const counts = { ...EMPTY_SNAPSHOT_COUNTS };
  try {
    for (const name of Object.keys(counts)) {
      counts[name] = safeCount(result?.[name]);
    }
  } catch {
    Object.assign(counts, EMPTY_SNAPSHOT_COUNTS);
  }
  return {
    name: "confirmation-snapshots",
    status: status || "error",
    code: status === "success"
      ? null
      : status === "partial"
        ? "SNAPSHOT_RUN_PARTIAL"
        : status === "error"
          ? "SNAPSHOT_RUN_FAILED"
          : "SNAPSHOT_INVALID_RESULT",
    counts,
  };
}

function isLockContention(error) {
  try {
    return typeof error?.message === "string"
      && error.message.includes(LOCK_CONTENTION_MESSAGE);
  } catch {
    return false;
  }
}

function failedSummary({ name, counts, errorCode, error }) {
  const locked = isLockContention(error);
  return {
    name,
    status: locked ? "skipped_locked" : "error",
    code: locked ? "SYNC_LOCKED" : errorCode,
    counts: { ...counts },
  };
}

function logStageFailure(logger, stage) {
  if (stage.status === "success") return;
  try {
    logger?.error?.("dynamic_beta_daily_pipeline_stage_failed", {
      stage: stage.name,
      code: stage.code,
    });
  } catch {
    // Logging must never interrupt later pipeline stages.
  }
}

async function runStage({ task, summarize, failure, logger }) {
  let stage;
  try {
    stage = summarize(await task());
  } catch (error) {
    stage = failedSummary({ ...failure, error });
  }
  logStageFailure(logger, stage);
  return stage;
}

export function createDynamicBetaDailyPipeline({
  syncService,
  macroMicroService,
  snapshotService,
  logger = null,
}) {
  return {
    async run({ macroMicroPayload, asOf }) {
      const stages = [];
      stages.push(await runStage({
        task: () => syncService.sync({}),
        summarize: automaticSyncSummary,
        failure: {
          name: "automatic-sync",
          counts: EMPTY_AUTOMATIC_COUNTS,
          errorCode: "AUTOMATIC_SYNC_FAILED",
        },
        logger,
      }));
      stages.push(await runStage({
        task: () => macroMicroService.ingest(macroMicroPayload),
        summarize: macroMicroSummary,
        failure: {
          name: "macromicro-ingest",
          counts: EMPTY_MACROMICRO_COUNTS,
          errorCode: "MACROMICRO_INGEST_FAILED",
        },
        logger,
      }));
      stages.push(await runStage({
        task: () => snapshotService.run({ asOf }),
        summarize: confirmationSnapshotSummary,
        failure: {
          name: "confirmation-snapshots",
          counts: EMPTY_SNAPSHOT_COUNTS,
          errorCode: "SNAPSHOT_RUN_FAILED",
        },
        logger,
      }));
      return {
        status: stages.every((stage) => stage.status === "success")
          ? "success"
          : "partial",
        stages,
      };
    },
  };
}
