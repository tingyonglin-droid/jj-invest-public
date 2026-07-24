export function createAdviceActionText({ label, amount }) {
  return `${label} ${amount}`.trim();
}

function formatTwd(value) {
  return `NT$${Math.round(Math.abs(Number(value) || 0)).toLocaleString("zh-TW")}`;
}

function getAssetTypeLabel(assetBeta) {
  return Number(assetBeta) >= 1.5 ? "正二" : "原形";
}

function createNetFlowText(totalTradeAmountTwd) {
  const amount = Number(totalTradeAmountTwd) || 0;
  if (Math.abs(amount) <= 0.5) {
    return "淨調整：無需調整";
  }
  return `淨調整：${amount > 0 ? "買入" : "賣出"} ${formatTwd(amount)}`;
}

function createPrimaryActionText(recommendations = []) {
  const grouped = new Map();

  recommendations.forEach((item) => {
    const amount = Number(item.tradeAmountTwd) || 0;
    if (Math.abs(amount) <= 0.5 || item.action === "none") {
      return;
    }
    const label = getAssetTypeLabel(item.assetBeta);
    const key = `${amount > 0 ? "買入" : "賣出"}${label}`;
    grouped.set(key, {
      text: key,
      amount: (grouped.get(key)?.amount || 0) + Math.abs(amount),
    });
  });

  const actions = Array.from(grouped.values())
    .sort((a, b) => b.amount - a.amount)
    .map((item) => item.text);

  return actions.length > 0 ? `主要動作：${actions.join("、")}` : "主要動作：不調整";
}

export function createAdviceDisplay({
  betaBoundaryLabel,
  totalTradeAmountTwd,
  recommendations,
}) {
  if (betaBoundaryLabel === "低於下限") {
    return {
      headline: "提高曝險",
      netFlowText: createNetFlowText(totalTradeAmountTwd),
      primaryActionText: createPrimaryActionText(recommendations),
      tone: "buy",
    };
  }

  if (betaBoundaryLabel === "高於上限") {
    return {
      headline: "降低曝險",
      netFlowText: createNetFlowText(totalTradeAmountTwd),
      primaryActionText: createPrimaryActionText(recommendations),
      tone: "sell",
    };
  }

  return {
    headline: "無需操作",
    netFlowText: "淨調整：無需調整",
    primaryActionText: "主要動作：不調整",
    tone: "none",
  };
}
