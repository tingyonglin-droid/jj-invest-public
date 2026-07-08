function formatSignedNumber(value) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return `${safeValue >= 0 ? "+" : ""}${safeValue.toFixed(2)}`;
}

function formatSignedPercent(value) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return `${safeValue >= 0 ? "+" : ""}${safeValue.toFixed(2)}%`;
}

function formatPercentValue(value) {
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;
  return `${safeValue.toLocaleString("zh-TW", {
    maximumFractionDigits: 2,
  })}%`;
}

export function createBetaSummary({ currentBeta, targetBeta, tolerancePct }) {
  const drift = currentBeta - targetBeta;
  const driftPercent = targetBeta === 0 ? 0 : (drift / targetBeta) * 100;

  return {
    driftValue: formatSignedNumber(drift),
    driftPercent: formatSignedPercent(driftPercent),
    toleranceText: formatPercentValue(tolerancePct),
  };
}
