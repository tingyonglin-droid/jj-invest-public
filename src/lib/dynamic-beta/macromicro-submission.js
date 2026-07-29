import {
  MACROMICRO_MARGIN_SERIES_ID,
  MACROMICRO_SOURCE_ERROR_MESSAGES,
} from "./macromicro.js";

export class MacroMicroSubmissionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MacroMicroSubmissionError";
    this.code = code;
  }
}

function submissionError(code, message) {
  return new MacroMicroSubmissionError(code, message);
}

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isStoredObservationSummary(result) {
  if (!result) return false;
  const counts = [result.inserted, result.revised, result.unchanged];
  return (
    result.seriesId === MACROMICRO_MARGIN_SERIES_ID &&
    result.status === "success" &&
    counts.every((count) => Number.isInteger(count) && count >= 0) &&
    counts.reduce((total, count) => total + count, 0) === 1 &&
    isIsoDate(result.latestObservationDate)
  );
}

function sourceErrorCodeFromSummary(result) {
  if (
    result &&
    result.seriesId === MACROMICRO_MARGIN_SERIES_ID &&
    result.status === "error" &&
    result.hasOwnErrorCode &&
    typeof result.errorCode === "string" &&
    Object.hasOwn(MACROMICRO_SOURCE_ERROR_MESSAGES, result.errorCode)
  ) {
    return result.errorCode;
  }
  return null;
}

function snapshotSubmissionResult(result) {
  try {
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      return null;
    }
    const hasOwnErrorCode = Object.hasOwn(result, "errorCode");
    return {
      seriesId: result.seriesId,
      status: result.status,
      inserted: result.inserted,
      revised: result.revised,
      unchanged: result.unchanged,
      latestObservationDate: result.latestObservationDate,
      hasOwnErrorCode,
      errorCode: hasOwnErrorCode ? result.errorCode : undefined,
    };
  } catch {
    return null;
  }
}

export async function submitMacroMicroFile({
  inputPath,
  readFile,
  dataEnabled,
  getService,
}) {
  if (!String(inputPath || "").trim()) {
    throw submissionError("INPUT_REQUIRED", "請提供 M 平方 JSON 檔案路徑。");
  }
  if (!dataEnabled) {
    throw submissionError("DATA_DISABLED", "Dynamic Beta 資料同步功能未啟用。");
  }

  let contents;
  try {
    contents = await readFile(inputPath, "utf8");
  } catch {
    throw submissionError("INPUT_READ_FAILED", "無法讀取 M 平方 JSON 檔案。");
  }

  let payload;
  try {
    payload = JSON.parse(contents);
  } catch {
    throw submissionError("INVALID_JSON", "M 平方 JSON 格式無效。");
  }

  const service = getService();
  if (!service || typeof service.ingest !== "function") {
    throw submissionError("SERVICE_UNCONFIGURED", "M 平方同步服務尚未設定。");
  }

  const result = snapshotSubmissionResult(await service.ingest(payload));
  const sourceErrorCode = sourceErrorCodeFromSummary(result);
  if (sourceErrorCode) {
    throw new MacroMicroSubmissionError(
      sourceErrorCode,
      "M 平方來源同步失敗，已保留既有 observation。",
    );
  }
  if (!isStoredObservationSummary(result)) {
    throw submissionError(
      "INVALID_RESULT",
      "M 平方同步結果無效，既有 observation 未受影響。",
    );
  }

  return {
    seriesId: result.seriesId,
    status: result.status,
    inserted: result.inserted,
    revised: result.revised,
    unchanged: result.unchanged,
    latestObservationDate: result.latestObservationDate,
  };
}
