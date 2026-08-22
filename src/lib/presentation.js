import supportedTickers from "../data/supported-tickers.json" with { type: "json" };

const TICKER_NAMES = Object.fromEntries(
  supportedTickers.flatMap((item) => item.symbols.map((symbol) => [symbol, item.name])),
);
const TICKER_DEFAULT_BETAS = Object.fromEntries(
  supportedTickers.flatMap((item) => [item.ticker, ...item.symbols].map((symbol) => [
    symbol,
    Number(item.assetBeta ?? (item.category === "original" ? 1 : item.category === "leveraged" ? 2 : 0)),
  ])),
);

const TICKER_BADGES = {
  "00631L.TW": "2x",
  "00685L.TW": "△",
  QLD: "QLD",
};

const TICKER_PLACEHOLDERS = {
  leveraged: "00631L / 00685L / QLD / SOXL",
  original: "0050 / 006208 / VOO / QQQ",
  cashEquivalent: "00865B / 00859B / SGOV / BOXX",
};

const twdNumberFormatter = new Intl.NumberFormat("zh-TW", {
  maximumFractionDigits: 0,
});
const usdNumberFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatTwdText(value) {
  return `NT$${twdNumberFormatter.format(value)}`;
}

export function getPositionDisplayName(normalizedTicker, assetBeta = 2) {
  const tickerKey = String(normalizedTicker || "").trim().toUpperCase();
  if (TICKER_NAMES[tickerKey]) {
    return TICKER_NAMES[tickerKey];
  }

  if (Number(assetBeta) === 0) {
    return "類現金標的";
  }
  return Number(assetBeta) === 1 ? "原形標的" : "槓桿標的";
}

export function getTickerDefaultAssetBeta(tickerInput) {
  const tickerKey = String(tickerInput || "").trim().toUpperCase();
  return Number.isFinite(TICKER_DEFAULT_BETAS[tickerKey]) ? TICKER_DEFAULT_BETAS[tickerKey] : null;
}

export function getTickerBadgeText(normalizedTicker) {
  return TICKER_BADGES[normalizedTicker] || String(normalizedTicker || "?").slice(0, 3);
}

export function getTickerDisplayText(normalizedTicker) {
  return String(normalizedTicker || "")
    .trim()
    .toUpperCase()
    .replace(/\.(?:TW|TWO)$/, "");
}

export function formatExposureMultiplier(assetBeta) {
  const multiplier = Number(assetBeta);
  if (!Number.isFinite(multiplier)) {
    return "";
  }

  return `${Number.isInteger(multiplier) ? multiplier : multiplier.toFixed(1)}×`;
}

export function getTickerPlaceholder(assetType) {
  return TICKER_PLACEHOLDERS[assetType] || "輸入股票或 ETF 代號";
}

export function getEstimatedShares(tradeAmountTwd, priceTwd) {
  if (!Number.isFinite(tradeAmountTwd) || !Number.isFinite(priceTwd) || priceTwd <= 0) {
    return 0;
  }
  return Math.round(Math.abs(tradeAmountTwd) / priceTwd);
}

export function getActionText(action) {
  if (action === "buy") {
    return "買入";
  }
  if (action === "sell") {
    return "賣出";
  }
  return "不動作";
}

export function getHoldingActionPresentation({ isSelected, action, estimatedShares }) {
  const displayedAction = !isSelected || estimatedShares === 0 ? "none" : action;
  const actionText = isSelected ? getActionText(displayedAction) : "不納入再平衡清單";

  return {
    displayedAction,
    actionSummaryText: displayedAction === "none"
      ? actionText
      : `${actionText} ${estimatedShares.toLocaleString("zh-TW")} 股`,
    showAmount: displayedAction !== "none",
  };
}

export function getOperationSummary(recommendations) {
  const actionableRows = recommendations.filter(
    (item) => item.action !== "none" && Math.abs(item.tradeAmountTwd) > 0.5,
  );

  return {
    actionCount: actionableRows.length,
    totalAmountTwd: actionableRows.reduce(
      (sum, item) => sum + Math.abs(item.tradeAmountTwd),
      0,
    ),
  };
}

export function createOperationListText(recommendations) {
  const rows = recommendations
    .filter((item) => item.action !== "none" && Math.abs(item.tradeAmountTwd) > 0.5)
    .map((item) => {
      const shares = getEstimatedShares(item.tradeAmountTwd, item.priceTwd);
      const ticker = getTickerDisplayText(item.normalizedTicker);
      const action = getActionText(item.action);
      if (item.currency === "USD") {
        const amountUsd = shares * Math.abs(Number(item.price) || 0);
        return `${ticker} ${action} US$${usdNumberFormatter.format(amountUsd)}（約 ${formatTwdText(
          Math.abs(item.tradeAmountTwd),
        )}），${shares.toLocaleString("zh-TW")} 股`;
      }
      return `${ticker} ${action} ${formatTwdText(Math.abs(item.tradeAmountTwd))}，約 ${shares.toLocaleString("zh-TW")} 股`;
    });

  return ["JJ Invest System 操作清單", ...rows].join("\n");
}
