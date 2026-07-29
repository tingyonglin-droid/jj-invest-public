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
const STAGE_STATUSES = new Set([
  "success",
  "partial",
  "error",
  "skipped_locked",
]);
const STAGE_CODES = new Set([
  null,
  "AUTOMATIC_SYNC_PARTIAL",
  "AUTOMATIC_SYNC_FAILED",
  "AUTOMATIC_SYNC_INVALID_RESULT",
  "MACROMICRO_INGEST_PARTIAL",
  "MACROMICRO_SOURCE_FAILED",
  "MACROMICRO_INVALID_RESULT",
  "MACROMICRO_INGEST_FAILED",
  "SNAPSHOT_RUN_PARTIAL",
  "SNAPSHOT_RUN_FAILED",
  "SNAPSHOT_INVALID_RESULT",
  "SYNC_LOCKED",
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

function safePipelineSummary(result) {
  try {
    if (
      !result
      || !["success", "partial"].includes(result.status)
      || !Array.isArray(result.stages)
      || result.stages.length !== STAGE_NAMES.length
    ) {
      throw new Error("invalid pipeline result");
    }
    const stages = result.stages.map((stage, index) => {
      const name = STAGE_NAMES[index];
      if (
        stage?.name !== name
        || !STAGE_STATUSES.has(stage.status)
        || !STAGE_CODES.has(stage.code)
      ) {
        throw new Error("invalid pipeline stage");
      }
      const counts = {};
      for (const countName of COUNT_NAMES[name]) {
        const count = stage.counts?.[countName];
        if (!Number.isInteger(count) || count < 0) {
          throw new Error("invalid pipeline counts");
        }
        counts[countName] = count;
      }
      return { name, status: stage.status, code: stage.code, counts };
    });
    return { status: result.status, stages };
  } catch {
    throw new Error("invalid pipeline result");
  }
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
  if (!pipeline || typeof pipeline.run !== "function") {
    throw submissionError("SERVICE_UNCONFIGURED", "Daily pipeline 服務尚未設定。");
  }

  const result = await pipeline.run({ macroMicroPayload, asOf });
  return safePipelineSummary(result);
}
