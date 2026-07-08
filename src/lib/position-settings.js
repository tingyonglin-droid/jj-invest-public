function isOriginalPosition(position) {
  return Number(position?.assetBeta) === 1;
}

export function getPositionGroups(positions) {
  return {
    leveraged: positions.filter((position) => !isOriginalPosition(position)),
    original: positions.filter(isOriginalPosition),
  };
}

export function getPositionGroupTargetStatus({ positions, targetRatio }) {
  const totalPct = positions.reduce(
    (sum, position) => sum + (Number(position.targetWeightPct) || 0),
    0,
  );
  const isRequired = Number(targetRatio) > 0.0001;
  const isValid = !isRequired || Math.abs(totalPct - 100) <= 0.01;

  return {
    totalPct,
    isRequired,
    isValid,
  };
}
