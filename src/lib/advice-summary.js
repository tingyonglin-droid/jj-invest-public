export function createAdviceActionText({ label, amount }) {
  return `${label} ${amount}`.trim();
}

function formatTwd(value) {
  return `NT$${Math.round(Math.abs(Number(value) || 0)).toLocaleString("zh-TW")}`;
}

function createClassActionText(label, amount, { increaseWord = "買入", decreaseWord = "賣出" } = {}) {
  const value = Number(amount) || 0;
  if (Math.abs(value) <= 0.5) {
    return `${label}：無需調整`;
  }
  const word = value > 0 ? increaseWord : decreaseWord;
  return `${label}：${word} ${formatTwd(value)}`;
}

export function createAdviceDisplay({
  betaBoundaryLabel,
  leveragedTradeAmountTwd,
  originalTradeAmountTwd,
  cashTradeAmountTwd,
}) {
  if (betaBoundaryLabel === "低於下限" || betaBoundaryLabel === "高於上限") {
    return {
      headline: betaBoundaryLabel === "低於下限" ? "提高曝險" : "降低曝險",
      classActions: [
        createClassActionText("槓桿", leveragedTradeAmountTwd),
        createClassActionText("原形", originalTradeAmountTwd),
        createClassActionText("現金", cashTradeAmountTwd, {
          increaseWord: "增加",
          decreaseWord: "減少",
        }),
      ],
      tone: betaBoundaryLabel === "低於下限" ? "buy" : "sell",
    };
  }

  return {
    headline: "無需操作",
    classActions: ["槓桿：無需調整", "原形：無需調整", "現金：無需調整"],
    tone: "none",
  };
}
