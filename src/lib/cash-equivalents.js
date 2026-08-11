function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampPercent(value, fallback = 0) {
  return Math.min(Math.max(toNumber(value, fallback), 0), 100);
}

export function getCashEquivalentTargetStatus({
  mode,
  positions = [],
  realCashTargetPct = 10,
}) {
  if (mode !== "custom") {
    return { isValid: true, totalPct: 100 };
  }

  const totalPct = positions.reduce(
    (sum, position) => sum + clampPercent(position.targetWeightPct),
    clampPercent(realCashTargetPct),
  );
  const roundedTotal = Math.round((totalPct + Number.EPSILON) * 100) / 100;

  return { isValid: Math.abs(roundedTotal - 100) < 0.01, totalPct: roundedTotal };
}

export function getCashSleeveTargets({
  mode,
  positions = [],
  realCashTargetPct = 10,
}) {
  if (positions.length === 0) {
    return { realCashRatio: 1, positionRatios: new Map() };
  }

  const realCashRatio = clampPercent(realCashTargetPct, 10) / 100;
  if (mode === "custom") {
    return {
      realCashRatio,
      positionRatios: new Map(
        positions.map((position) => [
          position.id,
          clampPercent(position.targetWeightPct) / 100,
        ]),
      ),
    };
  }

  const positionRatio = (1 - realCashRatio) / positions.length;
  return {
    realCashRatio,
    positionRatios: new Map(positions.map((position) => [position.id, positionRatio])),
  };
}
