import { normalizeTicker } from "./market-data.js";

const MONEY_PRECISION = 100;
const RATIO_PRECISION = 10000;
const TARGET_WEIGHT_TOLERANCE_PCT = 0.01;
const RATIO_TOLERANCE = 0.0001;

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * MONEY_PRECISION) / MONEY_PRECISION;
}

function roundRatio(value) {
  return Math.round((value + Number.EPSILON) * RATIO_PRECISION) / RATIO_PRECISION;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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

export function calculatePortfolio({
  positions,
  quotes,
  cashTwd,
  targetBeta,
  originalTargetPct = 0,
  tolerancePct,
}) {
  const quoteByTicker = new Map(
    quotes.map((quote) => [quote.normalizedTicker, quote]),
  );
  const normalizedPositions = positions.map((position) => ({
    ...position,
    normalizedTicker: normalizeTicker(position.tickerInput),
    shares: toNumber(position.shares),
    assetBeta: toNumber(position.assetBeta),
    targetWeightPct: toNumber(position.targetWeightPct),
  }));
  const leveragedTargetWeightTotalPct = normalizedPositions.reduce(
    (sum, position) =>
      sum + (getAssetType(position.assetBeta) === "leveraged" ? position.targetWeightPct : 0),
    0,
  );
  const originalTargetWeightTotalPct = normalizedPositions.reduce(
    (sum, position) =>
      sum + (getAssetType(position.assetBeta) === "original" ? position.targetWeightPct : 0),
    0,
  );
  const targetWeightTotalPct = normalizedPositions.reduce(
    (sum, position) => sum + position.targetWeightPct,
    0,
  );
  const errors = [];

  const validRows = normalizedPositions
    .map((position) => {
      const quote = quoteByTicker.get(position.normalizedTicker);
      const currentValueTwd =
        quote && !quote.error && typeof quote.priceTwd === "number"
          ? position.shares * quote.priceTwd
          : 0;
      return {
        ...position,
        quote,
        currentValueTwd: roundMoney(currentValueTwd),
      };
    })
    .filter((row) => row.quote && !row.quote.error);

  const stockValueTwd = roundMoney(
    validRows.reduce((sum, row) => sum + row.currentValueTwd, 0),
  );
  const leveragedValueTwd = roundMoney(
    validRows.reduce(
      (sum, row) => sum + (getAssetType(row.assetBeta) === "leveraged" ? row.currentValueTwd : 0),
      0,
    ),
  );
  const originalValueTwd = roundMoney(
    validRows.reduce(
      (sum, row) => sum + (getAssetType(row.assetBeta) === "original" ? row.currentValueTwd : 0),
      0,
    ),
  );
  const totalAssetsTwd = roundMoney(stockValueTwd + toNumber(cashTwd));
  const targetBetaValue = toNumber(targetBeta);
  const originalTargetRatio = Math.min(Math.max(toNumber(originalTargetPct) / 100, 0), 1);
  const targetLeveragedRatio = roundRatio((targetBetaValue - originalTargetRatio) / 2);
  const targetOriginalRatio = roundRatio(originalTargetRatio);
  const targetCashRatio = roundRatio(1 - targetLeveragedRatio - targetOriginalRatio);

  if (targetLeveragedRatio < -RATIO_TOLERANCE || targetCashRatio < -RATIO_TOLERANCE) {
    errors.push("原形目標比例無法搭配目前目標 Beta。");
  }

  if (
    targetLeveragedRatio > RATIO_TOLERANCE &&
    Math.abs(leveragedTargetWeightTotalPct - 100) > TARGET_WEIGHT_TOLERANCE_PCT
  ) {
    errors.push("正二標的目標比例合計必須等於 100%。");
  }

  if (
    targetOriginalRatio > RATIO_TOLERANCE &&
    Math.abs(originalTargetWeightTotalPct - 100) > TARGET_WEIGHT_TOLERANCE_PCT
  ) {
    errors.push("原形標的目標比例合計必須等於 100%。");
  }

  const tolerance = toNumber(tolerancePct) / 100;
  const betaLower = roundRatio(targetBetaValue * (1 - tolerance));
  const betaUpper = roundRatio(targetBetaValue * (1 + tolerance));
  const targetStockRatio = Math.max(targetLeveragedRatio, 0) + Math.max(targetOriginalRatio, 0);

  const recommendations = validRows.map((row) => {
    const currentWeight = totalAssetsTwd > 0 ? row.currentValueTwd / totalAssetsTwd : 0;
    const assetType = getAssetType(row.assetBeta);
    const typeValueTwd = assetType === "leveraged" ? leveragedValueTwd : originalValueTwd;
    const typeTargetWeightTotalPct =
      assetType === "leveraged" ? leveragedTargetWeightTotalPct : originalTargetWeightTotalPct;
    const typeTargetRatio = assetType === "leveraged" ? targetLeveragedRatio : targetOriginalRatio;
    const currentSleeveWeight = typeValueTwd > 0 ? row.currentValueTwd / typeValueTwd : 0;
    const targetSleeveWeight =
      typeTargetWeightTotalPct > 0 ? row.targetWeightPct / typeTargetWeightTotalPct : 0;
    const targetWeight = Math.max(typeTargetRatio, 0) * targetSleeveWeight;
    const targetValueTwd = roundMoney(totalAssetsTwd * targetWeight);
    const tradeAmountTwd = roundMoney(targetValueTwd - row.currentValueTwd);
    return {
      id: row.id,
      tickerInput: row.tickerInput,
      normalizedTicker: row.normalizedTicker,
      shares: row.shares,
      assetBeta: row.assetBeta,
      targetWeightPct: row.targetWeightPct,
      price: row.quote.price,
      currency: row.quote.currency,
      priceTwd: row.quote.priceTwd,
      date: row.quote.date,
      source: row.quote.source,
      currentValueTwd: row.currentValueTwd,
      currentWeight,
      currentSleeveWeight: roundRatio(currentSleeveWeight),
      targetSleeveWeight: roundRatio(targetSleeveWeight),
      targetWeight,
      betaContribution: currentWeight * row.assetBeta,
      targetValueTwd,
      tradeAmountTwd,
      action: getAction(tradeAmountTwd),
    };
  });

  const currentBeta = roundRatio(
    recommendations.reduce(
      (sum, row) => sum + row.currentWeight * row.assetBeta,
      0,
    ),
  );
  const betaDrift = roundRatio(currentBeta - targetBetaValue);
  const afterStockRatio = roundRatio(targetStockRatio);
  const afterCashRatio = roundRatio(Math.max(targetCashRatio, 0));
  const afterBeta = roundRatio(Math.max(targetLeveragedRatio, 0) * 2 + targetOriginalRatio);
  const totalTradeAmountTwd = roundMoney(
    recommendations.reduce((sum, row) => sum + row.tradeAmountTwd, 0),
  );

  return {
    isValid: errors.length === 0,
    errors,
    totalAssetsTwd,
    stockValueTwd,
    leveragedValueTwd,
    originalValueTwd,
    cashTwd: roundMoney(toNumber(cashTwd)),
    stockRatio: totalAssetsTwd > 0 ? stockValueTwd / totalAssetsTwd : 0,
    leveragedRatio: totalAssetsTwd > 0 ? leveragedValueTwd / totalAssetsTwd : 0,
    originalRatio: totalAssetsTwd > 0 ? originalValueTwd / totalAssetsTwd : 0,
    cashRatio: totalAssetsTwd > 0 ? toNumber(cashTwd) / totalAssetsTwd : 0,
    currentBeta,
    targetBeta: targetBetaValue,
    tolerancePct: toNumber(tolerancePct),
    betaDrift,
    betaLower,
    betaUpper,
    needsRebalance: currentBeta < betaLower || currentBeta > betaUpper,
    afterStockRatio,
    afterCashRatio,
    targetLeveragedRatio,
    targetOriginalRatio,
    originalTargetPct: toNumber(originalTargetPct),
    leveragedTargetWeightTotalPct,
    originalTargetWeightTotalPct,
    afterBeta,
    totalTradeAmountTwd,
    targetWeightTotalPct,
    recommendations,
  };
}
