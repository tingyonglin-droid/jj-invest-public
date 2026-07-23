"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AUTO_REFRESH_INTERVAL_MS,
  shouldAutoRefreshQuotes,
} from "../src/lib/auto-refresh.js";
import {
  createAppBackup,
  mergeImportedHistory,
  parseAppBackup,
} from "../src/lib/backup.js";
import { createBenchmarkDrawdown } from "../src/lib/benchmark-drawdown.js";
import {
  createAnalyticsClient,
  getAssetType,
  getMarketFromTicker,
  getResultStatus,
  isCompletedPortfolioForAnalytics,
} from "../src/lib/analytics-client.js";
import { createBetaRailModel } from "../src/lib/beta-rail.js";
import { createBetaSummary } from "../src/lib/beta-summary.js";
import { calculateCashTwdValue } from "../src/lib/cash.js";
import {
  createHistoryChartModel,
  createHistorySnapshot,
  createHistorySummary,
  createPerformanceSeries,
  getTaipeiDateKey,
  mergeDemoHistoryRecords,
  normalizeHistoryRecords,
  upsertDailyHistorySnapshot,
} from "../src/lib/history.js";
import { normalizeTicker } from "../src/lib/market-data.js";
import { calculatePortfolio } from "../src/lib/portfolio.js";
import {
  applyRebalanceToState,
  getAppliedRebalanceShareDelta,
} from "../src/lib/rebalance-apply.js";
import {
  createRebalanceRestorePoint,
  parseRebalanceRestorePoint,
} from "../src/lib/rebalance-restore.js";
import {
  createOperationRebalance,
} from "../src/lib/operation-rebalance.js";
import { createAdviceActionText } from "../src/lib/advice-summary.js";
import {
  getPositionGroups,
  getPositionGroupTargetStatus,
} from "../src/lib/position-settings.js";
import {
  getActionText,
  getEstimatedShares,
  getPositionDisplayName,
  getTickerBadgeText,
} from "../src/lib/presentation.js";

const STORAGE_KEY = "jj-invest-public-overview-v1";
const HISTORY_STORAGE_KEY = "jj-invest-public-history-v1";
const BEFORE_REBALANCE_STORAGE_KEY = "jj-invest-public-before-rebalance-v1";
const USAGE_DEVICE_KEY = "jj-invest-public-device-id-v1";
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0";
const BENCHMARK_HISTORY_FROM = "2003-06-30";
const TARGET_WEIGHT_ERROR_MESSAGES = new Set([
  "正二標的目標比例合計必須等於 100%。",
  "原形標的目標比例合計必須等於 100%。",
]);

const DEFAULT_STATE = {
  positions: [
    {
      id: "position-1",
      tickerInput: "00631L",
      shares: 0,
      assetBeta: 2,
      targetWeightPct: 100,
    },
  ],
  cashTwd: 0,
  cashUsd: 0,
  targetBeta: 1.2,
  originalTargetPct: 0,
  tolerancePct: 10,
};

const emptyQuoteResult = {
  quotes: [],
  fx: {
    usdTwd: null,
    date: null,
    source: null,
    error: null,
  },
};

const twdNumberFormatter = new Intl.NumberFormat("zh-TW", {
  maximumFractionDigits: 0,
});

const twdPriceFormatter = new Intl.NumberFormat("zh-TW", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberDisplay = new Intl.NumberFormat("zh-TW", {
  maximumFractionDigits: 2,
});

const percentDisplay = new Intl.NumberFormat("zh-TW", {
  style: "percent",
  maximumFractionDigits: 2,
});

function formatTwd(value) {
  return `NT$${twdNumberFormatter.format(Number.isFinite(value) ? value : 0)}`;
}

function formatTwdPrice(value) {
  return `NT$${twdPriceFormatter.format(Number.isFinite(value) ? value : 0)}`;
}

function formatQuotePrice(value, currency) {
  const safeValue = Number.isFinite(value) ? value : 0;

  if (currency === "USD") {
    return `US$${twdPriceFormatter.format(safeValue)}`;
  }

  if (currency === "TWD") {
    return formatTwdPrice(safeValue);
  }

  return `${currency || ""} ${twdPriceFormatter.format(safeValue)}`.trim();
}

function formatNumber(value, digits = 2) {
  return new Intl.NumberFormat("zh-TW", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatPercent(ratio) {
  return percentDisplay.format(Number.isFinite(ratio) ? ratio : 0);
}

function formatSignedPercent(ratio) {
  const safeRatio = Number.isFinite(ratio) ? ratio : 0;
  return `${safeRatio > 0 ? "+" : ""}${formatPercent(safeRatio)}`;
}

function formatQuoteDate(date) {
  return date || "尚未更新";
}

function formatLastUpdatedAt(date) {
  if (!date) {
    return "尚未更新";
  }

  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function parseNumericInput(value) {
  if (value === "") {
    return "";
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function parseIntegerInput(value) {
  if (value === "") {
    return "";
  }
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function normalizeStoredState(state) {
  return {
    ...state,
    cashTwd: parseIntegerInput(state.cashTwd),
    cashUsd: parseIntegerInput(state.cashUsd ?? 0),
    originalTargetPct: parseNumericInput(state.originalTargetPct ?? DEFAULT_STATE.originalTargetPct),
    positions: (state.positions || DEFAULT_STATE.positions).map((position) => ({
      ...position,
      assetBeta: Number(position.assetBeta) === 1 ? 1 : 2,
    })),
  };
}

function createAnonymousDeviceId() {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `device-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function getOrCreateAnonymousDeviceId() {
  try {
    const saved = window.localStorage.getItem(USAGE_DEVICE_KEY);
    if (saved) {
      return saved;
    }

    const deviceId = createAnonymousDeviceId();
    window.localStorage.setItem(USAGE_DEVICE_KEY, deviceId);
    return deviceId;
  } catch {
    return "";
  }
}

function getTradeClass(item) {
  if (item.action === "buy") {
    return "buy";
  }
  if (item.action === "sell") {
    return "sell";
  }
  return "none";
}

function getDriftClass(value) {
  if (value < -0.00005) {
    return "buy";
  }
  if (value > 0.00005) {
    return "sell";
  }
  return "none";
}

function clampPercent(value) {
  return Math.min(Math.max((Number.isFinite(value) ? value : 0) * 100, 0), 100);
}

function getPrimaryRecommendation(recommendations) {
  return recommendations.reduce((primary, item) => {
    if (!primary || Math.abs(item.tradeAmountTwd) > Math.abs(primary.tradeAmountTwd)) {
      return item;
    }
    return primary;
  }, null);
}

function getBetaStatus(calculation) {
  if (calculation.currentBeta > calculation.betaUpper) {
    return {
      tone: "sell",
      label: "高於上限，建議降低曝險",
      boundaryLabel: "高於上限",
      boundaryGap: calculation.currentBeta - calculation.betaUpper,
    };
  }

  if (calculation.currentBeta < calculation.betaLower) {
    return {
      tone: "buy",
      label: "低於下限，建議提高曝險",
      boundaryLabel: "低於下限",
      boundaryGap: calculation.currentBeta - calculation.betaLower,
    };
  }

  return {
    tone: "ok",
    label: "正常",
    boundaryLabel: "距離區間邊界",
    boundaryGap: Math.min(
      calculation.currentBeta - calculation.betaLower,
      calculation.betaUpper - calculation.currentBeta,
    ),
  };
}

function getAdvice(calculation, primaryRecommendation) {
  const betaStatus = getBetaStatus(calculation);
  const estimatedShares = primaryRecommendation
    ? getEstimatedShares(primaryRecommendation.tradeAmountTwd, primaryRecommendation.priceTwd)
    : 0;

  if (!calculation.isValid) {
    return {
      tone: "none",
      status: "設定需修正",
      label: "設定需修正",
      ticker: "同類資產分配需修正",
      amount: "請先調整比例",
      shares: "0 股",
    };
  }

  if (
    !primaryRecommendation ||
    !calculation.needsRebalance ||
    Math.abs(calculation.totalTradeAmountTwd) <= 0.5
  ) {
    return {
      tone: "none",
      status: "目前位於容忍區間",
      label: "無需操作",
      ticker: "目前位於容忍區間",
      amount: "",
      shares: "0 股",
    };
  }

  return {
    tone: calculation.totalTradeAmountTwd > 0 ? "buy" : "sell",
    status: betaStatus.label,
    label: calculation.totalTradeAmountTwd > 0 ? "買入" : "賣出",
    ticker: primaryRecommendation.normalizedTicker,
    amount: formatTwd(Math.abs(calculation.totalTradeAmountTwd)),
    shares: `${estimatedShares.toLocaleString("zh-TW")} 股`,
  };
}

function isLocalPreviewHost(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  );
}

function useStoredState() {
  const [state, setState] = useState(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          setState(normalizeStoredState({
            ...DEFAULT_STATE,
            ...JSON.parse(saved),
          }));
        }
      } catch {
        setState(DEFAULT_STATE);
      } finally {
        setHydrated(true);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [hydrated, state]);

  return [state, setState, hydrated];
}

function useStoredHistory() {
  const [records, setRecords] = useState([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const saved = window.localStorage.getItem(HISTORY_STORAGE_KEY);
        setRecords(normalizeHistoryRecords(saved ? JSON.parse(saved) : []));
      } catch {
        setRecords([]);
      } finally {
        setHydrated(true);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(records));
  }, [hydrated, records]);

  return [records, setRecords, hydrated];
}

export default function Home() {
  const [formState, setFormState, hydrated] = useStoredState();
  const [historyRecords, setHistoryRecords, historyHydrated] = useStoredHistory();
  const [quoteResult, setQuoteResult] = useState(emptyQuoteResult);
  const [status, setStatus] = useState("idle");
  const [requestError, setRequestError] = useState("");
  const [rebalancePrecision, setRebalancePrecision] = useState("lots");
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [activeView, setActiveView] = useState("overview");
  const [glossaryTopic, setGlossaryTopic] = useState(null);
  const [rebalanceTargetBetaOverride, setRebalanceTargetBetaOverride] = useState("");
  const [excludedRebalanceIds, setExcludedRebalanceIds] = useState([]);
  const [historyMode, setHistoryMode] = useState("performance");
  const [historyRangeDays, setHistoryRangeDays] = useState("30");
  const [benchmarkDrawdown, setBenchmarkDrawdown] = useState(null);
  const [backupStatus, setBackupStatus] = useState("");
  const [hasRebalanceRestorePoint, setHasRebalanceRestorePoint] = useState(false);
  const [rebalanceRestoreStatus, setRebalanceRestoreStatus] = useState("");
  const analyticsClient = useMemo(
    () =>
      createAnalyticsClient({
        appVersion: APP_VERSION,
      }),
    [],
  );

  const tickers = useMemo(
    () =>
      formState.positions
        .map((position) => position.tickerInput)
        .filter((ticker) => String(ticker || "").trim()),
    [formState.positions],
  );

  const isLocalPreview =
    hydrated &&
    typeof window !== "undefined" &&
    isLocalPreviewHost(window.location.hostname);

  const calculation = useMemo(
    () => {
      const cashValueTwd = calculateCashTwdValue({
        cashTwd: formState.cashTwd,
        cashUsd: formState.cashUsd,
        usdTwd: quoteResult.fx.usdTwd,
      });

      return calculatePortfolio({
        positions: formState.positions,
        quotes: quoteResult.quotes,
        cashTwd: cashValueTwd,
        targetBeta: formState.targetBeta,
        originalTargetPct: formState.originalTargetPct,
        tolerancePct: formState.tolerancePct,
      });
    },
    [formState, quoteResult],
  );

  const quoteErrors = quoteResult.quotes.filter((quote) => quote.error);
  const pageCalculationErrors = calculation.errors.filter(
    (error) => !TARGET_WEIGHT_ERROR_MESSAGES.has(error),
  );
  const betaRail = createBetaRailModel(calculation);
  const primaryRecommendation = getPrimaryRecommendation(calculation.recommendations);
  const advice = getAdvice(calculation, primaryRecommendation);
  const recommendationIds = useMemo(
    () => calculation.recommendations.map((item) => String(item.id)),
    [calculation.recommendations],
  );
  const selectedRebalanceIds = useMemo(
    () => {
      const excludedSet = new Set(excludedRebalanceIds);
      return recommendationIds.filter((id) => !excludedSet.has(id));
    },
    [excludedRebalanceIds, recommendationIds],
  );
  const rebalanceTargetBeta =
    rebalanceTargetBetaOverride === "" ? formState.targetBeta : rebalanceTargetBetaOverride;
  const operationRebalance = useMemo(
    () =>
      createOperationRebalance({
        recommendations: calculation.recommendations,
        selectedIds: selectedRebalanceIds,
        totalAssetsTwd: calculation.totalAssetsTwd,
        targetBeta: rebalanceTargetBeta,
        originalTargetRatio: calculation.targetOriginalRatio,
        precision: rebalancePrecision,
      }),
    [
      calculation.recommendations,
      calculation.targetOriginalRatio,
      calculation.totalAssetsTwd,
      rebalanceTargetBeta,
      rebalancePrecision,
      selectedRebalanceIds,
    ],
  );
  const canApplyRebalance =
    calculation.isValid &&
    operationRebalance.recommendations.length > 0 &&
    operationRebalance.summary.actionCount > 0;

  const refreshQuotes = useCallback(async () => {
    if (tickers.length === 0) {
      setRequestError("請至少輸入一個標的代號。");
      return;
    }

    setStatus("loading");
    setRequestError("");

    try {
      const response = await fetch(`/api/quotes?tickers=${encodeURIComponent(tickers.join(","))}`);
      if (!response.ok) {
        throw new Error(`報價 API 回應 ${response.status}`);
      }
      const payload = await response.json();
      const nextCashValueTwd = calculateCashTwdValue({
        cashTwd: formState.cashTwd,
        cashUsd: formState.cashUsd,
        usdTwd: payload.fx.usdTwd,
      });
      const nextCalculation = calculatePortfolio({
        positions: formState.positions,
        quotes: payload.quotes,
        cashTwd: nextCashValueTwd,
        targetBeta: formState.targetBeta,
        originalTargetPct: formState.originalTargetPct,
        tolerancePct: formState.tolerancePct,
      });
      setQuoteResult(payload);
      setLastUpdatedAt(new Date());
      setStatus("ready");
      if (nextCalculation.isValid) {
        analyticsClient.trackBetaCalculated({
          holdingCount: formState.positions.length,
          resultStatus: getResultStatus(nextCalculation),
        });
        if (isCompletedPortfolioForAnalytics(nextCalculation)) {
          analyticsClient.trackPortfolioCompleted();
        }
      }
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "價格更新失敗。");
      setStatus("error");
    }
  }, [analyticsClient, formState, tickers]);

  useEffect(() => {
    if (!hydrated || tickers.length === 0) {
      return undefined;
    }

    const timeoutId = window.setTimeout(refreshQuotes, 0);
    return () => window.clearTimeout(timeoutId);
  }, [hydrated, refreshQuotes, tickers.length]);

  useEffect(() => {
    if (
      !historyHydrated ||
      !lastUpdatedAt ||
      !calculation.isValid ||
      calculation.totalAssetsTwd <= 0 ||
      quoteResult.quotes.length === 0 ||
      quoteResult.quotes.some((quote) => quote.error || !quote.priceTwd)
    ) {
      return undefined;
    }

    let cancelled = false;
    const date = getTaipeiDateKey(lastUpdatedAt);

    async function saveDailyHistorySnapshot() {
      try {
        const response = await fetch(
          `/api/history-quotes?tickers=0050.TW&from=${date}&to=${date}`,
        );
        if (!response.ok) {
          return;
        }

        const payload = await response.json();
        const benchmarkPrice = payload?.quotes?.[0]?.prices?.[0]?.price;
        const snapshot = createHistorySnapshot({
          date,
          calculation,
          benchmark0050Price: benchmarkPrice,
        });

        if (!cancelled && snapshot) {
          setHistoryRecords((current) => upsertDailyHistorySnapshot(current, snapshot));
        }
      } catch {
        // Historical comparison is helpful, but must never block current calculations.
      }
    }

    saveDailyHistorySnapshot();
    return () => {
      cancelled = true;
    };
  }, [calculation, historyHydrated, lastUpdatedAt, quoteResult.quotes, setHistoryRecords]);

  useEffect(() => {
    if (!hydrated) {
      return undefined;
    }

    let cancelled = false;
    const toDate = getTaipeiDateKey(lastUpdatedAt || new Date());

    async function loadBenchmarkDrawdown() {
      try {
        const response = await fetch(
          `/api/history-quotes?tickers=0050.TW&from=${BENCHMARK_HISTORY_FROM}&to=${toDate}`,
        );
        if (!response.ok) {
          return;
        }

        const payload = await response.json();
        const drawdown = createBenchmarkDrawdown(payload?.quotes?.[0]?.prices || []);
        if (!cancelled) {
          setBenchmarkDrawdown(drawdown);
        }
      } catch {
        if (!cancelled) {
          setBenchmarkDrawdown(null);
        }
      }
    }

    loadBenchmarkDrawdown();
    return () => {
      cancelled = true;
    };
  }, [hydrated, lastUpdatedAt]);

  useEffect(() => {
    if (!hydrated) {
      return undefined;
    }

    function canRefresh() {
      return shouldAutoRefreshQuotes({
        tickers,
        visibilityState: document.visibilityState,
        status,
      });
    }

    function refreshIfVisible() {
      if (canRefresh()) {
        refreshQuotes();
      }
    }

    const intervalId = window.setInterval(refreshIfVisible, AUTO_REFRESH_INTERVAL_MS);

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        refreshIfVisible();
      }
    }

    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [hydrated, refreshQuotes, status, tickers]);

  const recordUsageOpen = useCallback(async () => {
    const deviceId = getOrCreateAnonymousDeviceId();
    if (!deviceId) {
      return;
    }

    try {
      await fetch("/api/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId }),
        cache: "no-store",
      });
    } catch {
      // Usage tracking must never block the calculator.
    }
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      recordUsageOpen();
      analyticsClient.startOrResumeSession();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [analyticsClient, hydrated, recordUsageOpen]);

  useEffect(() => {
    if (!hydrated) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      try {
        setHasRebalanceRestorePoint(
          Boolean(window.localStorage.getItem(BEFORE_REBALANCE_STORAGE_KEY)),
        );
      } catch {
        setHasRebalanceRestorePoint(false);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [hydrated]);

  function updateSetting(field, value) {
    setFormState((current) => ({
      ...current,
      [field]:
        field === "cashTwd" || field === "cashUsd"
          ? parseIntegerInput(value)
          : parseNumericInput(value),
    }));
  }

  function updatePosition(id, field, value) {
    setFormState((current) => ({
      ...current,
      positions: current.positions.map((position) =>
        position.id === id
          ? {
              ...position,
              [field]: field === "tickerInput" ? value : parseNumericInput(value),
            }
          : position,
      ),
    }));
  }

  function addPosition(assetBeta = 2) {
    setFormState((current) => ({
      ...current,
      positions: [
        ...current.positions,
        {
          id: `position-${Date.now()}`,
          tickerInput: "",
          shares: 0,
          assetBeta,
          targetWeightPct: 0,
        },
      ],
    }));
    analyticsClient.trackHoldingAdded({
      assetType: getAssetType(assetBeta),
      market: "unknown",
    });
  }

  function removePosition(id) {
    const removedPosition = formState.positions.find((position) => position.id === id);
    const canRemove = formState.positions.length > 1 && removedPosition;
    setFormState((current) => ({
      ...current,
      positions:
        current.positions.length === 1
          ? current.positions
          : current.positions.filter((position) => position.id !== id),
    }));
    if (canRemove) {
      analyticsClient.trackHoldingDeleted({
        assetType: getAssetType(removedPosition.assetBeta),
        market: getMarketFromTicker(removedPosition.tickerInput),
      });
    }
  }

  function applyOneClickRebalance() {
    if (!canApplyRebalance) {
      return;
    }

    const confirmed = window.confirm(
      `套用再平衡結果？\n\n這會更新持股股數與台幣現金，並先保留一份套用前資料供復原。\n\n共 ${operationRebalance.summary.actionCount} 筆操作。`,
    );
    if (!confirmed) {
      return;
    }

    let restorePointSaved = false;
    try {
      const restorePoint = createRebalanceRestorePoint(formState);
      window.localStorage.setItem(BEFORE_REBALANCE_STORAGE_KEY, JSON.stringify(restorePoint));
      setHasRebalanceRestorePoint(true);
      restorePointSaved = true;
    } catch {
      // Rebalance can still be applied if the browser blocks localStorage.
    }

    setFormState((current) => {
      const currentCashTwd = calculateCashTwdValue({
        cashTwd: current.cashTwd,
        cashUsd: current.cashUsd,
        usdTwd: quoteResult.fx.usdTwd,
      });
      const result = applyRebalanceToState({
        positions: current.positions,
        cashTwd: currentCashTwd,
        recommendations: operationRebalance.recommendations,
        precision: rebalancePrecision,
      });

      return {
        ...current,
        positions: result.positions,
        cashTwd: result.cashTwd - calculateCashTwdValue({
          cashTwd: 0,
          cashUsd: current.cashUsd,
          usdTwd: quoteResult.fx.usdTwd,
        }),
      };
    });
    setRebalanceRestoreStatus(
      restorePointSaved
        ? "已套用再平衡結果，可復原上一步。"
        : "已套用再平衡結果，但瀏覽器未允許建立復原點。",
    );
  }

  function restorePreviousRebalance() {
    try {
      const saved = window.localStorage.getItem(BEFORE_REBALANCE_STORAGE_KEY);
      const restorePoint = parseRebalanceRestorePoint(saved || "");
      setFormState(normalizeStoredState({
        ...DEFAULT_STATE,
        ...restorePoint.settings,
      }));
      window.localStorage.removeItem(BEFORE_REBALANCE_STORAGE_KEY);
      setHasRebalanceRestorePoint(false);
      setRebalanceRestoreStatus("已復原到套用再平衡前。");
    } catch (error) {
      setRebalanceRestoreStatus(
        error instanceof Error ? error.message : "無法復原上一筆再平衡資料。",
      );
    }
  }

  function updateRebalanceTargetBeta(value) {
    setRebalanceTargetBetaOverride(parseNumericInput(value));
  }

  function toggleRebalanceSelection(id) {
    setExcludedRebalanceIds((current) => {
      const idText = String(id);
      if (current.includes(idText)) {
        return current.filter((item) => item !== idText);
      }
      return [...current, idText];
    });
  }

  const handleExportBackup = useCallback(() => {
    const backup = createAppBackup({
      settings: formState,
      history: historyRecords,
    });
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `jj-invest-public-backup-${getTaipeiDateKey()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setBackupStatus("已匯出完整備份。");
  }, [formState, historyRecords]);

  const handleImportBackup = useCallback(
    async (file) => {
      if (!file) {
        return;
      }

      const confirmed = window.confirm(
        "匯入後會覆蓋目前設定；歷史紀錄會依日期合併，同一天以備份檔為準。確定繼續？",
      );
      if (!confirmed) {
        return;
      }

      try {
        const backupText = await file.text();
        const backup = parseAppBackup(backupText, DEFAULT_STATE);
        setFormState(normalizeStoredState(backup.settings));
        setHistoryRecords((current) => mergeImportedHistory(current, backup.history));
        setBackupStatus("已匯入完整備份，設定已更新，歷史紀錄已合併。");
      } catch (error) {
        setBackupStatus(error instanceof Error ? error.message : "備份檔匯入失敗。");
      }
    },
    [setFormState, setHistoryRecords],
  );

  function changeView(nextView) {
    if (nextView === activeView) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    setActiveView(nextView);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  return (
    <main className="appShell">
      <AppHeader
        status={status}
        lastUpdatedAt={lastUpdatedAt}
        onRefresh={refreshQuotes}
      />

      {(requestError ||
        quoteResult.fx.error ||
        quoteErrors.length > 0 ||
        pageCalculationErrors.length > 0) && (
        <div className="alertCard" role="alert">
          {requestError && <p>{requestError}</p>}
          {quoteResult.fx.error && <p>匯率：{quoteResult.fx.error}</p>}
          {quoteErrors.map((quote) => (
            <p key={quote.inputTicker}>
              {quote.inputTicker}：{quote.error}
            </p>
          ))}
          {pageCalculationErrors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      )}

      <section className="viewStack" aria-live="polite">
        {activeView === "overview" && (
          <>
            <BetaCard
              calculation={calculation}
              betaRail={betaRail}
              onOpenGlossary={() => setGlossaryTopic("beta")}
            />

            <MarketLevelCard
              benchmarkDrawdown={benchmarkDrawdown}
              onOpenGlossary={() => setGlossaryTopic("benchmarkDrawdown")}
            />

            <AdviceCard
              advice={advice}
            />

            <AllocationCard
              calculation={calculation}
              onOpenGlossary={() => setGlossaryTopic("allocation")}
            />
          </>
        )}

        {activeView === "operations" && (
          <OperationsView
            canApplyRebalance={canApplyRebalance}
            hasRestorePoint={hasRebalanceRestorePoint}
            operationRebalance={operationRebalance}
            onApplyRebalance={applyOneClickRebalance}
            onOpenGlossary={() => setGlossaryTopic("operations")}
            onPrecisionChange={setRebalancePrecision}
            onRestorePreviousRebalance={restorePreviousRebalance}
            onTargetBetaChange={updateRebalanceTargetBeta}
            onToggleSelection={toggleRebalanceSelection}
            precision={rebalancePrecision}
            rebalanceTargetBeta={rebalanceTargetBeta}
            restoreStatus={rebalanceRestoreStatus}
          />
        )}

        {activeView === "history" && (
          <HistoryView
            historyMode={historyMode}
            historyRangeDays={historyRangeDays}
            records={historyRecords}
            onClearHistory={() => {
              if (window.confirm("確定要清除歷史紀錄？")) {
                setHistoryRecords([]);
              }
            }}
            onSeedDemoHistory={
              isLocalPreview
                ? () => setHistoryRecords((current) => mergeDemoHistoryRecords(current))
                : null
            }
            onModeChange={setHistoryMode}
            onRangeChange={setHistoryRangeDays}
          />
        )}

        {activeView === "settings" && (
          <SettingsAccordions
            backupStatus={backupStatus}
            calculation={calculation}
            formState={formState}
            fx={quoteResult.fx}
            historyCount={historyRecords.length}
            onAddPosition={addPosition}
            onExportBackup={handleExportBackup}
            onImportBackup={handleImportBackup}
            onRemovePosition={removePosition}
            onUpdatePosition={updatePosition}
            onUpdateSetting={updateSetting}
          />
        )}
      </section>

      <BottomTabBar
        activeView={activeView}
        onChange={changeView}
      />

      <GlossaryDialog
        topic={glossaryTopic}
        onClose={() => setGlossaryTopic(null)}
      />
    </main>
  );
}

function BottomTabBar({ activeView, onChange }) {
  return (
    <nav className="bottomTabBar" aria-label="主要功能">
      <button
        type="button"
        className={activeView === "overview" ? "active" : ""}
        onClick={() => onChange("overview")}
        aria-current={activeView === "overview" ? "page" : undefined}
      >
        <span aria-hidden="true">⌂</span>
        總覽
      </button>
      <button
        type="button"
        className={activeView === "operations" ? "active" : ""}
        onClick={() => onChange("operations")}
        aria-current={activeView === "operations" ? "page" : undefined}
      >
        <span aria-hidden="true">≡</span>
        再平衡
      </button>
      <button
        type="button"
        className={activeView === "history" ? "active" : ""}
        onClick={() => onChange("history")}
        aria-current={activeView === "history" ? "page" : undefined}
      >
        <span aria-hidden="true">⌁</span>
        歷史
      </button>
      <button
        type="button"
        className={activeView === "settings" ? "active" : ""}
        onClick={() => onChange("settings")}
        aria-current={activeView === "settings" ? "page" : undefined}
      >
        <span aria-hidden="true">⚙</span>
        設定
      </button>
    </nav>
  );
}

function AppHeader({ status, lastUpdatedAt, onRefresh }) {
  return (
    <header className="appHeader">
      <div className="brandLockup">
        <span className="brandGlyph" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <div>
          <p>JJ Invest System</p>
        </div>
      </div>
      <div className="headerActions">
        <button
          type="button"
          className="headerStatusPill"
          onClick={onRefresh}
          disabled={status === "loading"}
          aria-label="更新價格"
        >
          <span>自動更新 {formatLastUpdatedAt(lastUpdatedAt)}</span>
          <em aria-hidden="true">{status === "loading" ? "..." : "↻"}</em>
        </button>
      </div>
    </header>
  );
}

function BetaCard({ calculation, betaRail, onOpenGlossary }) {
  const betaSummary = createBetaSummary({
    currentBeta: calculation.currentBeta,
    targetBeta: calculation.targetBeta,
    tolerancePct: calculation.tolerancePct,
  });

  return (
    <section className="appCard betaCard">
      <div className="betaTopline">
        <div>
          <div className="cardLabelRow">
            <p className="cardLabel">目前 Beta</p>
            <button
              type="button"
              className="infoButton"
              onClick={onOpenGlossary}
              aria-label="查看 Beta 說明"
            >
              i
            </button>
          </div>
          <div className="megaNumber">{formatNumber(calculation.currentBeta)}</div>
        </div>
        <div className="betaMetaGrid">
          <div>
            <span>目標設定</span>
            <strong>{betaSummary.targetText}</strong>
          </div>
          <div>
            <span>與目標差距</span>
            <strong>{betaSummary.driftText}</strong>
          </div>
        </div>
      </div>

      <div
        className="betaRail"
        aria-hidden="true"
        style={{
          "--beta-lower": `${betaRail.lowerPct}%`,
          "--beta-upper": `${betaRail.upperPct}%`,
          "--beta-target": `${betaRail.targetPct}%`,
          "--beta-current": `${betaRail.currentPct}%`,
        }}
      >
        <span className="targetMarker" />
        <span className="targetLabel">目標 {formatNumber(calculation.targetBeta)}</span>
        <span className="currentMarker" />
      </div>

      <div className="betaScale">
        <span>{betaRail.scaleMin}</span>
        <span>1</span>
        <span>{betaRail.scaleMax}</span>
      </div>
    </section>
  );
}

function MarketLevelCard({ benchmarkDrawdown, onOpenGlossary }) {
  if (!benchmarkDrawdown) {
    return null;
  }

  const levelLabel = {
    normal: "正常區間",
    prepare: "觀察低接",
    deep: "深度回落",
  }[benchmarkDrawdown.level] || "市場水位";

  return (
    <section className={`appCard marketLevelCard ${benchmarkDrawdown.level}`}>
      <div className="cardHeaderRow">
        <div>
          <div className="cardTitleRow">
            <h2>市場水位</h2>
            <button
              type="button"
              className="infoButton small"
              onClick={onOpenGlossary}
              aria-label="查看 0050 距收盤高點說明"
            >
              i
            </button>
          </div>
          <p>0050 距收盤高點</p>
        </div>
        <span className="marketLevelBadge">{levelLabel}</span>
      </div>

      <div className="marketLevelBody">
        <strong>{formatSignedPercent(benchmarkDrawdown.drawdownRatio)}</strong>
        <div>
          <span>
            高點 {formatNumber(benchmarkDrawdown.highPrice, 2)} · {benchmarkDrawdown.highDate}
          </span>
          <span>
            目前 {formatNumber(benchmarkDrawdown.currentPrice, 2)} · {benchmarkDrawdown.currentDate}
          </span>
        </div>
      </div>
    </section>
  );
}

function GlossaryDialog({ topic, onClose }) {
  useEffect(() => {
    if (!topic) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [topic, onClose]);

  if (!topic) {
    return null;
  }

  const isBetaTopic = topic === "beta";
  const isOperationTopic = topic === "operations";
  const isBenchmarkDrawdownTopic = topic === "benchmarkDrawdown";

  return (
    <div className="infoOverlay" role="presentation" onClick={onClose}>
      <section
        className="infoDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="glossary-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="infoDialogHeader">
          <div>
            <p className="cardLabel">名詞說明</p>
            <h2 id="glossary-title">
              {isBetaTopic
                ? "Beta"
                : isOperationTopic
                  ? "再平衡操作"
                  : isBenchmarkDrawdownTopic
                    ? "市場水位"
                    : "資產配置比例"}
            </h2>
          </div>
          <button
            type="button"
            className="infoCloseButton"
            onClick={onClose}
            aria-label="關閉名詞說明"
          >
            ×
          </button>
        </div>

        <div className="glossaryStack">
          {isBetaTopic ? (
            <article className="glossaryItem featured">
              <span>Beta</span>
              <p>Beta 代表投資組合相對市場的波動與曝險程度。</p>
              <p>Beta 1.0 約等於跟大盤同方向、同倍率變動；Beta 2.0 約等於大盤變動 1%，投組理論上變動約 2%。</p>
              <p>Beta 0.0 代表幾乎都是現金，市場漲跌對投組影響很低。</p>
              <p>目前 Beta 是依照每個標的市值占比 × 標的 Beta 加總計算。</p>
              <p>目標 Beta 是你想維持的整體曝險，例如 1.2 代表希望投組約等於 120% 市場曝險。</p>
              <p>容忍區間用來避免太頻繁調整，超出區間時才提示再平衡。</p>
            </article>
          ) : isOperationTopic ? (
            <>
              <article className="glossaryItem featured">
                <span>再平衡到 Beta</span>
                <p>這裡可以設定本次想再平衡到的 Beta，預設會帶入投資組合設定的目標 Beta。</p>
                <p>調整這個數值只影響操作頁本次試算，不會改動設定頁的目標 Beta。</p>
              </article>

              <article className="glossaryItem">
                <span>勾選方式</span>
                <p>有勾選的持股會納入本次再平衡，系統會依指定 Beta 重新計算買賣金額。</p>
                <p>取消勾選的持股本次不買不賣，庫存股數維持不變。</p>
              </article>
            </>
          ) : isBenchmarkDrawdownTopic ? (
            <>
              <article className="benchmarkIntro">
                <p>這個數字用 0050 最新收盤價，和系統抓到的歷史最高收盤價相比。</p>
                <p>例如 -6% 代表目前 0050 收盤價比歷史收盤高點低約 6%。</p>
              </article>

              <article className="glossaryItem benchmarkRules">
                <span>區間顏色</span>
                <p>-10% 以內顯示綠色，代表仍在相對正常的回落範圍。</p>
                <p>-10% 到 -20% 顯示橘色，可視為開始準備提高 Beta 低接的觀察區。</p>
                <p>-20% 以上顯示紅色，代表已經是股災等級，可以分批加碼買進，拉高 Beta 值。</p>
              </article>
            </>
          ) : (
            <>
              <article className="glossaryItem">
                <span>正二</span>
                <p>正二是 Beta 約 2 的槓桿型標的，目標是提供約兩倍市場曝險。</p>
                <p>例如 00631L、00685L、QLD 這類標的。</p>
              </article>

              <article className="glossaryItem">
                <span>原形</span>
                <p>原形是 Beta 約 1 的非槓桿標的，接近追蹤原始市場表現。</p>
                <p>例如 0050、006208 這類 ETF。</p>
              </article>

              <article className="glossaryItem">
                <span>現金</span>
                <p>現金是台幣現金與美金現金換算成台幣後的加總。</p>
                <p>資產配置比例會把正二、原形與現金一起納入總資產計算。</p>
              </article>
            </>
          )}
        </div>

        <button type="button" className="primaryButton" onClick={onClose}>
          知道了
        </button>
      </section>
    </div>
  );
}

function AdviceCard({ advice }) {
  const actionText = createAdviceActionText({
    label: advice.label,
    amount: advice.amount,
  });

  return (
    <section className="appCard adviceCard">
      <div className={`adviceIcon ${advice.tone}`} aria-hidden="true">
        <span />
      </div>
      <div className="adviceContent">
        <p className="cardLabel">今日操作建議</p>
        <p className={`adviceStatus ${advice.tone}`}>{advice.status}</p>
        <strong className={advice.tone}>{actionText}</strong>
      </div>
    </section>
  );
}

function AllocationCard({ calculation, onOpenGlossary }) {
  const cashValueTwd = calculation.totalAssetsTwd - calculation.stockValueTwd;

  return (
    <section className="appCard allocationCard">
      <div className="cardHeaderRow">
        <div>
          <div className="cardTitleRow">
            <h2>資產配置比例</h2>
            <button
              type="button"
              className="infoButton small"
              onClick={onOpenGlossary}
              aria-label="查看正二、原形與現金說明"
            >
              i
            </button>
          </div>
          <p>正二、原形與現金配置</p>
        </div>
        <div className="allocationTotal">
          <span>總資產</span>
          <strong>{formatTwd(calculation.totalAssetsTwd)}</strong>
        </div>
      </div>
      <AllocationBar
        leveragedRatio={calculation.leveragedRatio}
        originalRatio={calculation.originalRatio}
        cashRatio={calculation.cashRatio}
      />
      <div className="allocationLegend">
        <AllocationMetric
          color="purple"
          label="正二"
          current={calculation.leveragedRatio}
          target={calculation.targetLeveragedRatio}
          valueTwd={calculation.leveragedValueTwd}
        />
        <AllocationMetric
          color="teal"
          label="原形"
          current={calculation.originalRatio}
          target={calculation.targetOriginalRatio}
          valueTwd={calculation.originalValueTwd}
        />
        <AllocationMetric
          color="blue"
          label="現金"
          current={calculation.cashRatio}
          target={calculation.afterCashRatio}
          valueTwd={cashValueTwd}
        />
      </div>
    </section>
  );
}

function AllocationBar({ leveragedRatio, originalRatio, cashRatio }) {
  const safeLeveragedRatio = Math.min(Math.max(leveragedRatio, 0), 1);
  const safeOriginalRatio = Math.min(Math.max(originalRatio, 0), 1);
  const safeCashRatio = Math.min(Math.max(cashRatio, 0), 1);

  return (
    <div
      className="allocationBar"
      aria-label={`正二 ${formatPercent(safeLeveragedRatio)}，原形 ${formatPercent(safeOriginalRatio)}，現金 ${formatPercent(safeCashRatio)}`}
    >
      <span className="allocationLeveraged" style={{ width: `${safeLeveragedRatio * 100}%` }} />
      <span className="allocationOriginal" style={{ width: `${safeOriginalRatio * 100}%` }} />
      <span className="allocationCash" style={{ width: `${safeCashRatio * 100}%` }} />
    </div>
  );
}

function AllocationMetric({ color, label, current, target, valueTwd }) {
  return (
    <div className="legendItem allocationMetric">
      <span className={color} aria-hidden="true" />
      <strong>{label}</strong>
      <em>{formatPercent(current)}</em>
      <small>目標 {formatPercent(target)}</small>
      <small>市值 {formatTwd(valueTwd)}</small>
    </div>
  );
}

function getHistoryChartRecords(records, rangeDays) {
  const limit = Number(rangeDays) === 7 ? 7 : 30;
  return records.slice(-limit);
}

function HistoryView({
  historyMode,
  historyRangeDays,
  records,
  onClearHistory,
  onModeChange,
  onRangeChange,
  onSeedDemoHistory,
}) {
  const summary = createHistorySummary(records);
  const chartRecords = getHistoryChartRecords(records, historyRangeDays);
  const chartModel = createHistoryChartModel(chartRecords, historyMode);
  const series = createPerformanceSeries(records).slice().reverse();
  const hasRecords = records.length > 0;

  if (!hasRecords) {
    return (
      <section className="appCard historyEmptyCard">
        <p className="cardLabel">歷史</p>
        <h2>尚無歷史資料</h2>
        <p>成功更新價格後會自動記錄今日。</p>
        {onSeedDemoHistory ? (
          <button type="button" className="secondaryButton" onClick={onSeedDemoHistory}>
            載入示範曲線
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <section className="historyStack" aria-label="歷史紀錄">
      <section className="appCard historySummaryCard">
        <div className="cardHeaderRow">
          <div>
            <h2>歷史紀錄</h2>
            <p>總資產、Beta 與 0050 同日起始比較</p>
          </div>
          <span className="historyDatePill">{summary.latestDate}</span>
        </div>
        <div className="historySummaryGrid">
          <HistoryMetric label="最新總資產" value={formatTwd(summary.latestTotalAssetsTwd)} />
          <HistoryMetric label="最新 Beta" value={formatNumber(summary.latestBeta)} />
          <HistoryMetric label="投組累積報酬" value={formatSignedPercent(summary.portfolioReturn)} />
          <HistoryMetric label="0050 累積報酬" value={formatSignedPercent(summary.benchmarkReturn)} />
        </div>
      </section>

      <section className="appCard historyChartCard">
        <div className="historyChartControls">
          <div className="historyModeTabs" aria-label="歷史圖表切換">
            <button
              type="button"
              className={historyMode === "performance" ? "active" : ""}
              onClick={() => onModeChange("performance")}
            >
              績效
            </button>
            <button
              type="button"
              className={historyMode === "beta" ? "active" : ""}
              onClick={() => onModeChange("beta")}
            >
              Beta
            </button>
          </div>
          <div className="historyRangeTabs" aria-label="歷史時間範圍">
            <button
              type="button"
              className={historyRangeDays === "7" ? "active" : ""}
              onClick={() => onRangeChange("7")}
            >
              7天
            </button>
            <button
              type="button"
              className={historyRangeDays === "30" ? "active" : ""}
              onClick={() => onRangeChange("30")}
            >
              30天
            </button>
          </div>
        </div>
        <HistoryChart model={chartModel} />
      </section>

      <section className="appCard historyRecordsCard">
        <div className="cardHeaderRow">
          <div>
            <h2>最近紀錄</h2>
            <p>同一天更新會覆蓋為最新快照</p>
          </div>
        </div>
        <div className="historyRecordsList">
          {series.slice(0, 14).map((record) => (
            <article className="historyRecord" key={record.date}>
              <div>
                <strong>{record.date}</strong>
                <span>Beta {formatNumber(record.currentBeta)}</span>
              </div>
              <div>
                <strong>{formatTwd(record.totalAssetsTwd)}</strong>
                <span>
                  投組 {formatSignedPercent(record.portfolioReturn)} · 0050{" "}
                  {record.benchmarkReturn === null
                    ? "資料不足"
                    : formatSignedPercent(record.benchmarkReturn)}
                </span>
              </div>
            </article>
          ))}
        </div>
        <div className="historyActions">
          {onSeedDemoHistory ? (
            <button type="button" className="secondaryButton" onClick={onSeedDemoHistory}>
              載入示範曲線
            </button>
          ) : null}
          <button type="button" className="dangerTextButton" onClick={onClearHistory}>
            清除歷史紀錄
          </button>
        </div>
      </section>
    </section>
  );
}

function HistoryMetric({ label, value }) {
  return (
    <div className="historyMetric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function HistoryChart({ model }) {
  const [activePointState, setActivePointState] = useState(null);
  const activePointIndex =
    activePointState?.mode === model.mode ? activePointState.index : null;
  const activePoint =
    activePointIndex === null ? null : model.dataPoints[activePointIndex] || null;
  const setActivePointIndex = (index) => setActivePointState({ mode: model.mode, index });

  if (model.labels.length < 2) {
    return (
      <div className="historyChartEmpty">
        累積兩筆以上紀錄後會顯示曲線。
      </div>
    );
  }

  return (
    <div className="historyChartWrap">
      <svg
        className="historyChartSvg"
        viewBox={`0 0 ${model.width} ${model.height}`}
        role="img"
        aria-label={model.mode === "beta" ? "Beta 歷史曲線" : "投組與 0050 績效曲線"}
        preserveAspectRatio="none"
        onPointerLeave={() => setActivePointState(null)}
      >
        {model.yTicks.map((tick) => (
          <g className="historyGridLine" key={tick.label}>
            <line x1={model.plot.left} y1={tick.y} x2={model.width - model.plot.right} y2={tick.y} />
            <text x={model.plot.left - 6} y={tick.y} dominantBaseline="middle" textAnchor="end">
              {tick.label}
            </text>
          </g>
        ))}
        <line
          className="historyAxisLine"
          x1={model.plot.left}
          y1={model.height - model.plot.bottom}
          x2={model.width - model.plot.right}
          y2={model.height - model.plot.bottom}
        />
        {model.mode === "beta" ? (
          <>
            <polyline className="historyLine tolerance" points={model.upperPoints} />
            <polyline className="historyLine tolerance" points={model.lowerPoints} />
            <polyline className="historyLine benchmark" points={model.targetPoints} />
            <polyline className="historyLine portfolio" points={model.betaPoints} />
          </>
        ) : (
          <>
            <polyline className="historyLine benchmark" points={model.benchmarkPoints} />
            <polyline className="historyLine portfolio" points={model.portfolioPoints} />
          </>
        )}
        {model.xTicks.map((tick) => (
          <text
            className="historyXAxisLabel"
            key={`${tick.label}-${tick.x}`}
            x={tick.x}
            y={model.height - 4}
            textAnchor={tick.anchor}
          >
            {tick.label}
          </text>
        ))}
        {model.dataPoints.map((point, index) => (
          <g className="historyHitPoint" key={point.date}>
            <line
              className={activePointIndex === index ? "active" : ""}
              x1={point.x}
              y1={model.plot.top}
              x2={point.x}
              y2={model.height - model.plot.bottom}
            />
            <circle
              className={activePointIndex === index ? "visible" : ""}
              cx={point.x}
              cy={point.y}
              r="3.2"
            />
            <circle
              className="hitArea"
              cx={point.x}
              cy={point.y}
              r="12"
              tabIndex="0"
              role="button"
              aria-label={`${point.date} 歷史數據`}
              onFocus={() => setActivePointIndex(index)}
              onPointerEnter={() => setActivePointIndex(index)}
              onClick={() => setActivePointIndex(index)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setActivePointIndex(index);
                }
              }}
            />
          </g>
        ))}
      </svg>
      {activePoint ? (
        <div
          className={`historyTooltip ${
            activePoint.x > model.width * 0.72
              ? "alignRight"
              : activePoint.x < model.width * 0.28
                ? "alignLeft"
                : ""
          }`}
          style={{
            left: `${(activePoint.x / model.width) * 100}%`,
            top: `${(activePoint.y / model.height) * 100}%`,
          }}
        >
          <strong>{activePoint.date}</strong>
          {model.mode === "beta" ? (
            <>
              <span>目前 Beta {formatNumber(activePoint.currentBeta)}</span>
              <span>目標 {formatNumber(activePoint.targetBeta)}</span>
              <span>
                區間 {formatNumber(activePoint.betaLower)} ~ {formatNumber(activePoint.betaUpper)}
              </span>
            </>
          ) : (
            <>
              <span>總資產 {formatTwd(activePoint.totalAssetsTwd)}</span>
              <span>投組 {formatSignedPercent(activePoint.portfolioReturn)}</span>
              <span>
                0050{" "}
                {activePoint.benchmarkReturn === null
                  ? "資料不足"
                  : formatSignedPercent(activePoint.benchmarkReturn)}
              </span>
            </>
          )}
        </div>
      ) : null}
      <div className="historyLegend">
        {model.mode === "beta" ? (
          <>
            <span><i className="portfolio" />目前 Beta</span>
            <span><i className="benchmark" />目標 Beta</span>
            <span><i className="tolerance" />容忍區間</span>
          </>
        ) : (
          <>
            <span><i className="portfolio" />投組</span>
            <span><i className="benchmark" />0050</span>
          </>
        )}
      </div>
    </div>
  );
}

function OperationsView({
  canApplyRebalance,
  hasRestorePoint,
  operationRebalance,
  onApplyRebalance,
  onOpenGlossary,
  onPrecisionChange,
  onRestorePreviousRebalance,
  onTargetBetaChange,
  onToggleSelection,
  precision,
  rebalanceTargetBeta,
  restoreStatus,
}) {
  const { recommendations, summary, warnings } = operationRebalance;
  const appliedAfterBeta = getAppliedAfterBeta({
    precision,
    recommendations,
    totalAssetsTwd: operationRebalance.totalAssetsTwd,
  });
  const appliedTotalTradeAmount = getAppliedTotalTradeAmount({
    precision,
    recommendations,
  });

  return (
    <section className="appCard operationsPageCard">
      <div className="cardHeaderRow">
        <div>
          <div className="cardTitleRow">
            <h2>再平衡參數設定</h2>
            <button
              type="button"
              className="infoButton small"
              onClick={onOpenGlossary}
              aria-label="查看再平衡操作說明"
            >
              i
            </button>
          </div>
          <p>
            共 {summary.actionCount} 筆操作 / 調整後 Beta {formatNumber(appliedAfterBeta)} / 預估調整{" "}
            {formatTwd(appliedTotalTradeAmount)}
          </p>
        </div>
      </div>
      <div className="operationParameterCard">
        <label className="operationBetaField">
          <span>再平衡到 Beta</span>
          <input
            type="number"
            min="0"
            max="2"
            step="0.01"
            value={rebalanceTargetBeta}
            onChange={(event) => onTargetBetaChange(event.target.value)}
          />
        </label>
        <div className="operationPrecisionField">
          <span>台股交易精度</span>
          <div className="precisionControl" aria-label="再平衡精度">
            <label className={precision === "lots" ? "selected" : ""}>
              <input
                type="radio"
                name="rebalancePrecision"
                value="lots"
                checked={precision === "lots"}
                onChange={() => onPrecisionChange("lots")}
              />
              精確到張數
            </label>
            <label className={precision === "shares" ? "selected" : ""}>
              <input
                type="radio"
                name="rebalancePrecision"
                value="shares"
                checked={precision === "shares"}
                onChange={() => onPrecisionChange("shares")}
              />
              精確到股數
            </label>
          </div>
          <p>美股固定精確到股數。</p>
        </div>
      </div>
      {warnings.map((warning) => (
        <div className="operationWarning" role="status" key={warning}>
          {warning}
        </div>
      ))}
      <HoldingList
        recommendations={recommendations}
        onToggleSelection={onToggleSelection}
        precision={precision}
        totalAssetsTwd={operationRebalance.totalAssetsTwd}
      />
      <div className="operationApplyFooter">
        <div>
          <span>確認清單後套用</span>
          <p>會依上方精度更新持股股數與現金，套用前會自動保留復原點。</p>
        </div>
        <div className="operationApplyActions">
          <button
            type="button"
            className="primaryButton"
            onClick={onApplyRebalance}
            disabled={!canApplyRebalance}
          >
            套用再平衡結果
          </button>
          {hasRestorePoint ? (
            <button
              type="button"
              className="secondaryButton restoreButton"
              onClick={onRestorePreviousRebalance}
            >
              復原上一步
            </button>
          ) : null}
        </div>
        {restoreStatus ? <p className="operationRestoreStatus">{restoreStatus}</p> : null}
      </div>
    </section>
  );
}

function getAppliedTotalTradeAmount({ recommendations, precision }) {
  return recommendations.reduce(
    (sum, item) => sum + Math.abs(getAppliedRebalanceShareDelta(item, precision) * item.priceTwd),
    0,
  );
}

function getAppliedAfterBeta({ recommendations, totalAssetsTwd, precision }) {
  const totalAssets = Number(totalAssetsTwd);
  if (!Number.isFinite(totalAssets) || totalAssets <= 0) {
    return 0;
  }

  return recommendations.reduce((sum, item) => {
    const appliedDeltaShares = getAppliedRebalanceShareDelta(item, precision);
    const afterValueTwd = Math.max(
      item.currentValueTwd + appliedDeltaShares * item.priceTwd,
      0,
    );

    return sum + (afterValueTwd / totalAssets) * Number(item.assetBeta || 0);
  }, 0);
}

function HoldingList({ recommendations, onToggleSelection, precision, totalAssetsTwd }) {
  const leveragedRecommendations = recommendations.filter(
    (item) => getHoldingAssetType(item.assetBeta) === "leveraged",
  );
  const originalRecommendations = recommendations.filter(
    (item) => getHoldingAssetType(item.assetBeta) === "original",
  );

  return (
    <section className="holdingsCard">
      <div className="holdingGroups">
        <HoldingGroup
          items={leveragedRecommendations}
          onToggleSelection={onToggleSelection}
          precision={precision}
          tone="leveraged"
          title="正二再平衡清單"
          totalAssetsTwd={totalAssetsTwd}
        />
        <HoldingGroup
          items={originalRecommendations}
          onToggleSelection={onToggleSelection}
          precision={precision}
          tone="original"
          title="原形再平衡清單"
          totalAssetsTwd={totalAssetsTwd}
        />
        {recommendations.length === 0 && (
          <div className="emptyState">更新價格後會顯示再平衡操作清單。</div>
        )}
      </div>
    </section>
  );
}

function getHoldingAssetType(assetBeta) {
  return Number(assetBeta) >= 1.5 ? "leveraged" : "original";
}

function HoldingGroup({ items, onToggleSelection, precision, title, tone, totalAssetsTwd }) {
  if (items.length === 0) {
    return null;
  }

  const totalValueTwd = items.reduce((sum, item) => sum + item.currentValueTwd, 0);
  const allocationRatio = totalAssetsTwd > 0 ? totalValueTwd / totalAssetsTwd : 0;
  const itemsWithAppliedAfterValue = items.map((item) => {
    const appliedDeltaShares = getAppliedRebalanceShareDelta(item, precision);
    return {
      ...item,
      appliedAfterValueTwd: Math.max(
        item.currentValueTwd + appliedDeltaShares * item.priceTwd,
        0,
      ),
    };
  });
  const appliedAfterTotalValue = itemsWithAppliedAfterValue.reduce(
    (sum, item) => sum + item.appliedAfterValueTwd,
    0,
  );
  const appliedAfterAllocationRatio =
    totalAssetsTwd > 0 ? appliedAfterTotalValue / totalAssetsTwd : 0;
  const itemsWithAppliedAfterWeight = itemsWithAppliedAfterValue.map((item) => ({
    ...item,
    appliedAfterSleeveWeight:
      appliedAfterTotalValue > 0 ? item.appliedAfterValueTwd / appliedAfterTotalValue : 0,
  }));

  return (
    <section className={`holdingGroup ${tone}`} aria-label={title}>
      <div className="holdingGroupHeader">
        <div>
          <strong>{title}</strong>
          <span>{items.length} 檔標的 / 調整後市值 {formatTwd(appliedAfterTotalValue)}</span>
        </div>
        <em className="holdingGroupAllocation">
          <span>目前 {formatPercent(allocationRatio)}</span>
          <span>調整後 {formatPercent(appliedAfterAllocationRatio)}</span>
        </em>
      </div>
      <div className="holdingList">
        {itemsWithAppliedAfterWeight.map((item) => (
          <HoldingRow
            item={item}
            key={item.id}
            onToggleSelection={onToggleSelection}
            precision={precision}
          />
        ))}
      </div>
    </section>
  );
}

function HoldingRow({ item, onToggleSelection, precision }) {
  const estimatedShares = Math.abs(getAppliedRebalanceShareDelta(item, precision));
  const displayedAction = !item.isSelected || estimatedShares === 0 ? "none" : item.action;
  const actionText = item.isSelected ? getActionText(displayedAction) : "不納入再平衡清單";
  const displayedTradeAmountTwd = estimatedShares * item.priceTwd;
  const drift = item.currentSleeveWeight - item.targetSleeveWeight;
  const driftClass = getDriftClass(drift);
  const currentPct = clampPercent(item.currentSleeveWeight);
  const targetPct = clampPercent(item.targetSleeveWeight);
  const afterSleeveWeight = item.appliedAfterSleeveWeight ?? item.afterSleeveWeight;
  const afterPct = clampPercent(afterSleeveWeight);

  return (
    <article className={`holdingRow ${item.isSelected ? "" : "unselected"}`}>
      <div className="holdingAsset">
        <label className="holdingSelect">
          <input
            type="checkbox"
            checked={item.isSelected}
            onChange={() => onToggleSelection(item.id)}
            aria-label={`${item.normalizedTicker} 是否納入本次再平衡`}
          />
        </label>
        <div className={`tickerBadge ${displayedAction}`}>
          {getTickerBadgeText(item.normalizedTicker)}
        </div>
        <div className="holdingIdentity">
          <strong>{item.normalizedTicker}</strong>
          <span>{getPositionDisplayName(item.normalizedTicker, item.assetBeta)}</span>
          <em>市值 {formatTwd(item.currentValueTwd)}</em>
          <em>股價 {formatQuotePrice(item.price, item.currency)} · 更新 {formatQuoteDate(item.date)}</em>
        </div>
      </div>

      <div className="holdingRatioPanel">
        <div
          className={`holdingProgress ${driftClass}`}
          style={{
            "--current-ratio": `${currentPct}%`,
            "--target-ratio": `${targetPct}%`,
            "--after-ratio": `${afterPct}%`,
          }}
          aria-label={`目前 ${formatPercent(item.currentSleeveWeight)}，目標 ${formatPercent(item.targetSleeveWeight)}，再平衡後 ${formatPercent(afterSleeveWeight)}`}
        >
          <span className="holdingProgressFill" />
          <span className="holdingProgressTarget" />
          <span className="holdingProgressAfter" />
        </div>
        <div className="holdingRatioLabels">
          <span>目前 {formatPercent(item.currentSleeveWeight)}</span>
          <span>目標 {formatPercent(item.targetSleeveWeight)}</span>
        </div>
        <div className="holdingRatioLabels after">
          <span>再平衡後 {formatPercent(afterSleeveWeight)}</span>
        </div>
        <div className="holdingDrift">
          距離目標{" "}
          <strong className={driftClass}>{formatSignedPercent(drift)}</strong>
        </div>
      </div>

      <div className="holdingAction">
        <span className={`actionPill ${displayedAction}`}>{actionText}</span>
        <strong>{formatTwd(displayedTradeAmountTwd)}</strong>
        <em>{estimatedShares.toLocaleString("zh-TW")} 股</em>
      </div>
    </article>
  );
}

function PositionSection({
  addLabel,
  emptyText,
  errorText,
  formState,
  onAddPosition,
  onRemovePosition,
  onUpdatePosition,
  positions,
  status,
  title,
}) {
  return (
    <section className={`positionSection ${status.isValid ? "ok" : "error"}`}>
      <div className="positionSectionHeader">
        <div>
          <strong>{title}</strong>
          <span>{positions.length} 筆標的</span>
        </div>
        <em>合計 {formatNumber(status.totalPct)}% / 100%</em>
      </div>

      <div className="positionList">
        {positions.map((position, index) => (
          <div className="positionEditor" key={position.id}>
            <div className="positionTitle">
              <strong>{title} {index + 1}</strong>
              <button
                type="button"
                className="textButton"
                onClick={() => onRemovePosition(position.id)}
                disabled={formState.positions.length === 1}
              >
                移除
              </button>
            </div>
            <label>
              <span>代號</span>
              <input
                value={position.tickerInput}
                onChange={(event) =>
                  onUpdatePosition(position.id, "tickerInput", event.target.value)
                }
                placeholder="00631L 或 QLD"
              />
            </label>
            <div className="twoCol">
              <label>
                <span>股數</span>
                <input
                  type="number"
                  min="0"
                  value={position.shares}
                  onChange={(event) =>
                    onUpdatePosition(position.id, "shares", event.target.value)
                  }
                />
              </label>
              <label>
                <span>同類資產內目標比例 %</span>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={position.targetWeightPct}
                  aria-invalid={!status.isValid}
                  onChange={(event) =>
                    onUpdatePosition(position.id, "targetWeightPct", event.target.value)
                  }
                />
              </label>
            </div>
            {!status.isValid && <p className="fieldError">{errorText}</p>}
            <p className="hint">
              正規化代號：{normalizeTicker(position.tickerInput) || "尚未輸入"}
            </p>
          </div>
        ))}
        {positions.length === 0 && <div className="emptyState compact">{emptyText}</div>}
      </div>

      <button type="button" className="secondaryButton fullWidth" onClick={onAddPosition}>
        {addLabel}
      </button>
    </section>
  );
}

function SettingsAccordions({
  backupStatus,
  calculation,
  formState,
  fx,
  historyCount,
  onAddPosition,
  onExportBackup,
  onImportBackup,
  onRemovePosition,
  onUpdatePosition,
  onUpdateSetting,
}) {
  const positionGroups = getPositionGroups(formState.positions);
  const leveragedStatus = getPositionGroupTargetStatus({
    positions: positionGroups.leveraged,
    targetRatio: calculation.targetLeveragedRatio,
  });
  const originalStatus = getPositionGroupTargetStatus({
    positions: positionGroups.original,
    targetRatio: calculation.targetOriginalRatio,
  });
  const hasOriginalTarget = Number(formState.originalTargetPct) > 0;
  const hasOriginalPositions = formState.positions.some((position) => Number(position.assetBeta) === 1);
  const betaErrors = calculation.errors.filter((error) => !TARGET_WEIGHT_ERROR_MESSAGES.has(error));
  const betaGuardIsValid = betaErrors.length === 0;
  const [activeSettingsPage, setActiveSettingsPage] = useState("cash");

  return (
    <section className="settingsStack" aria-label="參數設定">
      <div className="settingsIntro">
        <div>
          <p>參數設定</p>
          <span>調整持股、現金與 Beta 試算條件</span>
        </div>
      </div>

      <div className="settingsPanel settingsPagePanel">
        <nav className="settingsSubTabs" aria-label="設定分類">
          {[
            { id: "cash", label: "現金" },
            { id: "positions", label: "持股" },
            { id: "beta", label: "Beta 參數" },
          ].map((item) => (
            <button
              type="button"
              key={item.id}
              className={activeSettingsPage === item.id ? "active" : ""}
              onClick={() => setActiveSettingsPage(item.id)}
              aria-current={activeSettingsPage === item.id ? "page" : undefined}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="settingsBody">
          {activeSettingsPage === "cash" && (
            <div className="positionEditor cashEditor">
              <div className="positionTitle">
                <strong>現金</strong>
              </div>
              <div className="cashFxInfo">
                <span>USD/TWD 匯率</span>
                <strong>{fx.usdTwd ? numberDisplay.format(fx.usdTwd) : "尚未更新"}</strong>
                <em>更新 {formatQuoteDate(fx.date)}</em>
              </div>
              <p className="hint">現金分類</p>
              <div className="twoCol">
                <label>
                  <span>新台幣 TWD</span>
                  <input
                    type="number"
                    step="1"
                    value={parseIntegerInput(formState.cashTwd)}
                    onChange={(event) => onUpdateSetting("cashTwd", event.target.value)}
                  />
                </label>
                <label>
                  <span>美金 USD</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={parseIntegerInput(formState.cashUsd)}
                    onChange={(event) => onUpdateSetting("cashUsd", event.target.value)}
                  />
                </label>
              </div>
              <p className="hint">美金現金會用最新 USD/TWD 匯率換算，與新台幣相加後顯示總現金市值。</p>
            </div>
          )}

          {activeSettingsPage === "positions" && (
            <>
              <div className="settingsSummaryLine">
                <strong>{formState.positions.length} 筆標的</strong>
                <span>
                  正二 {formatNumber(leveragedStatus.totalPct)}%
                  {hasOriginalPositions ? ` / 原形 ${formatNumber(originalStatus.totalPct)}%` : ""}
                </span>
              </div>
              <div className="positionSections">
                <PositionSection
                  addLabel="新增正二"
                  emptyText="尚未設定正二標的。"
                  errorText="正二標的目標比例合計必須等於 100%。"
                  formState={formState}
                  onAddPosition={() => onAddPosition(2)}
                  onRemovePosition={onRemovePosition}
                  onUpdatePosition={onUpdatePosition}
                  positions={positionGroups.leveraged}
                  status={leveragedStatus}
                  title="正二"
                />
                {(hasOriginalTarget || hasOriginalPositions) && (
                  <PositionSection
                    addLabel="新增原形"
                    emptyText="原形目標比例大於 0 時，請新增至少一個原形標的。"
                    errorText="原形標的目標比例合計必須等於 100%。"
                    formState={formState}
                    onAddPosition={() => onAddPosition(1)}
                    onRemovePosition={onRemovePosition}
                    onUpdatePosition={onUpdatePosition}
                    positions={positionGroups.original}
                    status={originalStatus}
                    title="原形"
                  />
                )}
                {!hasOriginalTarget && !hasOriginalPositions && (
                  <button
                    type="button"
                    className="secondaryButton fullWidth"
                    onClick={() => onAddPosition(1)}
                  >
                    新增原形
                  </button>
                )}
              </div>
            </>
          )}

          {activeSettingsPage === "beta" && (
            <>
          <div className={`weightGuard ${betaGuardIsValid ? "ok" : "error"}`}>
            <strong>
              推算目標：正二 {formatPercent(calculation.targetLeveragedRatio)} / 原形{" "}
              {formatPercent(calculation.targetOriginalRatio)} / 現金{" "}
              {formatPercent(calculation.afterCashRatio)}
            </strong>
            <span>
              {betaGuardIsValid
                ? "依照下方 Beta 核心參數與原形配置即時計算。"
                : betaErrors.join(" ")}
            </span>
          </div>
          <div className="positionEditor betaParameterGroup">
            <div className="positionTitle">
              <strong>Beta 核心參數</strong>
            </div>
            <div className="twoCol">
              <label>
                <span>目標 Beta</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formState.targetBeta}
                  onChange={(event) => onUpdateSetting("targetBeta", event.target.value)}
                />
              </label>
              <label>
                <span>容忍區間 %</span>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={formState.tolerancePct}
                  onChange={(event) => onUpdateSetting("tolerancePct", event.target.value)}
                />
              </label>
            </div>
          </div>
          <div className="positionEditor betaParameterGroup secondary">
            <div className="positionTitle">
              <strong>原形配置</strong>
            </div>
            <label>
              <span>原形目標比例 %</span>
              <input
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={formState.originalTargetPct}
                onChange={(event) => onUpdateSetting("originalTargetPct", event.target.value)}
              />
            </label>
            <p className="hint">會先保留原形比例，再自動推算需要多少正二與現金。</p>
          </div>
            </>
          )}

        </div>
      </div>

      <div className="settingsPanel backupPanel">
        <div className="backupHeader">
          <div>
            <h2>資料備份</h2>
            <p>完整備份目前瀏覽器內的現金、持股、Beta 參數與歷史紀錄。</p>
          </div>
          <span>{historyCount} 筆歷史</span>
        </div>

        <div className="backupActions">
          <button type="button" className="primaryButton" onClick={onExportBackup}>
            匯出完整備份
          </button>
          <label className="secondaryButton backupImportButton">
            匯入完整備份
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const [file] = event.target.files || [];
                onImportBackup(file);
                event.target.value = "";
              }}
            />
          </label>
        </div>

        <p className="hint">
          匯入時會覆蓋目前設定；歷史紀錄會依日期合併，同一天以備份檔為準，不會刪掉備份檔沒有的新日期。
        </p>
        {backupStatus ? <p className="backupStatus">{backupStatus}</p> : null}
      </div>
    </section>
  );
}
