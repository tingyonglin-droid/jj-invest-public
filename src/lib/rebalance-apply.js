import {
  normalizeSettlementCurrency,
  roundSettlementMoney,
} from "./settlement.js";

const TAIWAN_LOT_SIZE = 1000;

function roundCash(value) {
  return Math.round(value + Number.EPSILON);
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundSigned(value, unit) {
  if (!Number.isFinite(value) || value === 0 || unit <= 0) {
    return 0;
  }
  return Math.sign(value) * Math.round(Math.abs(value) / unit) * unit;
}

export function isTaiwanTicker(normalizedTicker) {
  return /\.(?:TW|TWO)$/.test(String(normalizedTicker || "").toUpperCase());
}

export function getRebalanceShareDelta(recommendation, precision = "shares") {
  if (
    !recommendation ||
    !Number.isFinite(recommendation.tradeAmountTwd) ||
    !Number.isFinite(recommendation.priceTwd) ||
    recommendation.priceTwd <= 0
  ) {
    return 0;
  }

  const unit =
    precision === "lots" && isTaiwanTicker(recommendation.normalizedTicker)
      ? TAIWAN_LOT_SIZE
      : 1;
  return roundSigned(recommendation.tradeAmountTwd / recommendation.priceTwd, unit);
}

export function getAppliedRebalanceShareDelta(recommendation, precision = "shares") {
  const requestedDeltaShares = getRebalanceShareDelta(recommendation, precision);
  const currentShares = toNumber(recommendation?.shares);

  return Math.max(requestedDeltaShares, -currentShares);
}

export function getAppliedTradeAmounts(recommendation, precision = "shares") {
  const deltaShares = getAppliedRebalanceShareDelta(recommendation, precision);
  const settlementCurrency = normalizeSettlementCurrency(recommendation?.currency);

  return {
    deltaShares,
    settlementCurrency,
    amountLocal: settlementCurrency
      ? roundSettlementMoney(deltaShares * toNumber(recommendation?.price), settlementCurrency)
      : 0,
    amountTwd: deltaShares * toNumber(recommendation?.priceTwd),
  };
}

export function getCashSleeveValueAfterStockTrades({
  recommendations,
  totalAssetsTwd,
  precision = "shares",
}) {
  const appliedStockValueTwd = recommendations.reduce((sum, recommendation) => {
    const afterValueTwd = Math.max(
      toNumber(recommendation.currentValueTwd) +
        getAppliedRebalanceShareDelta(recommendation, precision) *
          toNumber(recommendation.priceTwd),
      0,
    );
    return sum + afterValueTwd;
  }, 0);

  return roundCash(Math.max(toNumber(totalAssetsTwd) - appliedStockValueTwd, 0));
}

export function getMinimumCashBalances({
  targetRealCashTwd,
  cashTwd,
  cashUsd,
  usdTwd,
}) {
  const target = Math.max(toNumber(targetRealCashTwd), 0);
  const twd = Math.max(toNumber(cashTwd), 0);
  const fx = Math.max(toNumber(usdTwd), 0);
  const usd = Math.max(toNumber(cashUsd), 0);
  const usdValueTwd = usd * fx;
  const total = twd + usdValueTwd;

  if (fx <= 0 || usdValueTwd <= 0 || total <= 0) {
    return { TWD: roundSettlementMoney(target, "TWD"), USD: 0 };
  }

  const targetTwd = roundSettlementMoney(target * (twd / total), "TWD");
  return {
    TWD: targetTwd,
    USD: roundSettlementMoney((target - targetTwd) / fx, "USD"),
  };
}

export function createFundedRebalanceRecommendations({
  recommendations,
  precision = "shares",
  cashBalances = { TWD: 0, USD: 0 },
  minimumCashBalances = { TWD: 0, USD: 0 },
  cashTargetStrategy = "floor",
}) {
  const appliedDeltas = new Map(
    recommendations.map((recommendation) => [
      recommendation.id,
      getAppliedRebalanceShareDelta(recommendation, precision),
    ]),
  );
  const warnings = [];
  const requiresSellFirstCurrencies = [];

  for (const recommendation of recommendations) {
    if (!normalizeSettlementCurrency(recommendation.currency)) {
      appliedDeltas.set(recommendation.id, 0);
      warnings.push(`${recommendation.normalizedTicker || "此標的"} 使用不支援的交易幣別，已停止套用。`);
    }
  }

  for (const currency of ["TWD", "USD"]) {
    const rows = recommendations.filter(
      (item) => normalizeSettlementCurrency(item.currency) === currency,
    );
    const startingCash = Math.max(toNumber(cashBalances[currency]), 0);
    const reserve = Math.max(toNumber(minimumCashBalances[currency]), 0);
    const saleProceeds = rows.reduce((sum, item) => {
      const delta = toNumber(appliedDeltas.get(item.id));
      return delta < 0 ? sum + Math.abs(delta) * toNumber(item.price) : sum;
    }, 0);
    const initialBuyBudget = Math.max(startingCash - reserve, 0);
    let buyBudget = Math.max(startingCash + saleProceeds - reserve, 0);
    const requestedBuys = rows.reduce((sum, item) => {
      const delta = toNumber(appliedDeltas.get(item.id));
      return delta > 0 ? sum + delta * toNumber(item.price) : sum;
    }, 0);

    if (requestedBuys > initialBuyBudget && saleProceeds > 0 && buyBudget > initialBuyBudget) {
      requiresSellFirstCurrencies.push(currency);
    }

    const buys = rows
      .filter((item) => toNumber(appliedDeltas.get(item.id)) > 0)
      .sort((left, right) => {
        const leftPriority = left.assetType === "cashEquivalent" ? 0 : 1;
        const rightPriority = right.assetType === "cashEquivalent" ? 0 : 1;
        return leftPriority - rightPriority || Math.abs(toNumber(right.tradeAmountTwd)) - Math.abs(toNumber(left.tradeAmountTwd));
      });

    let remainingRequested = requestedBuys;
    for (const item of buys) {
      if (remainingRequested <= buyBudget + 0.0001) {
        break;
      }
      const shareUnit = precision === "lots" && isTaiwanTicker(item.normalizedTicker)
        ? TAIWAN_LOT_SIZE
        : 1;
      const unitCost = shareUnit * toNumber(item.price);
      const currentDelta = toNumber(appliedDeltas.get(item.id));
      if (unitCost <= 0) {
        appliedDeltas.set(item.id, 0);
        continue;
      }
      const availableUnits = Math.floor(currentDelta / shareUnit);
      let unitsToRemove = Math.min(
        availableUnits,
        Math.ceil((remainingRequested - buyBudget) / unitCost),
      );
      if (
        cashTargetStrategy === "nearest" &&
        item.assetType === "cashEquivalent" &&
        unitsToRemove > 0
      ) {
        const withRemoval = remainingRequested - unitsToRemove * unitCost;
        const withOneLessRemoval = withRemoval + unitCost;
        if (Math.abs(withOneLessRemoval - buyBudget) < Math.abs(withRemoval - buyBudget)) {
          unitsToRemove -= 1;
        }
      }
      appliedDeltas.set(item.id, currentDelta - unitsToRemove * shareUnit);
      remainingRequested -= unitsToRemove * unitCost;
    }

    if (remainingRequested + 0.0001 < requestedBuys) {
      warnings.push(`${currency === "USD" ? "美元" : "台幣"}現金不足，已縮減買入數量。`);
    }
    buyBudget = Math.max(buyBudget - remainingRequested, 0);
  }

  return {
    recommendations: recommendations.map((recommendation) => ({
      ...recommendation,
      tradeAmountTwd:
        toNumber(appliedDeltas.get(recommendation.id)) * toNumber(recommendation.priceTwd),
    })),
    warnings: [...new Set(warnings)],
    requiresSellFirstCurrencies: [...new Set(requiresSellFirstCurrencies)],
  };
}

export function getAppliedRebalanceSummary({ recommendations, precision = "shares" }) {
  const summary = recommendations.reduce(
    (summary, recommendation) => {
      const appliedDeltaShares = getAppliedRebalanceShareDelta(recommendation, precision);
      if (appliedDeltaShares === 0) {
        return summary;
      }

      const trade = getAppliedTradeAmounts(recommendation, precision);
      if (!trade.settlementCurrency) {
        return summary;
      }
      const appliedAmountTwd = trade.amountTwd;
      const sleeveKey = recommendation.assetType === "cashEquivalent"
        ? "cashEquivalentNetAmountTwd"
        : toNumber(recommendation.assetBeta) > 1
          ? "leveragedNetAmountTwd"
          : "originalNetAmountTwd";
      const sleevePrefix = recommendation.assetType === "cashEquivalent"
        ? "cashEquivalent"
        : toNumber(recommendation.assetBeta) > 1
          ? "leveraged"
          : "original";
      const settlementKey = trade.settlementCurrency === "USD"
        ? `${sleevePrefix}NetAmountUsd`
        : `${sleevePrefix}NetAmountSettlementTwd`;

      return {
        ...summary,
        actionCount: summary.actionCount + 1,
        totalAmountTwd: roundCash(
          summary.totalAmountTwd + Math.abs(appliedAmountTwd),
        ),
        cashDeltaTwd: summary.cashDeltaTwd
          - (trade.settlementCurrency === "TWD"
            ? trade.deltaShares * toNumber(recommendation.price)
            : 0),
        cashDeltaUsd: summary.cashDeltaUsd
          - (trade.settlementCurrency === "USD"
            ? trade.deltaShares * toNumber(recommendation.price)
            : 0),
        [settlementKey]: summary[settlementKey]
          + trade.deltaShares * toNumber(recommendation.price),
        [sleeveKey]: summary[sleeveKey] + appliedAmountTwd,
      };
    },
    {
      actionCount: 0,
      totalAmountTwd: 0,
      leveragedNetAmountTwd: 0,
      originalNetAmountTwd: 0,
      cashEquivalentNetAmountTwd: 0,
      cashDeltaTwd: 0,
      cashDeltaUsd: 0,
      leveragedNetAmountSettlementTwd: 0,
      leveragedNetAmountUsd: 0,
      originalNetAmountSettlementTwd: 0,
      originalNetAmountUsd: 0,
      cashEquivalentNetAmountSettlementTwd: 0,
      cashEquivalentNetAmountUsd: 0,
    },
  );

  return {
    ...summary,
    leveragedNetAmountTwd: roundCash(summary.leveragedNetAmountTwd),
    originalNetAmountTwd: roundCash(summary.originalNetAmountTwd),
    cashEquivalentNetAmountTwd: roundCash(summary.cashEquivalentNetAmountTwd),
    leveragedNetAmountSettlementTwd: roundSettlementMoney(summary.leveragedNetAmountSettlementTwd, "TWD"),
    leveragedNetAmountUsd: roundSettlementMoney(summary.leveragedNetAmountUsd, "USD"),
    originalNetAmountSettlementTwd: roundSettlementMoney(summary.originalNetAmountSettlementTwd, "TWD"),
    originalNetAmountUsd: roundSettlementMoney(summary.originalNetAmountUsd, "USD"),
    cashEquivalentNetAmountSettlementTwd: roundSettlementMoney(summary.cashEquivalentNetAmountSettlementTwd, "TWD"),
    cashEquivalentNetAmountUsd: roundSettlementMoney(summary.cashEquivalentNetAmountUsd, "USD"),
    cashDeltaTwd: roundSettlementMoney(summary.cashDeltaTwd, "TWD"),
    cashDeltaUsd: roundSettlementMoney(summary.cashDeltaUsd, "USD"),
  };
}

export function applyRebalanceToState({
  positions,
  cashEquivalentPositions = [],
  cashTwd,
  cashUsd = 0,
  recommendations,
  precision,
}) {
  const recommendationById = new Map(
    recommendations.map((recommendation) => [recommendation.id, recommendation]),
  );
  let cashDeltaTwd = 0;
  let cashDeltaUsd = 0;

  const applyPositions = (sourcePositions) => sourcePositions.map((position) => {
    const recommendation = recommendationById.get(position.id);
    if (!recommendation) {
      return position;
    }

    const currentShares = toNumber(position.shares);
    const appliedDeltaShares = getAppliedRebalanceShareDelta(
      {
        ...recommendation,
        shares: currentShares,
      },
      precision,
    );

    const trade = getAppliedTradeAmounts(
      { ...recommendation, shares: currentShares },
      precision,
    );
    if (!trade.settlementCurrency) {
      return position;
    }
    if (trade.settlementCurrency === "USD") {
      cashDeltaUsd += trade.amountLocal;
    } else {
      cashDeltaTwd += trade.amountLocal;
    }

    return {
      ...position,
      shares: currentShares + appliedDeltaShares,
    };
  });

  const nextPositions = applyPositions(positions);
  const nextCashEquivalentPositions = applyPositions(cashEquivalentPositions);

  return {
    positions: nextPositions,
    cashEquivalentPositions: nextCashEquivalentPositions,
    cashTwd: roundSettlementMoney(toNumber(cashTwd) - cashDeltaTwd, "TWD"),
    cashUsd: roundSettlementMoney(toNumber(cashUsd) - cashDeltaUsd, "USD"),
  };
}
