import {
  MACROMICRO_MARGIN_SERIES_ID,
  MACROMICRO_SOURCE_ERROR_MESSAGES,
} from "./macromicro.js";

const LOCK_CONTENTION_MESSAGE = "Dynamic Beta 資料同步已在執行中。";

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

function captureProperties(value, names) {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return null;
  }
  const captured = {};
  try {
    for (const name of names) captured[name] = value[name];
  } catch {
    return null;
  }
  return captured;
}

function captureArray(value) {
  if (!Array.isArray(value)) return null;
  try {
    const length = value.length;
    if (!Number.isSafeInteger(length) || length < 0) return null;
    const captured = [];
    for (let index = 0; index < length; index += 1) captured.push(value[index]);
    return captured;
  } catch {
    return null;
  }
}

function validCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function automaticInvalid(counts = EMPTY_AUTOMATIC_COUNTS) {
  return {
    name: "automatic-sync",
    status: "error",
    code: "AUTOMATIC_SYNC_INVALID_RESULT",
    counts: { ...counts },
  };
}

function automaticSyncSummary(result) {
  const captured = captureProperties(result, ["status", "results"]);
  const items = captureArray(captured?.results);
  if (!captured || !items) return automaticInvalid();

  let succeeded = 0;
  let failed = 0;
  for (const item of items) {
    const itemSnapshot = captureProperties(item, ["status"]);
    if (itemSnapshot?.status === "success") succeeded += 1;
    else if (itemSnapshot?.status === "error") failed += 1;
    else return automaticInvalid();
  }
  const counts = { total: items.length, succeeded, failed };
  const derivedStatus = failed === 0
    ? "success"
    : failed === items.length
      ? "error"
      : "partial";
  if (captured.status !== derivedStatus) return automaticInvalid(counts);
  return {
    name: "automatic-sync",
    status: derivedStatus,
    code: derivedStatus === "success"
      ? null
      : derivedStatus === "partial"
        ? "AUTOMATIC_SYNC_PARTIAL"
        : "AUTOMATIC_SYNC_FAILED",
    counts,
  };
}

function macroMicroInvalid() {
  return {
    name: "macromicro-ingest",
    status: "error",
    code: "MACROMICRO_INVALID_RESULT",
    counts: { ...EMPTY_MACROMICRO_COUNTS },
  };
}

function ownDataProperty(value, name) {
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, name);
    return descriptor && Object.hasOwn(descriptor, "value")
      ? { found: true, value: descriptor.value }
      : { found: false, value: undefined };
  } catch {
    return { found: false, value: undefined };
  }
}

function macroMicroSummary(result) {
  const captured = captureProperties(result, ["seriesId", "status"]);
  if (!captured || captured.seriesId !== MACROMICRO_MARGIN_SERIES_ID) {
    return macroMicroInvalid();
  }
  if (captured.status === "error") {
    const errorCode = ownDataProperty(result, "errorCode");
    if (
      !errorCode.found
      || typeof errorCode.value !== "string"
      || !Object.hasOwn(MACROMICRO_SOURCE_ERROR_MESSAGES, errorCode.value)
    ) {
      return macroMicroInvalid();
    }
    return {
      name: "macromicro-ingest",
      status: "error",
      code: "MACROMICRO_SOURCE_FAILED",
      counts: { ...EMPTY_MACROMICRO_COUNTS },
    };
  }
  if (captured.status !== "success") return macroMicroInvalid();

  const counts = captureProperties(result, ["inserted", "revised", "unchanged"]);
  if (
    !counts
    || !validCount(counts.inserted)
    || !validCount(counts.revised)
    || !validCount(counts.unchanged)
    || counts.inserted + counts.revised + counts.unchanged !== 1
  ) {
    return macroMicroInvalid();
  }
  return {
    name: "macromicro-ingest",
    status: "success",
    code: null,
    counts,
  };
}

function snapshotInvalid(counts = EMPTY_SNAPSHOT_COUNTS) {
  return {
    name: "confirmation-snapshots",
    status: "error",
    code: "SNAPSHOT_INVALID_RESULT",
    counts: { ...counts },
  };
}

function confirmationSnapshotSummary(result) {
  const captured = captureProperties(result, [
    "status",
    "selected",
    "skippedComplete",
    "inserted",
    "revised",
    "unchanged",
    "failed",
  ]);
  if (!captured) return snapshotInvalid();
  const counts = {
    selected: captured.selected,
    skippedComplete: captured.skippedComplete,
    inserted: captured.inserted,
    revised: captured.revised,
    unchanged: captured.unchanged,
    failed: captured.failed,
  };
  if (!Object.values(counts).every(validCount)) return snapshotInvalid();
  const classified = counts.skippedComplete
    + counts.inserted
    + counts.revised
    + counts.unchanged
    + counts.failed;
  if (classified !== counts.selected) return snapshotInvalid(counts);
  const derivedStatus = counts.failed === 0
    ? "success"
    : counts.failed === counts.selected
      ? "error"
      : "partial";
  if (captured.status !== derivedStatus) return snapshotInvalid(counts);
  return {
    name: "confirmation-snapshots",
    status: derivedStatus,
    code: derivedStatus === "success"
      ? null
      : derivedStatus === "partial"
        ? "SNAPSHOT_RUN_PARTIAL"
        : "SNAPSHOT_RUN_FAILED",
    counts,
  };
}

function isLockContention(error) {
  let message;
  try {
    message = error?.message;
  } catch {
    return false;
  }
  return typeof message === "string" && message.includes(LOCK_CONTENTION_MESSAGE);
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
    const logError = logger?.error;
    if (typeof logError === "function") {
      logError.call(logger, "dynamic_beta_daily_pipeline_stage_failed", {
        stage: stage.name,
        code: stage.code,
      });
    }
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
