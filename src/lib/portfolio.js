import { normalizeTicker } from "./market-data.js";

const MONEY_PRECISION = 100;
const RATIO_PRECISION = 10000;
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

function getAssetType(assetBeta) {
  return toNumber(assetBeta) >= 1.5 ? "leveraged" : "original";
}

export function calculatePortfolio({
  positions,
  quotes,
  cashTwd,
  leveragedTargetPct = 0,
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
  }));
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
  const originalTargetRatio = Math.min(Math.max(toNumber(originalTargetPct) / 100, 0), 1);
  const targetLeveragedRatio = Math.min(
    Math.max(toNumber(leveragedTargetPct) / 100, 0),
    1,
  );
  const targetOriginalRatio = roundRatio(originalTargetRatio);
  const targetCashRatio = roundRatio(1 - targetLeveragedRatio - targetOriginalRatio);
  const targetBetaValue = roundRatio(targetLeveragedRatio * 2 + targetOriginalRatio);

  if (targetCashRatio < -RATIO_TOLERANCE) {
    errors.push("正二與原形目標比例合計不能超過 100%。");
  }

  if (targetLeveragedRatio > RATIO_TOLERANCE && validRows.every((row) => getAssetType(row.assetBeta) !== "leveraged")) {
    errors.push("正二目標比例大於 0 時，請新增至少一個正二標的。");
  }

  if (targetOriginalRatio > RATIO_TOLERANCE && validRows.every((row) => getAssetType(row.assetBeta) !== "original")) {
    errors.push("原形目標比例大於 0 時，請新增至少一個原形標的。");
  }

  const tolerance = toNumber(tolerancePct) / 100;
  const betaLower = roundRatio(targetBetaValue * (1 - tolerance));
  const betaUpper = roundRatio(targetBetaValue * (1 + tolerance));
  const targetStockRatio = Math.max(targetLeveragedRatio, 0) + Math.max(targetOriginalRatio, 0);

  const targetLeveragedValueTwd = roundMoney(totalAssetsTwd * targetLeveragedRatio);
  const targetOriginalValueTwd = roundMoney(totalAssetsTwd * targetOriginalRatio);
  const leveragedTradeAmountTwd = roundMoney(targetLeveragedValueTwd - leveragedValueTwd);
  const originalTradeAmountTwd = roundMoney(targetOriginalValueTwd - originalValueTwd);
  const cashTradeAmountTwd = roundMoney(-(leveragedTradeAmountTwd + originalTradeAmountTwd));

  const recommendations = validRows.map((row) => {
    const currentWeight = totalAssetsTwd > 0 ? row.currentValueTwd / totalAssetsTwd : 0;
    const assetType = getAssetType(row.assetBeta);
    const typeValueTwd = assetType === "leveraged" ? leveragedValueTwd : originalValueTwd;
    const currentSleeveWeight = typeValueTwd > 0 ? row.currentValueTwd / typeValueTwd : 0;
    return {
      id: row.id,
      tickerInput: row.tickerInput,
      normalizedTicker: row.normalizedTicker,
      shares: row.shares,
      assetBeta: row.assetBeta,
      price: row.quote.price,
      currency: row.quote.currency,
      priceTwd: row.quote.priceTwd,
      date: row.quote.date,
      source: row.quote.source,
      currentValueTwd: row.currentValueTwd,
      currentWeight,
      currentSleeveWeight: roundRatio(currentSleeveWeight),
      betaContribution: currentWeight * row.assetBeta,
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
  const afterBeta = targetBetaValue;

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
    leveragedTargetPct: toNumber(leveragedTargetPct),
    originalTargetPct: toNumber(originalTargetPct),
    leveragedTradeAmountTwd,
    originalTradeAmountTwd,
    cashTradeAmountTwd,
    afterBeta,
    totalTradeAmountTwd: roundMoney(Math.abs(leveragedTradeAmountTwd) + Math.abs(originalTradeAmountTwd)),
    recommendations,
  };
}
