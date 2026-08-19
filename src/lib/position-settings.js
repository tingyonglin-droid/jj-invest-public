function isOriginalPosition(position) {
  if (position?.assetBeta === "" || position?.assetBeta == null) {
    return position?.assetTypeHint !== "leveraged";
  }
  return Number(position?.assetBeta) <= 1;
}

export function getPositionGroups(positions) {
  return {
    leveraged: positions.filter((position) => !isOriginalPosition(position)),
    original: positions.filter(isOriginalPosition),
  };
}

export function getPositionGroupTargetStatus({ mode, positions }) {
  const totalPct = positions.reduce(
    (sum, position) => sum + (Number(position.targetWeightPct) || 0),
    0,
  );
  return {
    totalPct: Math.round((totalPct + Number.EPSILON) * 100) / 100,
    isValid: mode !== "custom" || positions.length === 0 || (
      positions.every((position) => {
        const weight = Number(position.targetWeightPct);
        return Number.isFinite(weight) && weight >= 0 && weight <= 100;
      }) && Math.abs(totalPct - 100) <= 0.01
    ),
  };
}

export function initializePositionTargetWeights(positions) {
  if (positions.length === 0) {
    return [];
  }
  const totalValue = positions.reduce(
    (sum, position) => sum + Math.max(Number(position.currentValueTwd) || 0, 0),
    0,
  );
  let allocated = 0;
  return positions.map((position, index) => {
    const targetWeightPct = index === positions.length - 1
      ? Math.round((100 - allocated + Number.EPSILON) * 100) / 100
      : Math.round(((totalValue > 0
        ? Math.max(Number(position.currentValueTwd) || 0, 0) / totalValue
        : 1 / positions.length) * 100 + Number.EPSILON) * 100) / 100;
    allocated += targetWeightPct;
    return { ...position, targetWeightPct };
  });
}
