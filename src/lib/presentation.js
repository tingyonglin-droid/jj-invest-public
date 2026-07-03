const TICKER_NAMES = {
  "00631L.TW": "元大台灣50正2",
  "00685L.TW": "群益台灣加權正2",
  QLD: "ProShares Ultra QQQ",
};

const TICKER_BADGES = {
  "00631L.TW": "2x",
  "00685L.TW": "△",
  QLD: "QLD",
};

const twdNumberFormatter = new Intl.NumberFormat("zh-TW", {
  maximumFractionDigits: 0,
});

function formatTwdText(value) {
  return `NT$${twdNumberFormatter.format(value)}`;
}

export function getPositionDisplayName(normalizedTicker) {
  return TICKER_NAMES[normalizedTicker] || "正2標的";
}

export function getTickerBadgeText(normalizedTicker) {
  return TICKER_BADGES[normalizedTicker] || String(normalizedTicker || "?").slice(0, 3);
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

export function createOperationListText(recommendations) {
  const rows = recommendations
    .filter((item) => item.action !== "none" && Math.abs(item.tradeAmountTwd) > 0.5)
    .map((item) => {
      const shares = getEstimatedShares(item.tradeAmountTwd, item.priceTwd);
      return `${item.normalizedTicker} ${getActionText(item.action)} ${formatTwdText(
        Math.abs(item.tradeAmountTwd),
      )}，約 ${shares.toLocaleString("zh-TW")} 股`;
    });

  return ["JJ Invest System 操作清單", ...rows].join("\n");
}
