import { normalizeTicker } from "./market-data.js";
import { getPositionGroupTargetStatus } from "./position-settings.js";
import {
  getCashEquivalentTargetStatus,
  getCashSleeveTargets,
} from "./cash-equivalents.js";

const MONEY_PRECISION = 100;
const RATIO_PRECISION = 10000;
const RATIO_TOLERANCE = 0.0001;

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * MONEY_PRECISION) / MONEY_PRECISION;
}

function roundRatio(value) {
  return Math.round((value + Number.EPSILON) * RATIO_PRECISION) / RATIO_PRECISION;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getAssetType(assetBeta) {
  return toNumber(assetBeta) > 1 ? "leveraged" : "original";
}

function isValidAssetBeta(assetBeta) {
  const beta = Number(assetBeta);
  return Number.isFinite(beta) && beta >= 1 && beta <= 3 && Math.abs(beta * 10 - Math.round(beta * 10)) < 0.0000001;
}

export function calculatePortfolio({
  positions,
  cashEquivalentPositions = [],
  quotes,
  cashTwd,
  targetBeta,
  leveragedTargetPct = 0,
  originalTargetPct = 0,
  tolerancePct,
  allocationModes = {},
  cashEquivalentMode = "auto",
  realCashTargetPct = 10,
}) {
  const quoteByTicker = new Map(
    quotes.map((quote) => [quote.normalizedTicker, quote]),
  );
  const normalizedPositions = positions.map((position) => ({
    ...position,
    normalizedTicker: normalizeTicker(position.tickerInput),
    shares: toNumber(position.shares),
    assetBeta: toNumber(position.assetBeta),
    targetWeightPct: toNumber(position.targetWeightPct),
  }));
  const normalizedCashEquivalentPositions = cashEquivalentPositions.map((position) => ({
    ...position,
    normalizedTicker: normalizeTicker(position.tickerInput),
    shares: toNumber(position.shares),
    targetWeightPct: toNumber(position.targetWeightPct),
  }));
  const issues = [];
  const addIssue = (code, message, settingsPage) => {
    issues.push({ code, message, settingsPage });
  };

  const validRows = normalizedPositions
    .map((position) => {
      const quote = quoteByTicker.get(position.normalizedTicker);
      const currentValueTwd =
        quote && !quote.error && typeof quote.priceTwd === "number"
          ? position.shares * quote.priceTwd
          : 0;
      return {
        ...position,
        quote,
        currentValueTwd: roundMoney(currentValueTwd),
      };
    })
    .filter((row) => row.quote && !row.quote.error);

  const validCashEquivalentRows = normalizedCashEquivalentPositions
    .map((position) => {
      const quote = quoteByTicker.get(position.normalizedTicker);
      const currentValueTwd =
        quote && !quote.error && typeof quote.priceTwd === "number"
          ? position.shares * quote.priceTwd
          : 0;
      return { ...position, quote, currentValueTwd: roundMoney(currentValueTwd) };
    })
    .filter((row) => row.quote && !row.quote.error);

  const stockValueTwd = roundMoney(
    validRows.reduce((sum, row) => sum + row.currentValueTwd, 0),
  );
  const leveragedValueTwd = roundMoney(
    validRows.reduce(
      (sum, row) => sum + (getAssetType(row.assetBeta) === "leveraged" ? row.currentValueTwd : 0),
      0,
    ),
  );
  const originalValueTwd = roundMoney(
    validRows.reduce(
      (sum, row) => sum + (getAssetType(row.assetBeta) === "original" ? row.currentValueTwd : 0),
      0,
    ),
  );
  const cashEquivalentValueTwd = roundMoney(
    validCashEquivalentRows.reduce((sum, row) => sum + row.currentValueTwd, 0),
  );
  const realCashTwd = roundMoney(toNumber(cashTwd));
  const cashSleeveValueTwd = roundMoney(realCashTwd + cashEquivalentValueTwd);
  const totalAssetsTwd = roundMoney(stockValueTwd + cashSleeveValueTwd);
  const legacyOriginalTargetRatio = Math.min(Math.max(toNumber(originalTargetPct) / 100, 0), 1);
  const legacyLeveragedTargetRatio = Math.min(
    Math.max(toNumber(leveragedTargetPct) / 100, 0),
    1,
  );
  const rowsByType = {
    leveraged: normalizedPositions.filter((row) => getAssetType(row.assetBeta) === "leveraged"),
    original: normalizedPositions.filter((row) => getAssetType(row.assetBeta) === "original"),
  };
  const targetWeightTotals = Object.fromEntries(
    Object.entries(rowsByType).map(([assetType, rows]) => [
      assetType,
      rows.reduce((sum, row) => sum + row.targetWeightPct, 0),
    ]),
  );
  normalizedPositions.forEach((position) => {
    if (!isValidAssetBeta(position.assetBeta)) {
      addIssue(
        "INVALID_ASSET_BETA",
        `${position.tickerInput || "未命名標的"}的曝險倍數必須介於 1～3，且最多一位小數。`,
        "positions",
      );
    }
  });
  const leveragedRows = rowsByType.leveraged;
  const leveragedWeightTotal = targetWeightTotals.leveraged;
  const targetLeveragedBeta = roundRatio(
    leveragedRows.length === 0
      ? 2
      : allocationModes.leveraged === "custom" && leveragedWeightTotal > 0
        ? leveragedRows.reduce(
            (sum, row) => sum + row.assetBeta * (row.targetWeightPct / leveragedWeightTotal),
            0,
          )
        : leveragedRows.reduce((sum, row) => sum + row.assetBeta, 0) / leveragedRows.length,
  );
  const hasExplicitTargetBeta = Number.isFinite(Number(targetBeta));
  const explicitTargetBeta = toNumber(targetBeta);
  const hasLeveragedRows = validRows.some((row) => getAssetType(row.assetBeta) === "leveraged");
  const hasOriginalRows = validRows.some((row) => getAssetType(row.assetBeta) === "original");
  const targetOriginalRatio = roundRatio(
    hasExplicitTargetBeta
      ? hasLeveragedRows
        ? hasOriginalRows && totalAssetsTwd > 0 ? originalValueTwd / totalAssetsTwd : 0
        : hasOriginalRows ? explicitTargetBeta : 0
      : legacyOriginalTargetRatio,
  );
  const targetLeveragedRatio = roundRatio(
    hasExplicitTargetBeta
      ? hasLeveragedRows ? (explicitTargetBeta - targetOriginalRatio) / targetLeveragedBeta : 0
      : legacyLeveragedTargetRatio,
  );
  const targetCashRatio = roundRatio(1 - targetLeveragedRatio - targetOriginalRatio);
  const targetBetaValue = roundRatio(
    hasExplicitTargetBeta
      ? explicitTargetBeta
      : targetLeveragedRatio * targetLeveragedBeta + targetOriginalRatio,
  );

  if (hasExplicitTargetBeta && (explicitTargetBeta < 0 || explicitTargetBeta > 3)) {
    addIssue(
      "INVALID_TARGET_BETA",
      "目標 Beta 必須介於 0～3。",
      "beta",
    );
  }

  if (hasExplicitTargetBeta && !hasLeveragedRows && !hasOriginalRows && explicitTargetBeta > 0) {
    addIssue(
      "MISSING_TARGET_POSITION",
      "請新增至少一檔原形或槓桿標的。",
      "positions",
    );
  }

  if (
    hasExplicitTargetBeta &&
    (targetLeveragedRatio < -RATIO_TOLERANCE || targetCashRatio < -RATIO_TOLERANCE)
  ) {
    addIssue(
      "TARGET_BETA_UNREACHABLE",
      `目前持股組合無法達成目標 Beta ${targetBetaValue.toFixed(2)}。`,
      "beta",
    );
  }

  if (!hasExplicitTargetBeta && targetCashRatio < -RATIO_TOLERANCE) {
    addIssue(
      "TARGET_TOTAL_EXCEEDED",
      "槓桿與原形目標比例合計不能超過 100%。",
      "beta",
    );
  }

  const cashTargetStatus = getCashEquivalentTargetStatus({
    mode: cashEquivalentMode,
    positions: normalizedCashEquivalentPositions,
    realCashTargetPct,
  });
  if (!cashTargetStatus.isValid) {
    addIssue(
      "INVALID_CASH_EQUIVALENT_WEIGHTS",
      "真實現金與類現金標的目標比例合計必須等於 100%。",
      "cash",
    );
  }

  if (targetLeveragedRatio > RATIO_TOLERANCE && validRows.every((row) => getAssetType(row.assetBeta) !== "leveraged")) {
    addIssue(
      "MISSING_LEVERAGED_POSITION",
      "槓桿目標比例大於 0 時，請新增至少一個槓桿標的。",
      "positions",
    );
  }

  if (targetOriginalRatio > RATIO_TOLERANCE && validRows.every((row) => getAssetType(row.assetBeta) !== "original")) {
    addIssue(
      "MISSING_ORIGINAL_POSITION",
      "原形目標比例大於 0 時，請新增至少一個原形標的。",
      "positions",
    );
  }

  Object.entries(rowsByType).forEach(([assetType, rows]) => {
    if (!getPositionGroupTargetStatus({
      mode: allocationModes[assetType],
      positions: rows,
    }).isValid) {
      const label = assetType === "leveraged" ? "槓桿" : "原形";
      addIssue(
        assetType === "leveraged" ? "INVALID_LEVERAGED_WEIGHTS" : "INVALID_ORIGINAL_WEIGHTS",
        `${label}標的目標比例合計必須等於 100%。`,
        "positions",
      );
    }
  });

  const tolerance = toNumber(tolerancePct) / 100;
  const betaLower = roundRatio(targetBetaValue * (1 - tolerance));
  const betaUpper = roundRatio(targetBetaValue * (1 + tolerance));
  const targetStockRatio = Math.max(targetLeveragedRatio, 0) + Math.max(targetOriginalRatio, 0);

  const targetLeveragedValueTwd = roundMoney(totalAssetsTwd * targetLeveragedRatio);
  const targetOriginalValueTwd = roundMoney(totalAssetsTwd * targetOriginalRatio);
  const targetCashSleeveValueTwd = roundMoney(totalAssetsTwd * Math.max(targetCashRatio, 0));
  const cashSleeveTargets = getCashSleeveTargets({
    mode: cashEquivalentMode,
    positions: normalizedCashEquivalentPositions,
    realCashTargetPct,
  });
  const targetRealCashTwd = roundMoney(targetCashSleeveValueTwd * cashSleeveTargets.realCashRatio);
  const cashEquivalentRecommendations = validCashEquivalentRows.map((row) => {
    const targetValueTwd = roundMoney(
      targetCashSleeveValueTwd * toNumber(cashSleeveTargets.positionRatios.get(row.id)),
    );
    return {
      id: row.id,
      tickerInput: row.tickerInput,
      normalizedTicker: row.normalizedTicker,
      shares: row.shares,
      assetBeta: 0,
      assetType: "cashEquivalent",
      price: row.quote.price,
      currency: row.quote.currency,
      priceTwd: row.quote.priceTwd,
      date: row.quote.date,
      source: row.quote.source,
      currentValueTwd: row.currentValueTwd,
      targetValueTwd,
      tradeAmountTwd: roundMoney(targetValueTwd - row.currentValueTwd),
      targetWeightPct: row.targetWeightPct,
    };
  });
  const leveragedTradeAmountTwd = roundMoney(targetLeveragedValueTwd - leveragedValueTwd);
  const originalTradeAmountTwd = roundMoney(targetOriginalValueTwd - originalValueTwd);
  const cashTradeAmountTwd = roundMoney(-(leveragedTradeAmountTwd + originalTradeAmountTwd));

  const recommendations = validRows.map((row) => {
    const currentWeight = totalAssetsTwd > 0 ? row.currentValueTwd / totalAssetsTwd : 0;
    const assetType = getAssetType(row.assetBeta);
    const typeValueTwd = assetType === "leveraged" ? leveragedValueTwd : originalValueTwd;
    const currentSleeveWeight = typeValueTwd > 0 ? row.currentValueTwd / typeValueTwd : 0;
    const targetSleeveWeight = allocationModes[assetType] === "custom" && targetWeightTotals[assetType] > 0
      ? row.targetWeightPct / targetWeightTotals[assetType]
      : null;
    return {
      id: row.id,
      tickerInput: row.tickerInput,
      normalizedTicker: row.normalizedTicker,
      shares: row.shares,
      assetBeta: row.assetBeta,
      price: row.quote.price,
      currency: row.quote.currency,
      priceTwd: row.quote.priceTwd,
      date: row.quote.date,
      source: row.quote.source,
      currentValueTwd: row.currentValueTwd,
      currentWeight,
      currentSleeveWeight: roundRatio(currentSleeveWeight),
      targetWeightPct: row.targetWeightPct,
      targetSleeveWeight: targetSleeveWeight === null ? null : roundRatio(targetSleeveWeight),
      allocationMode: allocationModes[assetType] === "custom" ? "custom" : "auto",
      betaContribution: currentWeight * row.assetBeta,
    };
  });

  const currentBeta = roundRatio(
    recommendations.reduce(
      (sum, row) => sum + row.currentWeight * row.assetBeta,
      0,
    ),
  );
  const betaDrift = roundRatio(currentBeta - targetBetaValue);
  const afterStockRatio = roundRatio(targetStockRatio);
  const afterCashRatio = roundRatio(Math.max(targetCashRatio, 0));
  const afterBeta = targetBetaValue;

  return {
    isValid: issues.length === 0,
    errors: issues.map((issue) => issue.message),
    issues,
    totalAssetsTwd,
    stockValueTwd,
    leveragedValueTwd,
    originalValueTwd,
    cashTwd: roundMoney(toNumber(cashTwd)),
    realCashTwd,
    cashEquivalentValueTwd,
    cashSleeveValueTwd,
    stockRatio: totalAssetsTwd > 0 ? stockValueTwd / totalAssetsTwd : 0,
    leveragedRatio: totalAssetsTwd > 0 ? leveragedValueTwd / totalAssetsTwd : 0,
    originalRatio: totalAssetsTwd > 0 ? originalValueTwd / totalAssetsTwd : 0,
    cashRatio: totalAssetsTwd > 0 ? cashSleeveValueTwd / totalAssetsTwd : 0,
    currentBeta,
    targetBeta: targetBetaValue,
    targetLeveragedBeta,
    tolerancePct: toNumber(tolerancePct),
    betaDrift,
    betaLower,
    betaUpper,
    needsRebalance: currentBeta < betaLower || currentBeta > betaUpper,
    afterStockRatio,
    afterCashRatio,
    targetLeveragedRatio,
    targetOriginalRatio,
    leveragedTargetPct: roundRatio(Math.max(targetLeveragedRatio, 0) * 100),
    originalTargetPct: roundRatio(Math.max(targetOriginalRatio, 0) * 100),
    leveragedTradeAmountTwd,
    originalTradeAmountTwd,
    cashTradeAmountTwd,
    targetCashSleeveValueTwd,
    targetRealCashTwd,
    cashEquivalentRecommendations,
    afterBeta,
    totalTradeAmountTwd: roundMoney(Math.abs(leveragedTradeAmountTwd) + Math.abs(originalTradeAmountTwd)),
    recommendations,
  };
}
