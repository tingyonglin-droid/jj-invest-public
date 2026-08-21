import { normalizeHistoryRecords } from "./history.js";

export const APP_BACKUP_VERSION = 1;
export const APP_BACKUP_NAME = "jj-invest-public";

function toInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function toCurrencyAmount(value, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  const factor = 10 ** digits;
  return Math.round((number + Number.EPSILON) * factor) / factor;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function deriveLegacyTargetBeta(settings = {}) {
  const positions = Array.isArray(settings.positions) ? settings.positions : [];
  const leveragedPositions = positions.filter((position) => toNumber(position.assetBeta, 2) > 1);
  const weightTotal = leveragedPositions.reduce(
    (sum, position) => sum + Math.max(toNumber(position.targetWeightPct), 0),
    0,
  );
  const usesCustomWeights = settings.allocationModes?.leveraged === "custom" && weightTotal > 0;
  const leveragedBeta = leveragedPositions.length === 0
    ? 2
    : usesCustomWeights
      ? leveragedPositions.reduce(
          (sum, position) =>
            sum + toNumber(position.assetBeta, 2) * (Math.max(toNumber(position.targetWeightPct), 0) / weightTotal),
          0,
        )
      : leveragedPositions.reduce(
          (sum, position) => sum + toNumber(position.assetBeta, 2),
          0,
        ) / leveragedPositions.length;

  const targetBeta = toNumber(settings.originalTargetPct) / 100
    + toNumber(settings.leveragedTargetPct, 60) / 100 * leveragedBeta;
  return Math.round((targetBeta + Number.EPSILON) * 10000) / 10000;
}

export function normalizeBackupSettings(settings, fallbackSettings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const fallback = fallbackSettings && typeof fallbackSettings === "object" ? fallbackSettings : {};
  const originalTargetPct = toNumber(source.originalTargetPct, fallback.originalTargetPct ?? 0);
  const leveragedTargetPct = Number.isFinite(Number(source.leveragedTargetPct))
    ? toNumber(source.leveragedTargetPct)
    : Number.isFinite(Number(source.targetBeta))
      ? toNumber(source.targetBeta - originalTargetPct / 100) * 50
      : fallback.leveragedTargetPct ?? 60;
  const hasLegacyTargetInputs = Array.isArray(source.positions)
    || Number.isFinite(Number(source.leveragedTargetPct))
    || Number.isFinite(Number(source.originalTargetPct));
  const targetBeta = Number.isFinite(Number(source.targetBeta))
    ? toNumber(source.targetBeta)
    : hasLegacyTargetInputs
      ? deriveLegacyTargetBeta({
          ...source,
          leveragedTargetPct,
          originalTargetPct,
        })
      : toNumber(fallback.targetBeta, 1.2);
  const sourceModes = source.allocationModes && typeof source.allocationModes === "object"
    ? source.allocationModes
    : {};
  const fallbackModes = fallback.allocationModes && typeof fallback.allocationModes === "object"
    ? fallback.allocationModes
    : {};
  const normalizeMode = (assetType) => {
    if (sourceModes[assetType] === "custom" || sourceModes[assetType] === "auto") {
      return sourceModes[assetType];
    }
    return fallbackModes[assetType] === "custom" ? "custom" : "auto";
  };

  return {
    ...fallback,
    positions: Array.isArray(source.positions)
      ? source.positions.map((position, index) => ({
          id: String(position.id || `position-${index + 1}`),
          tickerInput: String(position.tickerInput || ""),
          shares: toInteger(position.shares),
          assetBeta: Number.isFinite(Number(position.assetBeta)) ? Number(position.assetBeta) : 2,
          targetWeightPct: toNumber(position.targetWeightPct),
        }))
      : fallback.positions || [],
    allocationModes: {
      leveraged: normalizeMode("leveraged"),
      original: normalizeMode("original"),
    },
    cashEquivalentPositions: Array.isArray(source.cashEquivalentPositions)
      ? source.cashEquivalentPositions.map((position, index) => ({
          id: String(position.id || `cash-equivalent-${index + 1}`),
          tickerInput: String(position.tickerInput || ""),
          shares: toInteger(position.shares),
          targetWeightPct: toNumber(position.targetWeightPct),
        }))
      : fallback.cashEquivalentPositions || [],
    cashEquivalentMode: source.cashEquivalentMode === "custom" ? "custom" : "auto",
    realCashTargetPct: toNumber(source.realCashTargetPct, fallback.realCashTargetPct ?? 10),
    cashTwd: toInteger(source.cashTwd),
    cashUsd: toCurrencyAmount(source.cashUsd, 2),
    leveragedTargetPct,
    originalTargetPct,
    originalAllocationMode: source.originalAllocationMode === "custom" ? "custom" : "current",
    targetBeta,
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
