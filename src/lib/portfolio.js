import { normalizeTicker } from "./market-data.js";

const MONEY_PRECISION = 100;
const RATIO_PRECISION = 10000;
const TARGET_WEIGHT_TOLERANCE_PCT = 0.01;

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

export function calculatePortfolio({
  positions,
  quotes,
  cashTwd,
  targetBeta,
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
  const targetWeightTotalPct = normalizedPositions.reduce(
    (sum, position) => sum + position.targetWeightPct,
    0,
  );
  const errors = [];

  if (Math.abs(targetWeightTotalPct - 100) > TARGET_WEIGHT_TOLERANCE_PCT) {
    errors.push("正二內目標比例總和必須等於 100%。");
  }

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
  const totalAssetsTwd = roundMoney(stockValueTwd + toNumber(cashTwd));
  const targetBetaValue = toNumber(targetBeta);
  const tolerance = toNumber(tolerancePct) / 100;
  const betaLower = roundRatio(targetBetaValue * (1 - tolerance));
  const betaUpper = roundRatio(targetBetaValue * (1 + tolerance));
  const targetSleeveWeightTotal = targetWeightTotalPct > 0 ? targetWeightTotalPct : 0;
  const weightedTargetAssetBeta =
    targetSleeveWeightTotal > 0
      ? normalizedPositions.reduce(
          (sum, position) =>
            sum + (position.targetWeightPct / targetSleeveWeightTotal) * position.assetBeta,
          0,
        )
      : 0;
  const targetStockRatio =
    weightedTargetAssetBeta > 0
      ? Math.min(Math.max(targetBetaValue / weightedTargetAssetBeta, 0), 1)
      : 0;
  const targetCashRatio = 1 - targetStockRatio;

  const recommendations = validRows.map((row) => {
    const currentWeight = totalAssetsTwd > 0 ? row.currentValueTwd / totalAssetsTwd : 0;
    const currentSleeveWeight = stockValueTwd > 0 ? row.currentValueTwd / stockValueTwd : 0;
    const targetSleeveWeight =
      targetSleeveWeightTotal > 0 ? row.targetWeightPct / targetSleeveWeightTotal : 0;
    const targetWeight = targetStockRatio * targetSleeveWeight;
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
  const afterCashRatio = roundRatio(targetCashRatio);
  const afterBeta = roundRatio(targetStockRatio * weightedTargetAssetBeta);
  const totalTradeAmountTwd = roundMoney(
    recommendations.reduce((sum, row) => sum + row.tradeAmountTwd, 0),
  );

  return {
    isValid: errors.length === 0,
    errors,
    totalAssetsTwd,
    stockValueTwd,
    cashTwd: roundMoney(toNumber(cashTwd)),
    stockRatio: totalAssetsTwd > 0 ? stockValueTwd / totalAssetsTwd : 0,
    cashRatio: totalAssetsTwd > 0 ? toNumber(cashTwd) / totalAssetsTwd : 0,
    currentBeta,
    targetBeta: targetBetaValue,
    betaDrift,
    betaLower,
    betaUpper,
    needsRebalance: currentBeta < betaLower || currentBeta > betaUpper,
    afterStockRatio,
    afterCashRatio,
    afterBeta,
    totalTradeAmountTwd,
    targetWeightTotalPct,
    recommendations,
  };
}
