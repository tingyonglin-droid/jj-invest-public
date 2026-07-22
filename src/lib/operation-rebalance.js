import { getAppliedRebalanceShareDelta } from "./rebalance-apply.js";

const MONEY_PRECISION = 100;
const RATIO_PRECISION = 10000;
const SMART_SEARCH_STEP = 0.001;
const SMART_SEARCH_MIN = 0;
const SMART_SEARCH_MAX = 2;

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * MONEY_PRECISION) / MONEY_PRECISION;
}

function roundRatio(value) {
  return Math.round((value + Number.EPSILON) * RATIO_PRECISION) / RATIO_PRECISION;
}

function getAction(amount) {
  if (amount > 0.5) {
    return "buy";
  }
  if (amount < -0.5) {
    return "sell";
  }
  return "none";
}

function getAssetType(assetBeta) {
  return toNumber(assetBeta) >= 1.5 ? "leveraged" : "original";
}

export function normalizeSelectedRebalanceIds({
  currentIds,
  previousSelectedIds,
  previousKnownIds = null,
}) {
  const current = currentIds.map(String);

  if (!previousKnownIds) {
    return current;
  }

  const currentSet = new Set(current);
  const knownSet = new Set(previousKnownIds.map(String));
  const selectedSet = new Set(
    previousSelectedIds.map(String).filter((id) => currentSet.has(id)),
  );

  current.forEach((id) => {
    if (!knownSet.has(id)) {
      selectedSet.add(id);
    }
  });

  return current.filter((id) => selectedSet.has(id));
}

export function createOperationRebalance({
  recommendations,
  selectedIds,
  totalAssetsTwd,
  targetBeta,
  originalTargetRatio,
  precision = null,
}) {
  if (precision) {
    return createSmartOperationRebalance({
      recommendations,
      selectedIds,
      totalAssetsTwd,
      targetBeta,
      originalTargetRatio,
      precision,
    });
  }

  return createOperationRebalanceForTarget({
    recommendations,
    selectedIds,
    totalAssetsTwd,
    targetBeta,
    originalTargetRatio,
  });
}

function createSmartOperationRebalance({
  recommendations,
  selectedIds,
  totalAssetsTwd,
  targetBeta,
  originalTargetRatio,
  precision,
}) {
  const desiredBeta = toNumber(targetBeta);
  let bestResult = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestTradeAmount = Number.POSITIVE_INFINITY;

  for (
    let candidateBeta = SMART_SEARCH_MIN;
    candidateBeta <= SMART_SEARCH_MAX + Number.EPSILON;
    candidateBeta = roundRatio(candidateBeta + SMART_SEARCH_STEP)
  ) {
    const result = createOperationRebalanceForTarget({
      recommendations,
      selectedIds,
      totalAssetsTwd,
      targetBeta: candidateBeta,
      originalTargetRatio,
    });
    const appliedAfterBeta = calculateAppliedAfterBeta({
      recommendations: result.recommendations,
      precision,
      totalAssetsTwd,
    });
    const appliedTradeAmount = calculateAppliedTradeAmount({
      recommendations: result.recommendations,
      precision,
    });
    const distance = Math.abs(appliedAfterBeta - desiredBeta);

    if (
      distance < bestDistance - Number.EPSILON ||
      (Math.abs(distance - bestDistance) <= Number.EPSILON &&
        appliedTradeAmount < bestTradeAmount)
    ) {
      bestDistance = distance;
      bestTradeAmount = appliedTradeAmount;
      bestResult = {
        ...result,
        appliedAfterBeta,
        correctedTargetBeta: candidateBeta,
      };
    }
  }

  return bestResult ?? createOperationRebalanceForTarget({
    recommendations,
    selectedIds,
    totalAssetsTwd,
    targetBeta,
    originalTargetRatio,
  });
}

function calculateAppliedTradeAmount({ recommendations, precision }) {
  return roundMoney(
    recommendations.reduce(
      (sum, item) =>
        sum + Math.abs(getAppliedRebalanceShareDelta(item, precision) * item.priceTwd),
      0,
    ),
  );
}

function calculateAppliedAfterBeta({ recommendations, precision, totalAssetsTwd }) {
  const totalAssets = toNumber(totalAssetsTwd);
  if (totalAssets <= 0) {
    return 0;
  }

  return roundRatio(
    recommendations.reduce((sum, item) => {
      const appliedDeltaShares = getAppliedRebalanceShareDelta(item, precision);
      const afterValueTwd = Math.max(
        toNumber(item.currentValueTwd) + appliedDeltaShares * toNumber(item.priceTwd),
        0,
      );

      return sum + (afterValueTwd / totalAssets) * toNumber(item.assetBeta);
    }, 0),
  );
}

function createOperationRebalanceForTarget({
  recommendations,
  selectedIds,
  totalAssetsTwd,
  targetBeta,
  originalTargetRatio,
}) {
  const selectedSet = new Set(selectedIds.map(String));
  const totalAssets = toNumber(totalAssetsTwd);
  const originalRatio = Math.min(Math.max(toNumber(originalTargetRatio), 0), 1);
  const leveragedRatio = roundRatio((toNumber(targetBeta) - originalRatio) / 2);
  const targetRatios = {
    leveraged: Math.max(leveragedRatio, 0),
    original: Math.max(originalRatio, 0),
  };
  const warnings = [];

  const rowsByType = {
    leveraged: recommendations.filter((item) => getAssetType(item.assetBeta) === "leveraged"),
    original: recommendations.filter((item) => getAssetType(item.assetBeta) === "original"),
  };
  const nextTargetValues = new Map();
  let isReachable = true;

  Object.entries(rowsByType).forEach(([assetType, rows]) => {
    const selectedRows = rows.filter((row) => selectedSet.has(String(row.id)));
    const unselectedRows = rows.filter((row) => !selectedSet.has(String(row.id)));
    const targetTypeValue = roundMoney(totalAssets * targetRatios[assetType]);
    const unselectedValue = roundMoney(
      unselectedRows.reduce((sum, row) => sum + toNumber(row.currentValueTwd), 0),
    );
    const remainingTargetValue = roundMoney(targetTypeValue - unselectedValue);

    if (selectedRows.length === 0) {
      const currentTypeValue = roundMoney(
        rows.reduce((sum, row) => sum + toNumber(row.currentValueTwd), 0),
      );
      if (Math.abs(currentTypeValue - targetTypeValue) > 0.5) {
        isReachable = false;
      }
      rows.forEach((row) => nextTargetValues.set(row.id, toNumber(row.currentValueTwd)));
      return;
    }

    if (remainingTargetValue < -0.5) {
      isReachable = false;
    }

    const safeRemainingTargetValue = Math.max(remainingTargetValue, 0);
    const selectedTargetWeightTotal = selectedRows.reduce(
      (sum, row) => sum + toNumber(row.targetWeightPct),
      0,
    );

    selectedRows.forEach((row) => {
      const selectedWeight =
        selectedTargetWeightTotal > 0
          ? toNumber(row.targetWeightPct) / selectedTargetWeightTotal
          : 1 / selectedRows.length;
      nextTargetValues.set(row.id, roundMoney(safeRemainingTargetValue * selectedWeight));
    });

    unselectedRows.forEach((row) => {
      nextTargetValues.set(row.id, toNumber(row.currentValueTwd));
    });
  });

  if (!isReachable) {
    warnings.push("目前勾選範圍無法完全達成指定 Beta。");
  }

  const nextRecommendations = recommendations.map((item) => {
    const isSelected = selectedSet.has(String(item.id));
    const targetValueTwd = roundMoney(nextTargetValues.get(item.id) ?? item.currentValueTwd);
    const tradeAmountTwd = isSelected
      ? roundMoney(targetValueTwd - toNumber(item.currentValueTwd))
      : 0;
    return {
      ...item,
      isSelected,
      targetValueTwd,
      tradeAmountTwd,
      action: getAction(tradeAmountTwd),
    };
  });

  const afterTypeValues = {
    leveraged: roundMoney(
      nextRecommendations.reduce(
        (sum, row) =>
          sum + (getAssetType(row.assetBeta) === "leveraged" ? row.targetValueTwd : 0),
        0,
      ),
    ),
    original: roundMoney(
      nextRecommendations.reduce(
        (sum, row) =>
          sum + (getAssetType(row.assetBeta) === "original" ? row.targetValueTwd : 0),
        0,
      ),
    ),
  };

  const recommendationsWithAfterWeights = nextRecommendations.map((item) => {
    const assetType = getAssetType(item.assetBeta);
    const afterTypeValue = afterTypeValues[assetType];
    return {
      ...item,
      afterSleeveWeight:
        afterTypeValue > 0 ? roundRatio(item.targetValueTwd / afterTypeValue) : 0,
    };
  });
  const summaryRows = recommendationsWithAfterWeights.filter(
    (item) => item.action !== "none" && Math.abs(item.tradeAmountTwd) > 0.5,
  );
  const afterBeta = roundRatio(
    recommendationsWithAfterWeights.reduce(
      (sum, item) => sum + (item.targetValueTwd / totalAssets) * toNumber(item.assetBeta),
      0,
    ),
  );

  return {
    recommendations: recommendationsWithAfterWeights,
    totalAssetsTwd: totalAssets,
    appliedAfterBeta: null,
    correctedTargetBeta: toNumber(targetBeta),
    summary: {
      actionCount: summaryRows.length,
      totalAmountTwd: roundMoney(
        summaryRows.reduce((sum, item) => sum + Math.abs(item.tradeAmountTwd), 0),
      ),
    },
    afterBeta,
    isReachable,
    warnings,
  };
}
