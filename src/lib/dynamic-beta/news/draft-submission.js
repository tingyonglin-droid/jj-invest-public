const SAFE_SAVE_STATUSES = new Set(["inserted", "revised", "unchanged"]);

export class MorningBriefDraftSubmissionError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = "MorningBriefDraftSubmissionError";
    this.code = code;
  }
}

function submissionError(code, message, cause = null) {
  return new MorningBriefDraftSubmissionError(code, message, cause);
}

function validationMessage(errors) {
  const safeErrors = Array.isArray(errors)
    ? errors.filter((error) => typeof error === "string" && error.trim())
    : [];
  return safeErrors.length > 0
    ? `晨報草稿未通過驗證：${safeErrors.join("；")}`
    : "晨報草稿未通過既有 schema 驗證。";
}

function safeDraftSummary(result) {
  const draft = result?.draft;
  if (draft?.status !== "pending") {
    throw submissionError(
      "UNSAFE_DRAFT_STATUS",
      "自動化只能建立待核准的晨報草稿。",
    );
  }
  if (
    !SAFE_SAVE_STATUSES.has(result?.status)
    || typeof draft.briefDate !== "string"
    || typeof draft.draftRevisionId !== "string"
    || !Number.isInteger(Number(draft.draftRevisionNumber))
  ) {
    throw submissionError(
      "SUBMISSION_FAILED",
      "晨報草稿儲存結果不完整，已停止處理。",
    );
  }

  return {
    saved: true,
    valid: true,
    created: result.status !== "unchanged",
    warningCount: Array.isArray(result.warnings) ? result.warnings.length : 0,
    briefDate: draft.briefDate,
    draftRevisionId: draft.draftRevisionId,
    draftRevisionNumber: Number(draft.draftRevisionNumber),
    status: "pending",
  };
}

export async function submitMorningBriefDraftFile({
  inputPath,
  readFile,
  newsDataEnabled,
  getService,
}) {
  if (typeof inputPath !== "string" || !inputPath.trim()) {
    throw submissionError("INPUT_REQUIRED", "必須提供晨報草稿 JSON 檔案路徑。");
  }
  if (newsDataEnabled !== true) {
    throw submissionError(
      "NEWS_DATA_DISABLED",
      "Dynamic Beta News data module 尚未啟用。",
    );
  }
  if (typeof readFile !== "function" || typeof getService !== "function") {
    throw submissionError("SUBMISSION_FAILED", "晨報草稿提交工具設定不完整。");
  }

  let source;
  try {
    source = await readFile(inputPath.trim(), "utf8");
  } catch (error) {
    throw submissionError(
      "INPUT_READ_FAILED",
      "無法讀取晨報草稿 JSON 檔案。",
      error,
    );
  }

  let payload;
  try {
    payload = JSON.parse(source);
  } catch (error) {
    throw submissionError(
      "INVALID_JSON",
      "晨報草稿不是有效的 JSON。",
      error,
    );
  }

  let service;
  try {
    service = getService();
  } catch (error) {
    throw submissionError(
      "SERVICE_UNCONFIGURED",
      "晨報草稿資料庫尚未完成設定。",
      error,
    );
  }
  if (!service || typeof service.create !== "function") {
    throw submissionError(
      "SERVICE_UNCONFIGURED",
      "晨報草稿資料庫尚未完成設定。",
    );
  }

  let result;
  try {
    result = await service.create(payload);
  } catch (error) {
    throw submissionError(
      "SUBMISSION_FAILED",
      "晨報草稿儲存失敗，既有正式資料未受影響。",
      error,
    );
  }
  if (!result?.saved || !result?.valid) {
    throw submissionError(
      "PAYLOAD_INVALID",
      validationMessage(result?.errors),
    );
  }

  return safeDraftSummary(result);
}
