import { normalizeHistoryRecords } from "./history.js";

export const HISTORY_RESTORE_VERSION = 1;
export const HISTORY_RESTORE_REASON = "before-clear-history";

export function createHistoryRestorePoint(records, createdAt = new Date().toISOString()) {
  return {
    version: HISTORY_RESTORE_VERSION,
    reason: HISTORY_RESTORE_REASON,
    createdAt,
    records: normalizeHistoryRecords(records),
  };
}

export function parseHistoryRestorePoint(jsonText) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error("無法復原上一筆歷史紀錄。");
  }

  if (
    !data ||
    data.version !== HISTORY_RESTORE_VERSION ||
    data.reason !== HISTORY_RESTORE_REASON ||
    !Array.isArray(data.records)
  ) {
    throw new Error("無法復原上一筆歷史紀錄。");
  }

  return {
    ...data,
    records: normalizeHistoryRecords(data.records),
  };
}
