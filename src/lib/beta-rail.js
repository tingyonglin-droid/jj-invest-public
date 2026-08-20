const FULL_SCALE_MIN = 0;
const FULL_SCALE_MAX = 3;

function roundPct(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function clampPct(value) {
  return Math.min(Math.max(value, 0), 100);
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundScaleValue(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function createEvenTicks(scaleMin, scaleMax, intervalCount) {
  const interval = (scaleMax - scaleMin) / intervalCount;
  return Array.from(
    { length: intervalCount + 1 },
    (_, index) => roundScaleValue(scaleMin + interval * index),
  );
}

function getDynamicScale(values, targetBeta) {
  const centeredRanges = [
    { halfSpan: 0.3, intervalCount: 3 },
    { halfSpan: 0.5, intervalCount: 4 },
  ];

  for (const range of centeredRanges) {
    const scaleMin = roundScaleValue(targetBeta - range.halfSpan);
    const scaleMax = roundScaleValue(targetBeta + range.halfSpan);
    const fitsFullScale = scaleMin >= FULL_SCALE_MIN && scaleMax <= FULL_SCALE_MAX;
    const containsValues = values.every((value) => value >= scaleMin && value <= scaleMax);

    if (fitsFullScale && containsValues) {
      return {
        scaleMin,
        scaleMax,
        scaleTicks: createEvenTicks(scaleMin, scaleMax, range.intervalCount),
      };
    }
  }

  if (values.every((value) => value >= 0 && value <= 2)) {
    return {
      scaleMin: 0,
      scaleMax: 2,
      scaleTicks: [0, 0.5, 1, 1.5, 2],
    };
  }

  return {
    scaleMin: FULL_SCALE_MIN,
    scaleMax: FULL_SCALE_MAX,
    scaleTicks: [0, 1, 2, 3],
  };
}

export function createBetaRailModel({
  currentBeta,
  targetBeta,
  betaLower,
  betaUpper,
}) {
  const normalizedTarget = toFiniteNumber(targetBeta);
  const values = [currentBeta, targetBeta, betaLower, betaUpper].map(toFiniteNumber);
  const { scaleMin, scaleMax, scaleTicks } = getDynamicScale(values, normalizedTarget);

  function toPct(value) {
    const range = scaleMax - scaleMin;
    return roundPct(clampPct(((toFiniteNumber(value) - scaleMin) / range) * 100));
  }

  return {
    scaleMin,
    scaleMax,
    scaleTicks,
    lowerPct: toPct(betaLower),
    targetPct: toPct(targetBeta),
    upperPct: toPct(betaUpper),
    currentPct: toPct(currentBeta),
  };
}
