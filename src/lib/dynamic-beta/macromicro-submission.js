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

  const result = await service.ingest(payload);
  if (result.status === "error") {
    throw new MacroMicroSubmissionError(
      result.errorCode,
      "M 平方來源同步失敗，已保留既有 observation。",
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
