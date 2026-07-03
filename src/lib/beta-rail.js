const SCALE_MIN = 0;
const SCALE_MAX = 2;

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

export function createBetaRailModel({
  currentBeta,
  targetBeta,
  betaLower,
  betaUpper,
}) {
  function toPct(value) {
    const range = SCALE_MAX - SCALE_MIN;
    return roundPct(clampPct(((toFiniteNumber(value) - SCALE_MIN) / range) * 100));
  }

  return {
    scaleMin: SCALE_MIN,
    scaleMax: SCALE_MAX,
    lowerPct: toPct(betaLower),
    targetPct: toPct(targetBeta),
    upperPct: toPct(betaUpper),
    currentPct: toPct(currentBeta),
  };
}
