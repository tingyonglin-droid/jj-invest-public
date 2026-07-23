import { normalizeHistoryRecords } from "./history.js";

export const APP_BACKUP_VERSION = 1;
export const APP_BACKUP_NAME = "jj-invest-public";

function toInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeBackupSettings(settings, fallbackSettings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const fallback = fallbackSettings && typeof fallbackSettings === "object" ? fallbackSettings : {};

  return {
    ...fallback,
    positions: Array.isArray(source.positions)
      ? source.positions.map((position, index) => ({
          id: String(position.id || `position-${index + 1}`),
          tickerInput: String(position.tickerInput || ""),
          shares: toInteger(position.shares),
          assetBeta: Number(position.assetBeta) === 1 ? 1 : 2,
          targetWeightPct: toNumber(position.targetWeightPct),
        }))
      : fallback.positions || [],
    cashTwd: toInteger(source.cashTwd),
    cashUsd: toInteger(source.cashUsd),
    targetBeta: toNumber(source.targetBeta, fallback.targetBeta ?? 1.2),
    originalTargetPct: toNumber(source.originalTargetPct, fallback.originalTargetPct ?? 0),
    tolerancePct: toNumber(source.tolerancePct, fallback.tolerancePct ?? 10),
  };
}

export function createAppBackup({ settings, history, exportedAt = new Date().toISOString() }) {
  return {
    version: APP_BACKUP_VERSION,
    app: APP_BACKUP_NAME,
    exportedAt,
    settings: normalizeBackupSettings(settings),
    history: normalizeHistoryRecords(history),
  };
}

export function mergeImportedHistory(currentHistory, importedHistory) {
  const current = normalizeHistoryRecords(currentHistory);
  const imported = normalizeHistoryRecords(importedHistory);
  const byDate = new Map(current.map((record) => [record.date, record]));

  imported.forEach((record) => {
    byDate.set(record.date, record);
  });

  return normalizeHistoryRecords(Array.from(byDate.values()));
}

export function parseAppBackup(jsonText, fallbackSettings = {}) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error("備份檔格式無法讀取。");
  }

  if (!data || data.app !== APP_BACKUP_NAME || data.version !== APP_BACKUP_VERSION) {
    throw new Error("這不是可匯入的 JJ Invest System 備份檔。");
  }

  return {
    settings: normalizeBackupSettings(data.settings, fallbackSettings),
    history: normalizeHistoryRecords(data.history),
    exportedAt: data.exportedAt || null,
  };
}
