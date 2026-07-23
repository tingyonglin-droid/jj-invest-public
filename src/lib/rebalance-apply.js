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

export function getAppliedRebalanceSummary({ recommendations, precision = "shares" }) {
  return recommendations.reduce(
    (summary, recommendation) => {
      const appliedDeltaShares = getAppliedRebalanceShareDelta(recommendation, precision);
      if (appliedDeltaShares === 0) {
        return summary;
      }

      return {
        actionCount: summary.actionCount + 1,
        totalAmountTwd: roundCash(
          summary.totalAmountTwd + Math.abs(appliedDeltaShares * toNumber(recommendation.priceTwd)),
        ),
      };
    },
    { actionCount: 0, totalAmountTwd: 0 },
  );
}

export function applyRebalanceToState({ positions, cashTwd, recommendations, precision }) {
  const recommendationById = new Map(
    recommendations.map((recommendation) => [recommendation.id, recommendation]),
  );
  let cashDeltaTwd = 0;

  const nextPositions = positions.map((position) => {
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

  return {
    positions: nextPositions,
    cashTwd: roundCash(toNumber(cashTwd) - cashDeltaTwd),
  };
}
