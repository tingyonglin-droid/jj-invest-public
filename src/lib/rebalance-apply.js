const TAIWAN_LOT_SIZE = 1000;

function roundCash(value) {
  return Math.round(value + Number.EPSILON);
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundSigned(value, unit) {
  if (!Number.isFinite(value) || value === 0 || unit <= 0) {
    return 0;
  }
  return Math.sign(value) * Math.round(Math.abs(value) / unit) * unit;
}

export function isTaiwanTicker(normalizedTicker) {
  return String(normalizedTicker || "").toUpperCase().endsWith(".TW");
}

export function getRebalanceShareDelta(recommendation, precision = "shares") {
  if (
    !recommendation ||
    !Number.isFinite(recommendation.tradeAmountTwd) ||
    !Number.isFinite(recommendation.priceTwd) ||
    recommendation.priceTwd <= 0
  ) {
    return 0;
  }

  const unit =
    precision === "lots" && isTaiwanTicker(recommendation.normalizedTicker)
      ? TAIWAN_LOT_SIZE
      : 1;
  return roundSigned(recommendation.tradeAmountTwd / recommendation.priceTwd, unit);
}

export function getAppliedRebalanceShareDelta(recommendation, precision = "shares") {
  const requestedDeltaShares = getRebalanceShareDelta(recommendation, precision);
  const currentShares = toNumber(recommendation?.shares);

  return Math.max(requestedDeltaShares, -currentShares);
}

export function getCashSleeveValueAfterStockTrades({
  recommendations,
  totalAssetsTwd,
  precision = "shares",
}) {
  const appliedStockValueTwd = recommendations.reduce((sum, recommendation) => {
    const afterValueTwd = Math.max(
      toNumber(recommendation.currentValueTwd) +
        getAppliedRebalanceShareDelta(recommendation, precision) *
          toNumber(recommendation.priceTwd),
      0,
    );
    return sum + afterValueTwd;
  }, 0);

  return roundCash(Math.max(toNumber(totalAssetsTwd) - appliedStockValueTwd, 0));
}

export function createFundedRebalanceRecommendations({
  recommendations,
  precision = "shares",
  cashTwd,
  minimumCashTwd = 0,
  cashTargetStrategy = "floor",
}) {
  const appliedDeltas = new Map(
    recommendations.map((recommendation) => [
      recommendation.id,
      getAppliedRebalanceShareDelta(recommendation, precision),
    ]),
  );
  const netTradeCost = recommendations.reduce(
    (sum, recommendation) =>
      sum + toNumber(appliedDeltas.get(recommendation.id)) * toNumber(recommendation.priceTwd),
    0,
  );
  let projectedCashTwd = toNumber(cashTwd) - netTradeCost;
  let deficit = roundCash(
    Math.max(toNumber(minimumCashTwd) - projectedCashTwd, 0),
  );

  const buys = recommendations
    .filter((recommendation) => toNumber(appliedDeltas.get(recommendation.id)) > 0)
    .sort((left, right) => {
      const leftPriority = left.assetType === "cashEquivalent" ? 0 : 1;
      const rightPriority = right.assetType === "cashEquivalent" ? 0 : 1;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return Math.abs(toNumber(right.tradeAmountTwd)) - Math.abs(toNumber(left.tradeAmountTwd));
    });

  for (const recommendation of buys) {
    if (deficit <= 0) {
      break;
    }
    const shareUnit = precision === "lots" && isTaiwanTicker(recommendation.normalizedTicker)
      ? TAIWAN_LOT_SIZE
      : 1;
    const unitCost = shareUnit * toNumber(recommendation.priceTwd);
    if (unitCost <= 0) {
      continue;
    }
    const currentDelta = toNumber(appliedDeltas.get(recommendation.id));
    const availableUnits = Math.floor(currentDelta / shareUnit);
    let unitsToRemove = Math.min(availableUnits, Math.ceil(deficit / unitCost));

    if (
      cashTargetStrategy === "nearest" &&
      recommendation.assetType === "cashEquivalent"
    ) {
      unitsToRemove = 0;
      while (unitsToRemove < availableUnits && projectedCashTwd < toNumber(minimumCashTwd)) {
        const candidateCashTwd = projectedCashTwd + unitCost;
        const candidateIsCloser =
          Math.abs(toNumber(minimumCashTwd) - candidateCashTwd) <
          Math.abs(toNumber(minimumCashTwd) - projectedCashTwd);
        if (projectedCashTwd >= 0 && !candidateIsCloser) {
          break;
        }
        unitsToRemove += 1;
        projectedCashTwd = candidateCashTwd;
      }
    } else {
      projectedCashTwd += unitsToRemove * unitCost;
    }
    appliedDeltas.set(
      recommendation.id,
      currentDelta - unitsToRemove * shareUnit,
    );
    deficit = roundCash(Math.max(toNumber(minimumCashTwd) - projectedCashTwd, 0));
  }

  return recommendations.map((recommendation) => ({
    ...recommendation,
    tradeAmountTwd:
      toNumber(appliedDeltas.get(recommendation.id)) * toNumber(recommendation.priceTwd),
  }));
}

export function getAppliedRebalanceSummary({ recommendations, precision = "shares" }) {
  const summary = recommendations.reduce(
    (summary, recommendation) => {
      const appliedDeltaShares = getAppliedRebalanceShareDelta(recommendation, precision);
      if (appliedDeltaShares === 0) {
        return summary;
      }

      const appliedAmountTwd = appliedDeltaShares * toNumber(recommendation.priceTwd);
      const sleeveKey = recommendation.assetType === "cashEquivalent"
        ? "cashEquivalentNetAmountTwd"
        : toNumber(recommendation.assetBeta) > 1
          ? "leveragedNetAmountTwd"
          : "originalNetAmountTwd";

      return {
        ...summary,
        actionCount: summary.actionCount + 1,
        totalAmountTwd: roundCash(
          summary.totalAmountTwd + Math.abs(appliedAmountTwd),
        ),
        [sleeveKey]: summary[sleeveKey] + appliedAmountTwd,
      };
    },
    {
      actionCount: 0,
      totalAmountTwd: 0,
      leveragedNetAmountTwd: 0,
      originalNetAmountTwd: 0,
      cashEquivalentNetAmountTwd: 0,
    },
  );

  return {
    ...summary,
    leveragedNetAmountTwd: roundCash(summary.leveragedNetAmountTwd),
    originalNetAmountTwd: roundCash(summary.originalNetAmountTwd),
    cashEquivalentNetAmountTwd: roundCash(summary.cashEquivalentNetAmountTwd),
    cashDeltaTwd: roundCash(
      -(
        summary.leveragedNetAmountTwd +
        summary.originalNetAmountTwd +
        summary.cashEquivalentNetAmountTwd
      ),
    ),
  };
}

export function applyRebalanceToState({
  positions,
  cashEquivalentPositions = [],
  cashTwd,
  recommendations,
  precision,
}) {
  const recommendationById = new Map(
    recommendations.map((recommendation) => [recommendation.id, recommendation]),
  );
  let cashDeltaTwd = 0;

  const applyPositions = (sourcePositions) => sourcePositions.map((position) => {
    const recommendation = recommendationById.get(position.id);
    if (!recommendation) {
      return position;
    }

    const currentShares = toNumber(position.shares);
    const appliedDeltaShares = getAppliedRebalanceShareDelta(
      {
        ...recommendation,
        shares: currentShares,
      },
      precision,
    );

    cashDeltaTwd += appliedDeltaShares * recommendation.priceTwd;

    return {
      ...position,
      shares: currentShares + appliedDeltaShares,
    };
  });

  const nextPositions = applyPositions(positions);
  const nextCashEquivalentPositions = applyPositions(cashEquivalentPositions);

  return {
    positions: nextPositions,
    cashEquivalentPositions: nextCashEquivalentPositions,
    cashTwd: roundCash(toNumber(cashTwd) - cashDeltaTwd),
  };
}
