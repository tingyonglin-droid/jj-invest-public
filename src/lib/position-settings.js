function isOriginalPosition(position) {
  if (position?.assetBeta === "" || position?.assetBeta == null) {
    return position?.assetTypeHint !== "leveraged";
  }
  return Number(position?.assetBeta) <= 1;
}

export function adjustBoundedSettingValue(value, delta, {
  min,
  max,
  digits,
  fallback = min,
}) {
  const numericValue = value === "" || !Number.isFinite(Number(value))
    ? Number(fallback)
    : Number(value);
  const boundedValue = Math.min(Math.max(numericValue + Number(delta), min), max);
  return Number(boundedValue.toFixed(digits));
}

export function getPositionGroups(positions) {
  return {
    leveraged: positions.filter((position) => !isOriginalPosition(position)),
    original: positions.filter(isOriginalPosition),
  };
}

export function removePositionFromSettings(state, id) {
  const removedPosition = state.positions.find((position) => position.id === id);
  if (!removedPosition) {
    return state;
  }

  const positions = state.positions.filter((position) => position.id !== id);
  const removedLastOriginal = isOriginalPosition(removedPosition)
    && !positions.some(isOriginalPosition);

  return {
    ...state,
    positions,
    ...(removedLastOriginal
      ? {
          originalAllocationMode: "current",
          originalTargetPct: 0,
          allocationModes: { ...state.allocationModes, original: "auto" },
        }
      : {}),
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
