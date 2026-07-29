import {
  getDynamicBetaFlags,
  getDynamicBetaNewsFlags,
} from "./config.js";

const trustedSubmissionErrors = new WeakMap();
const STAGE_NAMES = Object.freeze([
  "automatic-sync",
  "macromicro-ingest",
  "confirmation-snapshots",
]);
const COUNT_NAMES = Object.freeze({
  "automatic-sync": Object.freeze(["total", "succeeded", "failed"]),
  "macromicro-ingest": Object.freeze(["inserted", "revised", "unchanged"]),
  "confirmation-snapshots": Object.freeze([
    "selected",
    "skippedComplete",
    "inserted",
    "revised",
    "unchanged",
    "failed",
  ]),
});

export class DynamicBetaDailyPipelineSubmissionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DynamicBetaDailyPipelineSubmissionError";
    this.code = code;
  }
}

function submissionError(code, message) {
  const error = new DynamicBetaDailyPipelineSubmissionError(code, message);
  trustedSubmissionErrors.set(error, Object.freeze({ code, message }));
  return error;
}

export function getDynamicBetaDailyPipelineSubmissionErrorSummary(error) {
  return trustedSubmissionErrors.get(error) || null;
}

function formatTaipeiDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("invalid date");
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const date = `${values.year}-${values.month}-${values.day}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("invalid date");
  return date;
}

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

function captureCounts(value, names) {
  const captured = captureProperties(value, names);
  if (!captured) return null;
  return names.every((name) => Number.isInteger(captured[name]) && captured[name] >= 0)
    ? captured
    : null;
}

function allZero(counts) {
  return Object.values(counts).every((count) => count === 0);
}

function validAutomaticStage({ status, code, counts }) {
  if (counts.succeeded + counts.failed !== counts.total) return false;
  if (status === "success") return code === null && counts.failed === 0;
  if (status === "partial") {
    return code === "AUTOMATIC_SYNC_PARTIAL"
      && counts.succeeded > 0
      && counts.failed > 0;
  }
  if (status === "error") {
    if (code === "AUTOMATIC_SYNC_INVALID_RESULT") return true;
    return code === "AUTOMATIC_SYNC_FAILED"
      && (allZero(counts) || (counts.total > 0 && counts.failed === counts.total));
  }
  return status === "skipped_locked" && code === "SYNC_LOCKED" && allZero(counts);
}

function validMacroMicroStage({ status, code, counts }) {
  const total = counts.inserted + counts.revised + counts.unchanged;
  if (status === "success") return code === null && total === 1;
  if (status === "error") {
    return [
      "MACROMICRO_SOURCE_FAILED",
      "MACROMICRO_INVALID_RESULT",
      "MACROMICRO_INGEST_FAILED",
    ].includes(code) && allZero(counts);
  }
  return status === "skipped_locked" && code === "SYNC_LOCKED" && allZero(counts);
}

function snapshotClassified(counts) {
  return counts.skippedComplete
    + counts.inserted
    + counts.revised
    + counts.unchanged
    + counts.failed;
}

function validSnapshotStage({ status, code, counts }) {
  const classified = snapshotClassified(counts);
  if (status === "success") {
    return code === null && counts.failed === 0 && classified === counts.selected;
  }
  if (status === "partial") {
    return code === "SNAPSHOT_RUN_PARTIAL"
      && counts.failed > 0
      && counts.failed < counts.selected
      && classified === counts.selected;
  }
  if (status === "error") {
    if (code === "SNAPSHOT_INVALID_RESULT") return true;
    return code === "SNAPSHOT_RUN_FAILED" && (
      allZero(counts)
      || (
        counts.selected > 0
        && counts.failed === counts.selected
        && classified === counts.selected
      )
    );
  }
  return status === "skipped_locked" && code === "SYNC_LOCKED" && allZero(counts);
}

function captureStage(value, expectedName) {
  const captured = captureProperties(value, ["name", "status", "code", "counts"]);
  if (!captured || captured.name !== expectedName) return null;
  const counts = captureCounts(captured.counts, COUNT_NAMES[expectedName]);
  if (!counts) return null;
  const stage = {
    name: captured.name,
    status: captured.status,
    code: captured.code,
    counts,
  };
  const valid = expectedName === "automatic-sync"
    ? validAutomaticStage(stage)
    : expectedName === "macromicro-ingest"
      ? validMacroMicroStage(stage)
      : validSnapshotStage(stage);
  return valid ? stage : null;
}

function safePipelineSummary(result) {
  const captured = captureProperties(result, ["status", "stages"]);
  const sourceStages = captureArray(captured?.stages);
  if (!captured || !sourceStages || sourceStages.length !== STAGE_NAMES.length) {
    throw new Error("invalid pipeline result");
  }
  const stages = [];
  for (let index = 0; index < STAGE_NAMES.length; index += 1) {
    const stage = captureStage(sourceStages[index], STAGE_NAMES[index]);
    if (!stage) throw new Error("invalid pipeline result");
    stages.push(stage);
  }
  const derivedStatus = stages.every((stage) => stage.status === "success")
    ? "success"
    : "partial";
  if (captured.status !== derivedStatus) throw new Error("invalid pipeline result");
  return { status: derivedStatus, stages };
}

export async function submitDynamicBetaDailyPipelineFile({
  inputPath,
  readFile,
  environment,
  getPipeline,
  now,
}) {
  if (typeof inputPath !== "string" || !inputPath.trim()) {
    throw submissionError(
      "INPUT_REQUIRED",
      "請提供一個 Daily pipeline JSON 檔案路徑。",
    );
  }
  if (!getDynamicBetaFlags(environment).dataEnabled) {
    throw submissionError("DATA_DISABLED", "Dynamic Beta 資料同步功能未啟用。");
  }
  if (!getDynamicBetaNewsFlags(environment).dataEnabled) {
    throw submissionError(
      "NEWS_DATA_DISABLED",
      "Dynamic Beta News data module 尚未啟用。",
    );
  }

  let contents;
  try {
    contents = await readFile(inputPath.trim(), "utf8");
  } catch {
    throw submissionError(
      "INPUT_READ_FAILED",
      "無法讀取 Daily pipeline JSON 檔案。",
    );
  }

  let macroMicroPayload;
  try {
    macroMicroPayload = JSON.parse(contents);
  } catch {
    throw submissionError("INVALID_JSON", "Daily pipeline JSON 格式無效。");
  }

  let asOf;
  try {
    asOf = formatTaipeiDate(now());
  } catch {
    throw submissionError("INVALID_DATE", "Daily pipeline 日期無效。");
  }

  let pipeline;
  try {
    pipeline = getPipeline();
  } catch {
    throw submissionError("SERVICE_UNCONFIGURED", "Daily pipeline 服務尚未設定。");
  }
  let runPipeline;
  try {
    runPipeline = pipeline?.run;
  } catch {
    throw submissionError("SERVICE_UNCONFIGURED", "Daily pipeline 服務尚未設定。");
  }
  if (typeof runPipeline !== "function") {
    throw submissionError("SERVICE_UNCONFIGURED", "Daily pipeline 服務尚未設定。");
  }

  const result = await runPipeline.call(pipeline, { macroMicroPayload, asOf });
  return safePipelineSummary(result);
}
