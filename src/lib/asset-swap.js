import { getAppliedRebalanceShareDelta } from "./rebalance-apply.js";

const BETA_TOLERANCE = 0.005;

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function actionFor(amount) {
  if (amount > 0.5) return "buy";
  if (amount < -0.5) return "sell";
  return "none";
}

function emptyResult(recommendations, warnings = [], totalAssetsTwd = 0) {
  return {
    recommendations: recommendations.map((item) => ({
      ...item,
      desiredTradeAmountTwd: 0,
      tradeAmountTwd: 0,
      targetValueTwd: number(item.currentValueTwd),
      action: "none",
      isSelected: false,
    })),
    warnings,
    isValid: false,
    isReachable: false,
    appliedAfterBeta: 0,
    totalAssetsTwd: number(totalAssetsTwd),
  };
}

function tradeUnit(item, precision) {
  const isTaiwanTicker = /\.(?:TW|TWO)$/i.test(String(item.normalizedTicker || ""));
  return isTaiwanTicker && precision === "lots" ? 1000 : 1;
}

function portfolioBeta(recommendations, totalAssetsTwd) {
  if (totalAssetsTwd <= 0) return 0;
  return recommendations.reduce(
    (sum, item) => sum + number(item.currentValueTwd) / totalAssetsTwd * number(item.assetBeta),
    0,
  );
}

function betaAfter(recommendations, totalAssetsTwd, precision) {
  if (totalAssetsTwd <= 0) return 0;
  return recommendations.reduce((sum, item) => {
    const delta = getAppliedRebalanceShareDelta(item, precision);
    const value = Math.max(number(item.currentValueTwd) + delta * number(item.priceTwd), 0);
    return sum + value / totalAssetsTwd * number(item.assetBeta);
  }, 0);
}

export function createAssetSwapRebalance({
  recommendations,
  sellId,
  buyId,
  totalAssetsTwd,
  targetBeta,
  precision = "shares",
}) {
  const totalAssets = number(totalAssetsTwd);
  const sell = recommendations.find((item) => String(item.id) === String(sellId));
  const buy = recommendations.find((item) => String(item.id) === String(buyId));

  if (!sell || !buy) {
    return emptyResult(recommendations, ["請選擇一檔賣出標的與一檔買入標的。"], totalAssets);
  }
  if (String(sell.id) === String(buy.id)) {
    return emptyResult(recommendations, ["賣出與買入標的不可相同。"], totalAssets);
  }
  if (sell.currency !== buy.currency) {
    return emptyResult(recommendations, ["標的互換僅支援相同幣別。"], totalAssets);
  }
  if (number(sell.shares) <= 0 || number(sell.priceTwd) <= 0 || number(buy.priceTwd) <= 0) {
    return emptyResult(recommendations, ["賣出標的須有持股，且兩檔標的都必須有有效價格。"], totalAssets);
  }

  const currentBeta = portfolioBeta(recommendations, totalAssets);
  const betaGap = number(targetBeta) - currentBeta;
  const betaDifference = number(buy.assetBeta) - number(sell.assetBeta);
  if (Math.abs(betaGap) < Number.EPSILON) {
    return emptyResult(recommendations, ["再平衡 Beta 已等於目前 Beta，不需要互換標的。"], totalAssets);
  }
  if (Math.abs(betaDifference) < Number.EPSILON || betaGap * betaDifference <= 0) {
    return emptyResult(recommendations, [
      betaGap < 0
        ? "降低 Beta 時，買入標的的曝險倍數必須低於賣出標的。"
        : "增加 Beta 時，買入標的的曝險倍數必須高於賣出標的。",
    ], totalAssets);
  }

  const idealTransferTwd = Math.abs(betaGap * totalAssets / betaDifference);
  const sellUnit = tradeUnit(sell, precision);
  const buyUnit = tradeUnit(buy, precision);
  const maxSellUnits = Math.floor(number(sell.shares) / sellUnit);
  const idealSellUnits = idealTransferTwd / (number(sell.priceTwd) * sellUnit);
  const candidates = new Set([0, maxSellUnits]);
  for (let offset = -8; offset <= 8; offset += 1) {
    candidates.add(Math.min(Math.max(Math.round(idealSellUnits) + offset, 0), maxSellUnits));
  }

  let best = null;
  candidates.forEach((sellUnits) => {
    const sellShares = sellUnits * sellUnit;
    const proceeds = sellShares * number(sell.priceTwd);
    const buyShares = Math.floor(proceeds / (number(buy.priceTwd) * buyUnit)) * buyUnit;
    const next = recommendations.map((item) => {
      const tradeAmountTwd = String(item.id) === String(sell.id)
        ? -sellShares * number(sell.priceTwd)
        : String(item.id) === String(buy.id)
          ? buyShares * number(buy.priceTwd)
          : 0;
      return {
        ...item,
        desiredTradeAmountTwd: tradeAmountTwd,
        tradeAmountTwd,
        targetValueTwd: number(item.currentValueTwd) + tradeAmountTwd,
        action: actionFor(tradeAmountTwd),
        isSelected: String(item.id) === String(sell.id) || String(item.id) === String(buy.id),
      };
    });
    const applied = betaAfter(next, totalAssets, precision);
    const distance = Math.abs(applied - number(targetBeta));
    if (!best || distance < best.distance) best = { recommendations: next, applied, distance };
  });

  const isReachable = best.distance < BETA_TOLERANCE;
  const warnings = [];
  if (!isReachable) {
    warnings.push(`賣出標的持股不足或交易單位限制，本次互換最多可達 Beta ${best.applied.toFixed(2)}。`);
  }

  return {
    recommendations: best.recommendations,
    warnings,
    isValid: true,
    isReachable,
    appliedAfterBeta: best.applied,
    currentBeta,
    totalAssetsTwd: totalAssets,
    requiresSellFirstCurrencies: [sell.currency],
  };
}

export function getOriginalTargetPctAfterAssetSwap({ recommendations, totalAssetsTwd, precision }) {
  const totalAssets = number(totalAssetsTwd);
  if (totalAssets <= 0) return 0;

  const originalValueTwd = recommendations.reduce((sum, item) => {
    if (item.assetType === "cashEquivalent" || number(item.assetBeta) > 1) return sum;
    const delta = getAppliedRebalanceShareDelta(item, precision);
    return sum + Math.max(number(item.currentValueTwd) + delta * number(item.priceTwd), 0);
  }, 0);

  return originalValueTwd / totalAssets * 100;
}
