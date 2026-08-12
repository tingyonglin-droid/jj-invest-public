export function isPortfolioSetupComplete({ formState, hasReceivedQuoteResponse }) {
  const hasHolding = formState.positions?.some((position) => Number(position.shares) > 0);
  const hasCash =
    Number(formState.cashTwd) > 0 ||
    Number(formState.cashUsd) > 0 ||
    formState.cashEquivalentPositions?.some((position) => Number(position.shares) > 0);
  return Boolean(hasReceivedQuoteResponse && hasHolding && hasCash);
}

export function createOverviewAction(calculation, { setupComplete = true } = {}) {
  if (!setupComplete) {
    return {
      kind: "setup",
      label: "設定持股與現金 →",
      tone: "setup",
      destination: "settings",
      settingsPage: "positions",
      ariaLabel: "設定持股與現金，前往持股設定",
    };
  }

  if (!calculation.isValid) {
    const settingsPage = calculation.issues?.some((issue) => issue.settingsPage === "positions")
      ? "positions"
      : "beta";

    return {
      kind: "settings",
      label: "設定需修正 →",
      tone: "error",
      destination: "settings",
      settingsPage,
      ariaLabel: "設定需修正，前往設定頁查看問題",
    };
  }

  if (calculation.needsRebalance) {
    return {
      kind: "rebalance",
      label: "需再平衡 →",
      tone: "rebalance",
      destination: "operations",
      settingsPage: null,
      ariaLabel: "需再平衡，前往再平衡頁確認",
    };
  }

  return {
    kind: "balanced",
    label: "不需再平衡",
    tone: "balanced",
    destination: null,
    settingsPage: null,
    ariaLabel: null,
  };
}
