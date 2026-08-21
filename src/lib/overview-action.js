export function isPortfolioSetupComplete({ formState, hasReceivedQuoteResponse }) {
  const hasHolding = formState.positions?.some((position) => Number(position.shares) > 0);
  const hasTargetBeta = formState.targetBeta !== ""
    && formState.targetBeta != null
    && Number.isFinite(Number(formState.targetBeta));
  return Boolean(hasReceivedQuoteResponse && hasHolding && hasTargetBeta);
}

export function createOverviewAction(calculation, { setupComplete = true } = {}) {
  if (!setupComplete) {
    return {
      kind: "setup",
      label: "開始設定 Beta／持股 →",
      tone: "setup",
      destination: "settings",
      settingsPage: "beta",
      ariaLabel: "開始設定 Beta 與持股，前往設定頁",
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
    const shouldLowerExposure = Number(calculation.currentBeta) > Number(calculation.betaUpper);
    const exposureAction = shouldLowerExposure ? "降低" : "增加";

    return {
      kind: "rebalance",
      label: `建議${exposureAction}曝險 →`,
      tone: "rebalance",
      destination: "operations",
      settingsPage: null,
      ariaLabel: `建議${exposureAction}曝險，前往再平衡頁確認`,
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
