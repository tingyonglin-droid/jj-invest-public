import { normalizeBackupSettings } from "./backup.js";

export const REBALANCE_RESTORE_VERSION = 1;
export const REBALANCE_RESTORE_REASON = "before-rebalance";

export function createRebalanceRestorePoint(settings, createdAt = new Date().toISOString()) {
  return {
    version: REBALANCE_RESTORE_VERSION,
    reason: REBALANCE_RESTORE_REASON,
    createdAt,
    settings: normalizeBackupSettings(settings),
  };
}

export function parseRebalanceRestorePoint(jsonText) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error("無法復原上一筆再平衡資料。");
  }

  if (
    !data ||
    data.version !== REBALANCE_RESTORE_VERSION ||
    data.reason !== REBALANCE_RESTORE_REASON ||
    !data.settings
  ) {
    throw new Error("無法復原上一筆再平衡資料。");
  }

  return {
    ...data,
    settings: normalizeBackupSettings(data.settings),
  };
}
