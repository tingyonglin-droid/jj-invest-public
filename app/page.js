"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { OverviewCardHeader } from "../src/components/overview-card-header.js";
import {
  AUTO_REFRESH_INTERVAL_MS,
  createLatestQuoteRequestCoordinator,
  createQuoteRetryController,
  getVisibleCalculationErrors,
  hasCompletePriorQuoteResult,
  mergeQuoteResults,
  shouldAutoRefreshQuotes,
} from "../src/lib/auto-refresh.js";
import {
  createAppBackup,
  deriveLegacyTargetBeta,
  mergeImportedHistory,
  parseAppBackup,
} from "../src/lib/backup.js";
import { createBenchmarkDrawdown } from "../src/lib/benchmark-drawdown.js";
import {
  createBenchmarkDrawdownChart,
  filterBenchmarkHistoryByRange,
  getMarketLevelLabel,
  getNearestMarketPointIndex,
} from "../src/lib/benchmark-drawdown-chart.js";
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
  getCashEquivalentTargetStatus,
  getCashSleeveTargets,
} from "../src/lib/cash-equivalents.js";
import {
  addHistoryPerformanceAdjustment,
  createHistoryStackedChartModel,
  createHistorySnapshot,
  createHistorySummary,
  createPerformanceSeries,
  filterHistoryRecordsByRange,
  getTaipeiDateKey,
  mergeDemoHistoryRecords,
  normalizeHistoryRecords,
  selectBenchmark0050SnapshotPrice,
  shouldSaveHistorySnapshotForDate,
  upsertDailyHistorySnapshot,
} from "../src/lib/history.js";
import {
  createHistoryRestorePoint,
  parseHistoryRestorePoint,
} from "../src/lib/history-restore.js";
import { normalizeTicker } from "../src/lib/market-data.js";
import {
  createOverviewAction,
  isPortfolioSetupComplete,
} from "../src/lib/overview-action.js";
import { calculatePortfolio } from "../src/lib/portfolio.js";
import {
  applyRebalanceToState,
  createFundedRebalanceRecommendations,
  getAppliedRebalanceSummary,
  getAppliedRebalanceShareDelta,
  getCashSleeveValueAfterStockTrades,
} from "../src/lib/rebalance-apply.js";
import {
  createRebalanceRestorePoint,
  parseRebalanceRestorePoint,
} from "../src/lib/rebalance-restore.js";
import {
  adjustOperationTargetBeta,
  createOperationRebalance,
  getOperationRebalanceStatus,
} from "../src/lib/operation-rebalance.js";
import {
  getPositionGroups,
  getPositionGroupTargetStatus,
  initializePositionTargetWeights,
  removePositionFromSettings,
} from "../src/lib/position-settings.js";
import {
  getActionText,
  getEstimatedShares,
  formatExposureMultiplier,
  getPositionDisplayName,
  getTickerDefaultAssetBeta,
  getTickerDisplayText,
  getTickerPlaceholder,
} from "../src/lib/presentation.js";
import {
  isQuoteableTickerInput,
  normalizeLegacyGhostPosition,
} from "../src/lib/stored-state.js";

const STORAGE_KEY = "jj-invest-public-overview-v1";
const HISTORY_STORAGE_KEY = "jj-invest-public-history-v1";
const BEFORE_REBALANCE_STORAGE_KEY = "jj-invest-public-before-rebalance-v1";
const BEFORE_CLEAR_HISTORY_STORAGE_KEY = "jj-invest-public-before-clear-history-v1";
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0";
const BENCHMARK_HISTORY_FROM = "2003-06-30";

const DEFAULT_STATE = {
  positions: [
    {
      id: "position-1",
      tickerInput: "",
      shares: 0,
      assetBeta: "",
      assetTypeHint: "leveraged",
      targetWeightPct: 0,
    },
  ],
  cashTwd: 0,
  cashUsd: 0,
  cashEquivalentPositions: [],
  cashEquivalentMode: "auto",
  realCashTargetPct: 10,
  targetBeta: "",
  originalAllocationMode: "current",
  leveragedTargetPct: 60,
  originalTargetPct: 0,
  tolerancePct: 10,
  allocationModes: { leveraged: "auto", original: "auto" },
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

function formatBetaScaleTick(value) {
  return numberDisplay.format(Number.isFinite(value) ? value : 0);
}

function formatPercent(ratio) {
  return percentDisplay.format(Number.isFinite(ratio) ? ratio : 0);
}

function formatSignedPercent(ratio) {
  const safeRatio = Number.isFinite(ratio) ? ratio : 0;
  return `${safeRatio > 0 ? "+" : ""}${formatPercent(safeRatio)}`;
}

function formatNetTradeAmount(value) {
  if (Math.abs(value) < 0.5) {
    return "不需調整";
  }
  return `${value > 0 ? "淨買入" : "淨賣出"} ${formatTwd(Math.abs(value))}`;
}

function formatCashDelta(value) {
  if (Math.abs(value) < 0.5) {
    return "無變化";
  }
  return `${value > 0 ? "淨增加" : "淨減少"} ${formatTwd(Math.abs(value))}`;
}

function formatQuoteDate(date) {
  return date || "尚未更新";
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
  const modes = state.allocationModes || DEFAULT_STATE.allocationModes;
  return {
    ...state,
    cashTwd: parseIntegerInput(state.cashTwd),
    cashUsd: parseIntegerInput(state.cashUsd ?? 0),
    cashEquivalentMode: state.cashEquivalentMode === "custom" ? "custom" : "auto",
    realCashTargetPct: parseNumericInput(state.realCashTargetPct ?? 10),
    cashEquivalentPositions: (state.cashEquivalentPositions || []).map((position) => ({
      ...position,
      shares: parseIntegerInput(position.shares),
      targetWeightPct: parseNumericInput(position.targetWeightPct ?? 0),
    })),
    originalTargetPct: parseNumericInput(state.originalTargetPct ?? DEFAULT_STATE.originalTargetPct),
    originalAllocationMode: state.originalAllocationMode === "custom" ? "custom" : "current",
    targetBeta: parseNumericInput(state.targetBeta ?? DEFAULT_STATE.targetBeta),
    allocationModes: {
      leveraged: modes.leveraged === "custom" ? "custom" : "auto",
      original: modes.original === "custom" ? "custom" : "auto",
    },
    positions: (state.positions || DEFAULT_STATE.positions).map((position) => {
      const normalizedPosition = normalizeLegacyGhostPosition(position);
      return {
        ...normalizedPosition,
        assetBeta: normalizedPosition.assetBeta === ""
          ? ""
          : Number.isFinite(Number(normalizedPosition.assetBeta))
          ? Number(normalizedPosition.assetBeta)
          : 2,
        assetTypeHint: normalizedPosition.assetTypeHint || (
          Number(normalizedPosition.assetBeta) > 1 ? "leveraged" : "original"
        ),
        targetWeightPct: parseNumericInput(normalizedPosition.targetWeightPct ?? 0),
      };
    }),
  };
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

function clampPercent(value) {
  return Math.min(Math.max((Number.isFinite(value) ? value : 0) * 100, 0), 100);
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
          const parsedState = JSON.parse(saved);
          setState(normalizeStoredState({
            ...DEFAULT_STATE,
            ...parsedState,
            targetBeta: parsedState.targetBeta ?? deriveLegacyTargetBeta(parsedState),
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
  const [hasReceivedQuoteResponse, setHasReceivedQuoteResponse] = useState(false);
  const [rebalancePrecision, setRebalancePrecision] = useState("lots");
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [activeView, setActiveView] = useState("overview");
  const [settingsTargetPage, setSettingsTargetPage] = useState(null);
  const [glossaryTopic, setGlossaryTopic] = useState(null);
  const [rebalanceTargetBetaOverride, setRebalanceTargetBetaOverride] = useState("");
  const [excludedRebalanceIds, setExcludedRebalanceIds] = useState([]);
  const [historyRange, setHistoryRange] = useState("1M");
  const [benchmarkDrawdown, setBenchmarkDrawdown] = useState(null);
  const [backupStatus, setBackupStatus] = useState("");
  const [hasRebalanceRestorePoint, setHasRebalanceRestorePoint] = useState(false);
  const [rebalanceRestoreStatus, setRebalanceRestoreStatus] = useState("");
  const [hasHistoryRestorePoint, setHasHistoryRestorePoint] = useState(false);
  const [historyRestoreStatus, setHistoryRestoreStatus] = useState("");
  const [cashChangeReason, setCashChangeReason] = useState("external");
  const quoteResultRef = useRef(emptyQuoteResult);
  const quoteRequestCoordinatorRef = useRef(createLatestQuoteRequestCoordinator());
  const retryControllerRef = useRef(null);
  const analyticsClient = useMemo(
    () =>
      createAnalyticsClient({
        appVersion: APP_VERSION,
      }),
    [],
  );

  const tickers = useMemo(
    () =>
      [...formState.positions, ...formState.cashEquivalentPositions]
        .map((position) => position.tickerInput)
        .filter(isQuoteableTickerInput),
    [formState.positions, formState.cashEquivalentPositions],
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
        cashEquivalentPositions: formState.cashEquivalentPositions,
        quotes: quoteResult.quotes,
        cashTwd: cashValueTwd,
        targetBeta: formState.targetBeta,
        originalAllocationMode: formState.originalAllocationMode,
        leveragedTargetPct: formState.leveragedTargetPct,
        originalTargetPct: formState.originalTargetPct,
        tolerancePct: formState.tolerancePct,
        allocationModes: formState.allocationModes,
        cashEquivalentMode: formState.cashEquivalentMode,
        realCashTargetPct: formState.realCashTargetPct,
      });
    },
    [formState, quoteResult],
  );

  const quoteErrors = quoteResult.quotes.filter((quote) => quote.error);
  const pageCalculationErrors = getVisibleCalculationErrors(
    calculation.errors,
    hasReceivedQuoteResponse,
  );
  const betaRail = createBetaRailModel(calculation);
  const overviewAction = createOverviewAction(calculation, {
    setupComplete: isPortfolioSetupComplete({ formState, hasReceivedQuoteResponse }),
  });
  const recommendationIds = useMemo(
    () => [
      ...calculation.recommendations,
      ...calculation.cashEquivalentRecommendations,
    ].map((item) => String(item.id)),
    [calculation.recommendations, calculation.cashEquivalentRecommendations],
  );
  const selectedRebalanceIds = useMemo(
    () => {
      const excludedSet = new Set(excludedRebalanceIds);
      return recommendationIds.filter((id) => !excludedSet.has(id));
    },
    [excludedRebalanceIds, recommendationIds],
  );
  const rebalanceTargetBeta =
    rebalanceTargetBetaOverride === "" ? calculation.targetBeta : rebalanceTargetBetaOverride;
  const operationRebalance = useMemo(
    () => {
      const stockResult = createOperationRebalance({
        recommendations: calculation.recommendations,
        selectedIds: selectedRebalanceIds,
        totalAssetsTwd: calculation.totalAssetsTwd,
        targetBeta: rebalanceTargetBeta,
        originalTargetRatio: calculation.targetOriginalRatio,
        leveragedBeta: calculation.targetLeveragedBeta,
        precision: rebalancePrecision,
        allocationModes: formState.allocationModes,
      });
      const targetCashSleeveValueTwd = getCashSleeveValueAfterStockTrades({
        recommendations: stockResult.recommendations,
        totalAssetsTwd: calculation.totalAssetsTwd,
        precision: rebalancePrecision,
      });
      const cashTargets = getCashSleeveTargets({
        mode: formState.cashEquivalentMode,
        positions: formState.cashEquivalentPositions,
        realCashTargetPct: formState.realCashTargetPct,
      });
      const cashEquivalentRecommendations = calculation.cashEquivalentRecommendations.map((item) => {
        const targetValueTwd = targetCashSleeveValueTwd * Number(
          cashTargets.positionRatios.get(item.id) || 0,
        );
        const tradeAmountTwd = targetValueTwd - item.currentValueTwd;
        const isSelected = selectedRebalanceIds.includes(String(item.id));
        return {
          ...item,
          targetValueTwd,
          desiredTradeAmountTwd: tradeAmountTwd,
          tradeAmountTwd: isSelected ? tradeAmountTwd : 0,
          action: isSelected && tradeAmountTwd > 0.5
            ? "buy"
            : isSelected && tradeAmountTwd < -0.5
              ? "sell"
              : "none",
          isSelected,
          currentSleeveWeight: calculation.cashSleeveValueTwd > 0
            ? item.currentValueTwd / calculation.cashSleeveValueTwd
            : 0,
          targetSleeveWeight: Number(cashTargets.positionRatios.get(item.id) || 0),
          allocationMode: formState.cashEquivalentMode,
          afterSleeveWeight: targetCashSleeveValueTwd > 0
            ? targetValueTwd / targetCashSleeveValueTwd
            : 0,
        };
      });
      const targetRealCashTwd = targetCashSleeveValueTwd * cashTargets.realCashRatio;
      const excludedCashEquivalentReserveTwd = cashEquivalentRecommendations.reduce(
        (sum, item) => sum + (!item.isSelected ? Math.max(item.desiredTradeAmountTwd, 0) : 0),
        0,
      );
      const fundedRecommendations = createFundedRebalanceRecommendations({
        recommendations: [...stockResult.recommendations, ...cashEquivalentRecommendations],
        precision: rebalancePrecision,
        cashTwd: calculation.realCashTwd,
        minimumCashTwd: targetRealCashTwd + excludedCashEquivalentReserveTwd,
        cashTargetStrategy: formState.cashEquivalentMode === "custom" ? "nearest" : "floor",
      });
      return {
        ...stockResult,
        recommendations: fundedRecommendations,
        targetRealCashTwd,
      };
    },
    [
      calculation.recommendations,
      calculation.targetOriginalRatio,
      calculation.targetLeveragedBeta,
      calculation.totalAssetsTwd,
      rebalanceTargetBeta,
      rebalancePrecision,
      selectedRebalanceIds,
      formState.allocationModes,
      formState.cashEquivalentMode,
      formState.cashEquivalentPositions,
      formState.realCashTargetPct,
      calculation.cashEquivalentRecommendations,
      calculation.cashSleeveValueTwd,
      calculation.realCashTwd,
    ],
  );
  const appliedRebalanceSummary = useMemo(
    () =>
      getAppliedRebalanceSummary({
        recommendations: operationRebalance.recommendations,
        precision: rebalancePrecision,
      }),
    [operationRebalance.recommendations, rebalancePrecision],
  );
  const canApplyRebalance =
    calculation.isValid &&
    operationRebalance.recommendations.length > 0 &&
    appliedRebalanceSummary.actionCount > 0;

  const refreshQuotes = useCallback(async ({ isRetry = false } = {}) => {
    if (tickers.length === 0) {
      setRequestError("請至少輸入一個標的代號。");
      return;
    }
    if (!isRetry) {
      retryControllerRef.current?.reset();
    }
    const request = quoteRequestCoordinatorRef.current.begin();
    setStatus("loading");
    setRequestError("");

    try {
      const response = await fetch(
        `/api/quotes?tickers=${encodeURIComponent(tickers.join(","))}`,
        { signal: request.signal },
      );
      if (!response.ok) {
        throw new Error(`報價 API 回應 ${response.status}`);
      }
      const payload = await response.json();
      if (!request.isCurrent()) {
        return;
      }
      setHasReceivedQuoteResponse(true);
      const merged = mergeQuoteResults(quoteResultRef.current, payload);
      quoteResultRef.current = merged.result;
      const nextCashValueTwd = calculateCashTwdValue({
        cashTwd: formState.cashTwd,
        cashUsd: formState.cashUsd,
        usdTwd: merged.result.fx.usdTwd,
      });
      const nextCalculation = calculatePortfolio({
        positions: formState.positions,
        cashEquivalentPositions: formState.cashEquivalentPositions,
        quotes: merged.result.quotes,
        cashTwd: nextCashValueTwd,
        targetBeta: formState.targetBeta,
        originalAllocationMode: formState.originalAllocationMode,
        leveragedTargetPct: formState.leveragedTargetPct,
        originalTargetPct: formState.originalTargetPct,
        tolerancePct: formState.tolerancePct,
        allocationModes: formState.allocationModes,
        cashEquivalentMode: formState.cashEquivalentMode,
        realCashTargetPct: formState.realCashTargetPct,
      });
      setQuoteResult(merged.result);
      if (merged.hasFailures) {
        retryControllerRef.current?.schedule();
        setStatus(merged.usedStaleData ? "ready" : "error");
      } else {
        retryControllerRef.current?.reset();
        setLastUpdatedAt(new Date());
        setStatus("ready");
      }
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
      if (!request.isCurrent() || error?.name === "AbortError") {
        return;
      }
      const hasPriorData = hasCompletePriorQuoteResult(quoteResultRef.current, tickers);
      if (hasPriorData) {
        retryControllerRef.current?.schedule();
        setStatus("ready");
      } else {
        setRequestError(error instanceof Error ? error.message : "價格更新失敗。");
        retryControllerRef.current?.schedule();
        setStatus("error");
      }
    }
  }, [analyticsClient, formState, tickers]);

  useEffect(() => {
    const controller = createQuoteRetryController({
      setTimeoutFn: (callback, delay) => window.setTimeout(callback, delay),
      clearTimeoutFn: (timer) => window.clearTimeout(timer),
      onRetry: () => refreshQuotes({ isRetry: true }),
      onExhausted: () => {
        setRequestError("部分價格暫時無法更新，將自動重試。");
      },
    });
    retryControllerRef.current = controller;

    return () => {
      controller.reset();
      if (retryControllerRef.current === controller) {
        retryControllerRef.current = null;
      }
    };
  }, [refreshQuotes]);

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
    const canSaveSnapshot = shouldSaveHistorySnapshotForDate({
      date,
      quotes: quoteResult.quotes,
    });

    if (!canSaveSnapshot) {
      return undefined;
    }

    async function saveDailyHistorySnapshot() {
      try {
        let liveQuote = null;
        let historicalPrice = null;

        if (date === getTaipeiDateKey()) {
          const liveResponse = await fetch("/api/quotes?tickers=0050");
          if (liveResponse.ok) {
            const livePayload = await liveResponse.json();
            liveQuote = livePayload?.quotes?.[0] || null;
          }
        }

        if (!liveQuote?.price) {
          const response = await fetch(
            `/api/history-quotes?tickers=0050.TW&from=${date}&to=${date}`,
          );
          if (!response.ok) {
            return;
          }

          const payload = await response.json();
          historicalPrice = payload?.quotes?.[0]?.prices?.[0]?.price;
        }

        const benchmarkPrice = selectBenchmark0050SnapshotPrice({
          snapshotDate: date,
          liveQuote,
          historicalPrice,
        });
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
        const [historyResponse, quoteResponse] = await Promise.all([
          fetch(`/api/history-quotes?tickers=0050.TW&from=${BENCHMARK_HISTORY_FROM}&to=${toDate}`),
          fetch("/api/quotes?tickers=0050"),
        ]);
        if (!historyResponse.ok) {
          return;
        }

        const historyPayload = await historyResponse.json();
        const quotePayload = quoteResponse.ok ? await quoteResponse.json() : null;
        const drawdown = createBenchmarkDrawdown(
          historyPayload?.quotes?.[0]?.prices || [],
          {
            currentQuote: quotePayload?.quotes?.[0] || null,
          },
        );
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
    window.addEventListener("online", refreshIfVisible);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshIfVisible);
      window.removeEventListener("online", refreshIfVisible);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [hydrated, refreshQuotes, status, tickers]);

  useEffect(() => {
    if (!hydrated) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      analyticsClient.startOrResumeSession();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [analyticsClient, hydrated]);

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

  useEffect(() => {
    if (!historyHydrated) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      try {
        setHasHistoryRestorePoint(
          Boolean(window.localStorage.getItem(BEFORE_CLEAR_HISTORY_STORAGE_KEY)),
        );
      } catch {
        setHasHistoryRestorePoint(false);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [historyHydrated]);

  function updateSetting(field, value) {
    setFormState((current) => {
      if (field === "originalAllocationMode") {
        return {
          ...current,
          originalAllocationMode: value === "custom" ? "custom" : "current",
        };
      }
      if (field === "cashEquivalentMode") {
        return {
          ...current,
          cashEquivalentMode: value === "custom" ? "custom" : "auto",
        };
      }
      const isCashField = field === "cashTwd" || field === "cashUsd";
      const nextValue = isCashField ? parseIntegerInput(value) : parseNumericInput(value);

      if (isCashField && cashChangeReason !== "fee") {
        const beforeCashValue = calculateCashTwdValue({
          cashTwd: current.cashTwd,
          cashUsd: current.cashUsd,
          usdTwd: quoteResult.fx.usdTwd,
        });
        const afterCashValue = calculateCashTwdValue({
          cashTwd: field === "cashTwd" ? nextValue : current.cashTwd,
          cashUsd: field === "cashUsd" ? nextValue : current.cashUsd,
          usdTwd: quoteResult.fx.usdTwd,
        });
        const cashDelta = Math.round(afterCashValue - beforeCashValue);

        if (Math.abs(cashDelta) > 0.5) {
          setHistoryRecords((records) =>
            addHistoryPerformanceAdjustment(
              records,
              getTaipeiDateKey(lastUpdatedAt || new Date()),
              cashDelta,
            ),
          );
        }
      }

      return {
        ...current,
        [field]: nextValue,
        ...(field === "originalTargetPct" ? { originalAllocationMode: "custom" } : {}),
      };
    });
  }

  function updatePosition(id, field, value) {
    setFormState((current) => ({
      ...current,
      positions: current.positions.map((position) => {
        if (position.id !== id) {
          return position;
        }
        if (field === "tickerInput") {
          const detectedAssetBeta = getTickerDefaultAssetBeta(value);
          return {
            ...position,
            tickerInput: value,
            ...(detectedAssetBeta !== null
              ? {
                  assetBeta: detectedAssetBeta,
                  assetBetaSource: "auto",
                  assetTypeHint: detectedAssetBeta > 1 ? "leveraged" : "original",
                }
              : position.assetBetaSource === "auto"
                ? { assetBeta: "", assetBetaSource: null }
                : {}),
          };
        }
        return {
          ...position,
          [field]: parseNumericInput(value),
          ...(field === "assetBeta" ? { assetBetaSource: "manual" } : {}),
        };
      }),
    }));
  }

  function updateCashEquivalentPosition(id, field, value) {
    setFormState((current) => ({
      ...current,
      cashEquivalentPositions: current.cashEquivalentPositions.map((position) =>
        position.id === id
          ? { ...position, [field]: field === "tickerInput" ? value : parseNumericInput(value) }
          : position,
      ),
    }));
  }

  function addCashEquivalentPosition() {
    setFormState((current) => ({
      ...current,
      cashEquivalentPositions: [
        ...current.cashEquivalentPositions,
        {
          id: `cash-equivalent-${Date.now()}`,
          tickerInput: "",
          shares: 0,
          targetWeightPct: 0,
        },
      ],
    }));
  }

  function removeCashEquivalentPosition(id) {
    setFormState((current) => ({
      ...current,
      cashEquivalentPositions: current.cashEquivalentPositions.filter(
        (position) => position.id !== id,
      ),
    }));
  }

  function updateAllocationMode(assetType, mode) {
    setFormState((current) => {
      const nextMode = mode === "custom" ? "custom" : "auto";
      const positionsInSleeve = current.positions.filter(
        (position) => getHoldingAssetType(position.assetBeta) === assetType,
      );
      const hasSavedWeights = positionsInSleeve.some(
        (position) => Number(position.targetWeightPct) > 0,
      );
      let nextPositions = current.positions;
      if (nextMode === "custom" && !hasSavedWeights) {
        const currentValueById = new Map(
          calculation.recommendations.map((item) => [item.id, item.currentValueTwd]),
        );
        const initialized = initializePositionTargetWeights(
          positionsInSleeve.map((position) => ({
            ...position,
            currentValueTwd: currentValueById.get(position.id) || 0,
          })),
        );
        const initializedById = new Map(
          initialized.map((position) => [position.id, position.targetWeightPct]),
        );
        nextPositions = current.positions.map((position) =>
          initializedById.has(position.id)
            ? { ...position, targetWeightPct: initializedById.get(position.id) }
            : position,
        );
      }
      return {
        ...current,
        positions: nextPositions,
        allocationModes: { ...current.allocationModes, [assetType]: nextMode },
      };
    });
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
          assetBeta: assetBeta > 1 ? "" : 1,
          assetTypeHint: assetBeta > 1 ? "leveraged" : "original",
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
    const canRemove = Boolean(removedPosition);
    setFormState((current) => removePositionFromSettings(current, id));
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
      `套用再平衡結果？\n\n這會更新持股股數與台幣現金，並先保留一份套用前資料供復原。\n\n共 ${appliedRebalanceSummary.actionCount} 筆操作。`,
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
        cashEquivalentPositions: current.cashEquivalentPositions,
        cashTwd: currentCashTwd,
        recommendations: operationRebalance.recommendations,
        precision: rebalancePrecision,
      });

      return {
        ...current,
        positions: result.positions,
        cashEquivalentPositions: result.cashEquivalentPositions,
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

  function clearHistoryWithRestore() {
    if (!historyRecords.length) {
      setHistoryRestoreStatus("目前沒有可清除的歷史紀錄。");
      return;
    }

    const confirmed = window.confirm(
      `清除歷史紀錄？\n\n這會先保留一份清除前資料，可用「復原上一步」救回。\n\n共 ${historyRecords.length} 筆紀錄。`,
    );
    if (!confirmed) {
      return;
    }

    let restorePointSaved = false;
    try {
      const restorePoint = createHistoryRestorePoint(historyRecords);
      window.localStorage.setItem(BEFORE_CLEAR_HISTORY_STORAGE_KEY, JSON.stringify(restorePoint));
      setHasHistoryRestorePoint(true);
      restorePointSaved = true;
    } catch {
      // History can still be cleared if the browser blocks localStorage.
    }

    setHistoryRecords([]);
    setHistoryRestoreStatus(
      restorePointSaved
        ? "已清除歷史紀錄，可復原上一步。"
        : "已清除歷史紀錄，但瀏覽器未允許建立復原點。",
    );
  }

  function restorePreviousHistoryClear() {
    try {
      const saved = window.localStorage.getItem(BEFORE_CLEAR_HISTORY_STORAGE_KEY);
      const restorePoint = parseHistoryRestorePoint(saved || "");
      setHistoryRecords(restorePoint.records);
      window.localStorage.removeItem(BEFORE_CLEAR_HISTORY_STORAGE_KEY);
      setHasHistoryRestorePoint(false);
      setHistoryRestoreStatus("已復原到清除歷史紀錄前。");
    } catch (error) {
      setHistoryRestoreStatus(
        error instanceof Error ? error.message : "無法復原上一筆歷史紀錄。",
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
        quoteRequestCoordinatorRef.current.invalidate();
        quoteResultRef.current = emptyQuoteResult;
        setQuoteResult(emptyQuoteResult);
        setHasReceivedQuoteResponse(false);
        setLastUpdatedAt(null);
        setStatus("idle");
        setRequestError("");
        setFormState(normalizeStoredState(backup.settings));
        setHistoryRecords((current) => mergeImportedHistory(current, backup.history));
        setBackupStatus("已匯入完整備份，設定已更新，歷史紀錄已合併。");
      } catch (error) {
        setBackupStatus(error instanceof Error ? error.message : "備份檔匯入失敗。");
      }
    },
    [setFormState, setHistoryRecords],
  );

  function changeView(nextView, options = {}) {
    if (nextView === "settings") {
      setSettingsTargetPage(options.settingsPage || null);
    }

    if (nextView === activeView) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    setActiveView(nextView);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function handleOverviewAction(action) {
    if (!action.destination) {
      return;
    }

    changeView(action.destination, { settingsPage: action.settingsPage });
  }

  return (
    <main className="appShell">
      <AppHeader />

      {(requestError ||
        quoteResult.fx.error ||
        quoteErrors.length > 0 ||
        (activeView !== "settings" && pageCalculationErrors.length > 0)) && (
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
              action={overviewAction}
              calculation={calculation}
              betaRail={betaRail}
              hasTargetBeta={formState.targetBeta !== ""}
              onAction={handleOverviewAction}
              onOpenGlossary={() => setGlossaryTopic("beta")}
            />

            <MarketLevelCard
              benchmarkDrawdown={benchmarkDrawdown}
              onOpenGlossary={() => setGlossaryTopic("benchmarkDrawdown")}
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
            appliedSummary={appliedRebalanceSummary}
            calculation={calculation}
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
            hasRestorePoint={hasHistoryRestorePoint}
            historyRange={historyRange}
            records={historyRecords}
            restoreStatus={historyRestoreStatus}
            onClearHistory={clearHistoryWithRestore}
            onRestorePreviousHistory={restorePreviousHistoryClear}
            onSeedDemoHistory={
              isLocalPreview
                ? () => setHistoryRecords((current) => mergeDemoHistoryRecords(current))
                : null
            }
            onRangeChange={setHistoryRange}
          />
        )}

        {activeView === "settings" && (
          <SettingsAccordions
            initialPage={settingsTargetPage || "cash"}
            backupStatus={backupStatus}
            calculation={calculation}
            formState={formState}
            fx={quoteResult.fx}
            historyCount={historyRecords.length}
            onAddPosition={addPosition}
            onAddCashEquivalentPosition={addCashEquivalentPosition}
            onExportBackup={handleExportBackup}
            onImportBackup={handleImportBackup}
            onRemovePosition={removePosition}
            onRemoveCashEquivalentPosition={removeCashEquivalentPosition}
            onSetCashChangeReason={setCashChangeReason}
            onUpdatePosition={updatePosition}
            onUpdateCashEquivalentPosition={updateCashEquivalentPosition}
            onUpdateAllocationMode={updateAllocationMode}
            onUpdateSetting={updateSetting}
            cashChangeReason={cashChangeReason}
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

function AppHeader() {
  return (
    <header className="appHeader publicAppHeader">
      <p className="betreeWordmark">Betree</p>
    </header>
  );
}

function BetaCard({ action, calculation, betaRail, hasTargetBeta, onAction, onOpenGlossary }) {
  const betaSummary = createBetaSummary({
    currentBeta: calculation.currentBeta,
    targetBeta: calculation.targetBeta,
    tolerancePct: calculation.tolerancePct,
  });

  return (
    <section className="appCard betaCard">
      <OverviewCardHeader
        title="目前 Beta"
        subtitle="整體資產曝險程度"
        infoLabel="查看 Beta 說明"
        onInfo={onOpenGlossary}
        action={null}
      />
      <div className="betaTopline">
        <div className="betaPrimary">
          <div className="megaNumber">{formatNumber(calculation.currentBeta)}</div>
          {action.destination ? (
            <button
              type="button"
              className={`betaAction betaInlineAction ${action.tone}`}
              onClick={() => onAction(action)}
              aria-label={action.ariaLabel}
            >
              {action.label}
            </button>
          ) : (
            <span className={`betaAction betaInlineAction ${action.tone}`}>{action.label}</span>
          )}
        </div>
        <div className="betaMetaGrid">
          <div>
            <span>目標設定</span>
            <strong>{hasTargetBeta ? betaSummary.targetText : "尚未設定"}</strong>
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
        {hasTargetBeta && (
          <>
            <span className="targetMarker" />
            <span className="targetLabel">目標 {formatNumber(calculation.targetBeta)}</span>
          </>
        )}
        <span className="currentMarker" />
      </div>

      <div className="betaScale">
        {betaRail.scaleTicks.map((tick) => (
          <span key={tick}>{formatBetaScaleTick(tick)}</span>
        ))}
      </div>
    </section>
  );
}

function MarketLevelCard({ benchmarkDrawdown, onOpenGlossary }) {
  const [activePointDate, setActivePointDate] = useState(null);
  const [chartRange, setChartRange] = useState("1M");
  const chartHistory = filterBenchmarkHistoryByRange(
    benchmarkDrawdown?.fullHistory,
    benchmarkDrawdown?.currentDate,
    chartRange,
  );
  const chart = createBenchmarkDrawdownChart(
    chartHistory,
    benchmarkDrawdown?.highPrice,
    { mode: "overview" },
  );

  if (!benchmarkDrawdown) {
    return null;
  }

  const activePoint = chart.points.find((point) => point.date === activePointDate) || null;
  const tooltipLeft = activePoint
    ? activePoint.tooltipAnchor === "start"
      ? activePoint.tooltipX
      : activePoint.tooltipAnchor === "end"
        ? activePoint.tooltipX - 178
        : activePoint.tooltipX - 89
    : 0;
  const tooltipTop = activePoint ? Math.min(246, Math.max(50, activePoint.y - 104)) : 0;
  const tooltipTextX = tooltipLeft + 12;
  const levelLabel = getMarketLevelLabel(benchmarkDrawdown.level);
  const rangeStartDate = chart.points[0]?.date || benchmarkDrawdown.currentDate;
  const formatRangeDate = (date) => (chartRange === "1Y" ? date.slice(2) : date.slice(5)).replaceAll("-", "/");

  function activatePoint(event, index) {
    event.stopPropagation();
    const clickedDate = chart.points[index]?.date || null;
    setActivePointDate((current) => current === clickedDate ? null : clickedDate);
  }

  function handlePointKeyDown(event, index) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activatePoint(event, index);
    }
  }

  function handleChartClick(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) {
      return;
    }
    const chartX = ((event.clientX - bounds.left) / bounds.width) * chart.width;
    const nearestIndex = getNearestMarketPointIndex(chart.points, chartX);
    if (nearestIndex !== null) {
      const nearestDate = chart.points[nearestIndex].date;
      setActivePointDate((current) => current === nearestDate ? null : nearestDate);
    }
  }

  return (
    <section className={`appCard marketLevelCard ${benchmarkDrawdown.level}`}>
      <div className="marketLevelHeader">
        <OverviewCardHeader
          title="市場水位"
          subtitle="0050 距歷史高點"
          infoLabel="查看 0050 距收盤高點說明"
          onInfo={onOpenGlossary}
        />

        <div className="marketLevelSummaries">
          <div className="marketLevelDrawdownSummary">
            <span className="marketLevelSummaryLabel">距歷史高點</span>
            <strong>{formatSignedPercent(benchmarkDrawdown.drawdownRatio)}</strong>
            <span className={`marketLevelSummaryMeta ${benchmarkDrawdown.level}`}>{levelLabel}</span>
          </div>
          <div>
            <span className="marketLevelSummaryLabel">目前價格（{benchmarkDrawdown.currentSource === "live" ? "即時" : "收盤"}）</span>
            <strong>{formatNumber(benchmarkDrawdown.currentPrice, 2)}</strong>
            <time className="marketLevelSummaryMeta" dateTime={benchmarkDrawdown.currentDate}>{benchmarkDrawdown.currentDate}</time>
          </div>
          <div>
            <span className="marketLevelSummaryLabel">歷史高點（收盤）</span>
            <strong>{formatNumber(benchmarkDrawdown.highPrice, 2)}</strong>
            <time className="marketLevelSummaryMeta" dateTime={benchmarkDrawdown.highDate}>{benchmarkDrawdown.highDate}</time>
          </div>
        </div>
      </div>

      <div className="marketLevelRangeControls" aria-label="市場水位顯示期間">
        <span>Zoom</span>
        {["1M", "3M", "6M", "1Y"].map((range) => (
          <button
            type="button"
            key={range}
            aria-pressed={chartRange === range}
            onClick={() => {
              setChartRange(range);
              setActivePointDate(null);
            }}
          >
            {range}
          </button>
        ))}
        <time className="marketLevelRangeDates">
          {formatRangeDate(rangeStartDate)}－{formatRangeDate(benchmarkDrawdown.currentDate)}
        </time>
      </div>

      <div className="marketLevelChartWrap">
        <svg
          className="marketLevelChart"
          width={chart.width}
          height={chart.height}
          viewBox={chart.viewBox}
          role="group"
          aria-label={`0050 最近 ${chartRange} 的市場水位走勢圖`}
          onClick={handleChartClick}
        >
          {chart.bands.map((band) => (
            <g key={band.level}>
              <rect
                className={`marketBand ${band.level}`}
                x={chart.bandInset}
                y={band.top}
                width={chart.width - chart.bandInset * 2}
                height={band.bottom - band.top}
              />
              <text
                className={`marketBandName ${band.level}`}
                x={chart.edgeLabelInset}
                y={(band.top + band.bottom) / 2 + 4}
              >
                {band.level === "normal" ? "正常" : band.level === "prepare" ? "觀察" : "股災"}
              </text>
            </g>
          ))}

          {chart.thresholds.map((threshold) => (
            <g key={threshold.ratio}>
              <line
                className="marketThreshold"
                x1={chart.plot.left}
                x2={chart.plot.right}
                y1={threshold.y}
                y2={threshold.y}
              />
              <text className="marketThresholdRatio" x={chart.edgeLabelInset} y={threshold.y + 20}>
                {formatSignedPercent(threshold.ratio)}
              </text>
              <text className="marketThresholdPrice" x={chart.width - chart.edgeLabelInset} y={threshold.y + 17} textAnchor="end">
                {formatNumber(threshold.price, 2)}
              </text>
            </g>
          ))}

          {chart.scaleMin < -0.3 && (
            <text
              className="marketThresholdRatio marketScaleFloor"
              x={chart.edgeLabelInset}
              y={chart.scaleFloor.y - 8}
            >
              {formatSignedPercent(chart.scaleFloor.ratio)}
            </text>
          )}

          <polyline className="marketTrendLine" points={chart.linePoints} />

          {chart.points.map((point, index) => {
            const shortDate = point.date.slice(5).replace("-", "/");
            const isActive = activePointDate === point.date;
            return (
              <g key={point.date}>
                <circle
                  className="marketPointHitArea"
                  cx={point.x}
                  cy={point.y}
                  r="18"
                  role="button"
                  tabIndex="0"
                  aria-pressed={isActive}
                  aria-label={`${point.date}，0050 股價 ${formatNumber(point.price, 2)}，市場水位 ${formatSignedPercent(point.drawdownRatio)}，${getMarketLevelLabel(point.level)}`}
                  onClick={(event) => activatePoint(event, index)}
                  onKeyDown={(event) => handlePointKeyDown(event, index)}
                />
                <circle
                  className={`marketPoint ${point.level}${isActive ? " active" : ""}${index === chart.points.length - 1 ? " latest" : ""}`}
                  cx={point.x}
                  cy={point.y}
                  r="8"
                  aria-hidden="true"
                />
                {point.showDateLabel && (
                  <text className="marketPointDate" x={point.x} y={chart.dateLabelY} textAnchor="middle">{shortDate}</text>
                )}
              </g>
            );
          })}

          {activePoint && (
            <g
              className={`marketPointTooltip ${activePoint.level}`}
              onClick={(event) => event.stopPropagation()}
              pointerEvents="all"
            >
              <rect
                x={tooltipLeft}
                y={tooltipTop}
                width="178"
                height="82"
                rx="10"
              />
              <text
                x={tooltipTextX}
                y={tooltipTop + 22}
              >
                <tspan className="tooltipDate">{activePoint.date}</tspan>
                <tspan x={tooltipTextX} dy="20">0050　{formatNumber(activePoint.price, 2)}</tspan>
                <tspan x={tooltipTextX} dy="20">{formatSignedPercent(activePoint.drawdownRatio)}　{getMarketLevelLabel(activePoint.level)}</tspan>
              </text>
            </g>
          )}
        </svg>
      </div>

      <div className="marketLevelLegend" aria-label="市場水位區間圖例">
        <span><i className="normal" />正常區間（-10% 以內）</span>
        <span><i className="prepare" />觀察區間（-10%～-20%）</span>
        <span><i className="deep" />股災區間（-20% 以上）</span>
      </div>

      <div className="marketLevelFooter">
        <span>資料來源：0050 {benchmarkDrawdown.currentSource === "live" ? "即時價與歷史收盤價" : "收盤價"}</span>
        <span>更新日期：{benchmarkDrawdown.currentDate}</span>
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
                <p>這個數字用 0050 目前即時價，和系統抓到的歷史最高收盤價相比。</p>
                <p>例如 -6% 代表目前 0050 即時價比歷史收盤高點低約 6%。</p>
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
                <span>槓桿</span>
                <p>槓桿標的是曝險倍數大於 1 的標的，可為 1.5×、2× 或 3×。</p>
                <p>例如 00631L、QLD、SOXL、NTSD 這類標的。部分產品採單日槓桿目標，部分產品採資本效率型總曝險；持有多日可能因波動與複利效果偏離。</p>
              </article>

              <article className="glossaryItem">
                <span>原形</span>
                <p>原形是 Beta 約 1 的非槓桿標的，接近追蹤原始市場表現。</p>
                <p>例如 0050、006208 這類 ETF。</p>
              </article>

              <article className="glossaryItem">
                <span>現金</span>
                <p>現金桶是台幣現金、美金現金換算台幣，以及類現金 ETF 市值的加總。</p>
                <p>類現金 ETF 的 Beta 以 0 計算，會參與現金桶與再平衡，但仍有價格波動。</p>
                <p>資產配置比例會把槓桿、原形與現金＋類現金一起納入總資產計算。</p>
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

function AllocationCard({ calculation, onOpenGlossary }) {
  const cashValueTwd = calculation.totalAssetsTwd - calculation.stockValueTwd;

  return (
    <section className="appCard allocationCard">
      <OverviewCardHeader
        title="資產配置比例"
        subtitle="槓桿、原形與現金＋類現金配置"
        infoLabel="查看槓桿、原形與現金＋類現金說明"
        onInfo={onOpenGlossary}
      />
      <div className="allocationTotal">
        <span>總資產</span>
        <strong>{formatTwd(calculation.totalAssetsTwd)}</strong>
      </div>
      <AllocationBar
        leveragedRatio={calculation.leveragedRatio}
        originalRatio={calculation.originalRatio}
        cashRatio={calculation.cashRatio}
      />
      <div className="allocationLegend">
        <AllocationMetric
          color="purple"
          label="槓桿"
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
          label="現金＋類現金"
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
      aria-label={`槓桿 ${formatPercent(safeLeveragedRatio)}，原形 ${formatPercent(safeOriginalRatio)}，現金 ${formatPercent(safeCashRatio)}`}
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

function HistoryView({
  hasRestorePoint,
  historyRange,
  records,
  restoreStatus,
  onClearHistory,
  onRangeChange,
  onRestorePreviousHistory,
  onSeedDemoHistory,
}) {
  const summary = createHistorySummary(records);
  const chartRecords = filterHistoryRecordsByRange(records, historyRange);
  const chartModel = createHistoryStackedChartModel(chartRecords);
  const chartDateRange = chartRecords.length
    ? `${chartRecords[0].date.slice(5).replace("-", "/")}–${chartRecords
        .at(-1)
        .date.slice(5)
        .replace("-", "/")}`
    : "";
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
        {hasRestorePoint ? (
          <button
            type="button"
            className="secondaryButton restoreButton"
            onClick={onRestorePreviousHistory}
          >
            復原上一步
          </button>
        ) : null}
        {restoreStatus ? <p className="historyRestoreStatus">{restoreStatus}</p> : null}
      </section>
    );
  }

  return (
    <section className="historyStack" aria-label="歷史紀錄">
      <section className="appCard historySummaryCard">
        <div className="cardHeaderRow">
          <div>
            <div className="cardTitleRow historyTitleRow">
              <h2>歷史紀錄</h2>
            </div>
            <p>總資產、Beta 與 0050 同日起始比較</p>
          </div>
        </div>
        <div className="historySummaryGrid">
          <HistoryMetric label="最新總資產" value={formatTwd(summary.latestTotalAssetsTwd)} />
          <HistoryMetric label="最新 Beta" value={formatNumber(summary.latestBeta)} />
          <HistoryMetric label="投組累積報酬" value={formatSignedPercent(summary.portfolioReturn)} />
          <HistoryMetric label="0050 累積報酬" value={formatSignedPercent(summary.benchmarkReturn)} />
        </div>
        <p className="historyUpdateDate">更新日期：{summary.latestDate}</p>
      </section>

      <section className="appCard historyChartCard">
        <div className="cardHeaderRow">
          <div>
            <div className="cardTitleRow historyTitleRow">
              <h2>績效與 Beta 走勢</h2>
            </div>
            <p>比較投資組合與0050 累積績效與 Beta 變化</p>
          </div>
        </div>
        <div className="historyZoomRow">
          <div className="historyZoomControls" aria-label="歷史顯示期間">
            <span>Zoom</span>
            {["1M", "3M", "6M", "1Y"].map((range) => (
              <button
                type="button"
                key={range}
                aria-pressed={historyRange === range}
                onClick={() => onRangeChange(range)}
              >
                {range}
              </button>
            ))}
          </div>
          <span className="historyChartDateRange">{chartDateRange}</span>
        </div>
        <HistoryStackedChart model={chartModel} />
      </section>

      <details className="appCard historyRecordsCard">
        <summary className="cardHeaderRow historyRecordsSummary">
          <div>
            <div className="cardTitleRow historyTitleRow">
              <h2>最近紀錄</h2>
            </div>
            <p>同一天更新會覆蓋為最新快照</p>
          </div>
        </summary>
        <div className="historyRecordsBody">
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
            {hasRestorePoint ? (
              <button
                type="button"
                className="secondaryButton restoreButton"
                onClick={onRestorePreviousHistory}
              >
                復原上一步
              </button>
            ) : null}
          </div>
          {restoreStatus ? <p className="historyRestoreStatus">{restoreStatus}</p> : null}
        </div>
      </details>
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

function HistoryStackedChart({ model }) {
  const [activePointIndex, setActivePointIndex] = useState(null);
  const performancePoint =
    activePointIndex === null ? null : model.performance.dataPoints[activePointIndex] || null;
  const betaPoint = activePointIndex === null ? null : model.beta.dataPoints[activePointIndex] || null;

  if (model.labels.length < 2) {
    return (
      <div className="historyChartEmpty">
        累積兩筆以上紀錄後會顯示曲線。
      </div>
    );
  }

  return (
    <div className="historyChartStack" onPointerLeave={() => setActivePointIndex(null)}>
      <section className="historyChartPanel" aria-label="績效">
        <div className="historyPanelHeader">
          <h3>績效</h3>
          <div className="historyLegend">
            <span><i className="portfolio" />投組</span>
            <span><i className="benchmark" />0050</span>
          </div>
        </div>
        <HistoryChartPanel
          model={model.performance}
          activePointIndex={activePointIndex}
          onActivePointChange={setActivePointIndex}
          showDateAxis={false}
        />
      </section>
      <section className="historyChartPanel" aria-label="Beta">
        <div className="historyPanelHeader">
          <h3>Beta</h3>
          <div className="historyLegend">
            <span><i className="portfolio" />投組 Beta</span>
          </div>
        </div>
        <HistoryChartPanel
          model={model.beta}
          activePointIndex={activePointIndex}
          onActivePointChange={setActivePointIndex}
          showDateAxis={true}
        />
      </section>
      {performancePoint && betaPoint ? (
        <div
          className={`historyTooltip ${
            performancePoint.x > model.performance.width * 0.72
              ? "alignRight"
              : performancePoint.x < model.performance.width * 0.28
                ? "alignLeft"
                : ""
          }`}
          style={{
            left: `${(performancePoint.x / model.performance.width) * 100}%`,
            top: "112px",
          }}
        >
          <strong>{performancePoint.date}</strong>
          <span>投組績效 {formatSignedPercent(performancePoint.portfolioReturn)}</span>
          <span>
            0050{" "}
            {performancePoint.benchmarkReturn === null
              ? "資料不足"
              : formatSignedPercent(performancePoint.benchmarkReturn)}
          </span>
          <span>投組 Beta {formatNumber(betaPoint.currentBeta)}</span>
        </div>
      ) : null}
    </div>
  );
}

function HistoryChartPanel({ model, activePointIndex, onActivePointChange, showDateAxis }) {
  return (
      <svg
        className="historyChartSvg"
        viewBox={`0 0 ${model.width} ${model.height}`}
        role="img"
        aria-label={model.mode === "beta" ? "Beta 歷史曲線" : "投組與 0050 績效曲線"}
        preserveAspectRatio="none"
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
          <polyline className="historyLine portfolio" points={model.betaPoints} />
        ) : (
          <>
            <polyline className="historyLine portfolio" points={model.portfolioPoints} />
            <polyline className="historyLine benchmark performanceBenchmark" points={model.benchmarkPoints} />
          </>
        )}
        {showDateAxis
          ? model.xTicks.map((tick) => (
              <text
                className="historyXAxisLabel"
                key={`${tick.label}-${tick.x}`}
                x={tick.x}
                y={model.height - 4}
                textAnchor={tick.anchor}
              >
                {tick.label}
              </text>
            ))
          : null}
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
              onFocus={() => onActivePointChange(index)}
              onPointerEnter={() => onActivePointChange(index)}
              onClick={() => onActivePointChange(index)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onActivePointChange(index);
                }
              }}
            />
          </g>
        ))}
      </svg>
  );
}

function OperationsView({
  appliedSummary,
  canApplyRebalance,
  calculation,
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
  const { recommendations, warnings } = operationRebalance;
  const appliedAfterBeta = getAppliedAfterBeta({
    precision,
    recommendations,
    totalAssetsTwd: operationRebalance.totalAssetsTwd,
  });
  const rebalanceStatus = getOperationRebalanceStatus(
    calculation.currentBeta,
    calculation.betaLower,
    calculation.betaUpper,
  );

  return (
    <section className="appCard operationsPageCard">
      <div className="cardHeaderRow operationHeaderRow">
        <div>
          <div className="cardTitleRow operationTitleRow">
            <h2>再平衡參數設定</h2>
            <button
              type="button"
              className="infoButton overviewCardInfoButton"
              onClick={onOpenGlossary}
              aria-label="查看再平衡操作說明"
            >
              i
            </button>
          </div>
          <p>共 {appliedSummary.actionCount} 筆操作，金額依目前交易精度估算。</p>
        </div>
        <div
          className={`operationRebalanceStatus ${rebalanceStatus.tone}`}
          role="status"
        >
          <span>目前狀態</span>
          <strong>{rebalanceStatus.label}</strong>
        </div>
      </div>
      <div className="operationSummaryGrid">
        <div>
          <span>目標 Beta</span>
          <strong>{formatNumber(calculation.targetBeta)}</strong>
          <small>
            容忍區間 {formatNumber(calculation.betaLower)}–{formatNumber(calculation.betaUpper)}
          </small>
        </div>
        <div>
          <span>目前 Beta</span>
          <strong>{formatNumber(calculation.currentBeta)}</strong>
        </div>
        <div>
          <span>再平衡後 Beta</span>
          <strong>{formatNumber(appliedAfterBeta)}</strong>
        </div>
        <div>
          <span>槓桿</span>
          <strong>{formatNetTradeAmount(appliedSummary.leveragedNetAmountTwd)}</strong>
        </div>
        <div>
          <span>原形</span>
          <strong>{formatNetTradeAmount(appliedSummary.originalNetAmountTwd)}</strong>
        </div>
        <div>
          <span>類現金 ETF</span>
          <strong>{formatNetTradeAmount(appliedSummary.cashEquivalentNetAmountTwd)}</strong>
        </div>
        <div>
          <span>現金</span>
          <strong>{formatCashDelta(appliedSummary.cashDeltaTwd)}</strong>
        </div>
      </div>
      <div className="operationParameterCard">
        <div className="operationParameterRow operationBetaField">
          <span>再平衡到 Beta</span>
          <div className="operationBetaStepper">
            <button
              type="button"
              aria-label="降低再平衡 Beta 0.01"
              disabled={Number(rebalanceTargetBeta) <= 0}
              onClick={() => onTargetBetaChange(
                adjustOperationTargetBeta(rebalanceTargetBeta, -0.01),
              )}
            >
              −
            </button>
            <input
              type="number"
              min="0"
              max="3"
              step="0.01"
              value={rebalanceTargetBeta}
              onChange={(event) => onTargetBetaChange(event.target.value)}
            />
            <button
              type="button"
              aria-label="提高再平衡 Beta 0.01"
              disabled={Number(rebalanceTargetBeta) >= 3}
              onClick={() => onTargetBetaChange(
                adjustOperationTargetBeta(rebalanceTargetBeta, 0.01),
              )}
            >
              ＋
            </button>
          </div>
        </div>
        <div className="operationParameterRow operationPrecisionField">
          <div className="operationPrecisionLabel">
            <span>台股交易精度</span>
            <p>美股固定精確到股數。</p>
          </div>
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
              復原
            </button>
          ) : null}
        </div>
        {restoreStatus ? <p className="operationRestoreStatus">{restoreStatus}</p> : null}
      </div>
    </section>
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
    (item) => item.assetType !== "cashEquivalent" && getHoldingAssetType(item.assetBeta) === "leveraged",
  );
  const originalRecommendations = recommendations.filter(
    (item) => item.assetType !== "cashEquivalent" && getHoldingAssetType(item.assetBeta) === "original",
  );
  const cashEquivalentRecommendations = recommendations.filter(
    (item) => item.assetType === "cashEquivalent",
  );

  return (
    <section className="holdingsCard">
      <div className="holdingGroups">
        <HoldingGroup
          items={leveragedRecommendations}
          onToggleSelection={onToggleSelection}
          precision={precision}
          tone="leveraged"
          title="槓桿再平衡清單"
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
        {cashEquivalentRecommendations.length > 0 && (
          <HoldingGroup
            items={cashEquivalentRecommendations}
            onToggleSelection={onToggleSelection}
            precision={precision}
            tone="cash"
            title="類現金再平衡清單"
            totalAssetsTwd={totalAssetsTwd}
          />
        )}
        {recommendations.length === 0 && (
          <div className="emptyState">更新價格後會顯示再平衡操作清單。</div>
        )}
      </div>
    </section>
  );
}

function getHoldingAssetType(assetBeta) {
  return Number(assetBeta) > 1 ? "leveraged" : "original";
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
  const actionSummaryText = displayedAction === "none"
    ? actionText
    : `${actionText} ${estimatedShares.toLocaleString("zh-TW")} 股`;
  const displayedTradeAmountTwd = estimatedShares * item.priceTwd;
  const currentPct = clampPercent(item.currentSleeveWeight);
  const afterSleeveWeight = item.appliedAfterSleeveWeight ?? item.afterSleeveWeight;
  const afterPct = clampPercent(afterSleeveWeight);
  const afterDrift = afterSleeveWeight - item.currentSleeveWeight;
  const hasCustomTarget = item.allocationMode === "custom" && item.targetSleeveWeight !== null;
  const targetPct = clampPercent(item.targetSleeveWeight);
  const displayTicker = getTickerDisplayText(item.normalizedTicker);

  return (
    <article className={`holdingRow ${item.isSelected ? "" : "unselected"}`}>
      <div className="holdingAsset">
        <label className="holdingSelect">
          <input
            type="checkbox"
            checked={item.isSelected}
            onChange={() => onToggleSelection(item.id)}
            aria-label={`${displayTicker} 是否納入本次再平衡`}
          />
        </label>
        <div className="holdingIdentity">
          <div className="holdingTickerLine">
            <strong>{displayTicker}</strong>
            {getHoldingAssetType(item.assetBeta) === "leveraged" && (
              <span className="exposureMultiplierBadge">
                {formatExposureMultiplier(item.assetBeta)}
              </span>
            )}
          </div>
          <span>{getPositionDisplayName(item.normalizedTicker, item.assetBeta)}</span>
          <em>市值 {formatTwd(item.currentValueTwd)}</em>
          <em>股價 {formatQuotePrice(item.price, item.currency)} · 更新 {formatQuoteDate(item.date)}</em>
        </div>
      </div>

      <div className="holdingRatioPanel">
        <div
          className={`holdingProgress ${displayedAction}`}
          style={{
            "--current-ratio": `${currentPct}%`,
            "--after-ratio": `${afterPct}%`,
            "--target-ratio": `${targetPct}%`,
          }}
          aria-label={`目前 ${formatPercent(item.currentSleeveWeight)}${hasCustomTarget ? `，目標 ${formatPercent(item.targetSleeveWeight)}` : ""}，再平衡後 ${formatPercent(afterSleeveWeight)}`}
        >
          <span className="holdingProgressFill" />
          {hasCustomTarget && <span className="holdingProgressTarget" />}
          <span className="holdingProgressAfter" />
        </div>
        <div className="holdingRatioLabels">
          <span>目前 {formatPercent(item.currentSleeveWeight)}</span>
          {hasCustomTarget && <span>目標 {formatPercent(item.targetSleeveWeight)}</span>}
          <span>再平衡後 {formatPercent(afterSleeveWeight)}</span>
        </div>
        {displayedAction !== "none" && (
          <div className="holdingDrift">
            調整幅度{" "}
            <strong className={displayedAction}>{formatSignedPercent(afterDrift)}</strong>
          </div>
        )}
      </div>

      <div className="holdingAction">
        <span className={`holdingActionLine ${displayedAction}`}>{actionSummaryText}</span>
        <strong>{formatTwd(displayedTradeAmountTwd)}</strong>
      </div>
    </article>
  );
}

function PositionSection({
  addLabel,
  emptyText,
  formState,
  onAddPosition,
  onRemovePosition,
  onUpdatePosition,
  positions,
  title,
  assetType,
  mode,
  onUpdateAllocationMode,
}) {
  const status = getPositionGroupTargetStatus({ mode, positions });
  return (
    <section className={`positionSection ${assetType} ${status.isValid ? "ok" : "error"}`}>
      <div className="positionSectionHeader">
        <div>
          <strong>{title}</strong>
          <span>{positions.length} 筆標的</span>
        </div>
        {mode === "custom" && <em>合計 {formatNumber(status.totalPct)}% / 100%</em>}
      </div>

      <div className="allocationModeControl" role="radiogroup" aria-label={`${title}個股佔比分配方式`}>
        <span>個股佔比分配方式</span>
        <div>
          <button type="button" className={mode === "auto" ? "active" : ""} onClick={() => onUpdateAllocationMode(assetType, "auto")}>自動分配</button>
          <button type="button" className={mode === "custom" ? "active" : ""} onClick={() => onUpdateAllocationMode(assetType, "custom")}>自訂個股佔比</button>
        </div>
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
              >
                移除
              </button>
            </div>
            <div className="positionEditorPrimaryFields">
              <label>
                <span>代號</span>
                <input
                  value={position.tickerInput}
                  onChange={(event) =>
                    onUpdatePosition(position.id, "tickerInput", event.target.value)
                  }
                  placeholder={getTickerPlaceholder(assetType)}
                />
              </label>
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
            </div>
            {assetType === "leveraged" && (
              <label className="positionEditorAllocationField">
                <span>曝險倍數</span>
                <input
                  type="number"
                  min="1"
                  max="3"
                  step="0.1"
                  value={position.assetBeta}
                  aria-invalid={Boolean(position.tickerInput) && (
                    position.assetBeta === "" ||
                    Number(position.assetBeta) < 1 ||
                    Number(position.assetBeta) > 3
                  )}
                  onChange={(event) => onUpdatePosition(position.id, "assetBeta", event.target.value)}
                />
                {position.tickerInput && position.assetBeta === "" && (
                  <small className="fieldError">請輸入曝險倍數。</small>
                )}
              </label>
            )}
            {mode === "custom" && (
              <label className="positionEditorAllocationField">
                <span>同類資產內目標比例 %</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={position.targetWeightPct}
                  aria-invalid={!status.isValid}
                  onChange={(event) => onUpdatePosition(position.id, "targetWeightPct", event.target.value)}
                />
              </label>
            )}
          </div>
        ))}
        {positions.length === 0 && <div className="emptyState compact">{emptyText}</div>}
      </div>

      {mode === "custom" && !status.isValid && (
        <p className="fieldError">{title}標的目標比例合計必須等於 100%。</p>
      )}

      <button type="button" className="secondaryButton fullWidth" onClick={onAddPosition}>
        {addLabel}
      </button>
    </section>
  );
}

function SettingsAccordions({
  backupStatus,
  cashChangeReason,
  calculation,
  formState,
  fx,
  historyCount,
  initialPage,
  onAddPosition,
  onAddCashEquivalentPosition,
  onExportBackup,
  onImportBackup,
  onRemovePosition,
  onRemoveCashEquivalentPosition,
  onSetCashChangeReason,
  onUpdatePosition,
  onUpdateCashEquivalentPosition,
  onUpdateSetting,
  onUpdateAllocationMode,
}) {
  const positionGroups = getPositionGroups(formState.positions);
  const hasConfiguredPositions = formState.positions.some(
    (position) => String(position.tickerInput || "").trim(),
  );
  const hasConfiguredLeveragedPositions = positionGroups.leveraged.length > 0
    && positionGroups.leveraged.some((position) => String(position.tickerInput || "").trim());
  const hasOriginalPositions = positionGroups.original.length > 0;
  const hasConfiguredOriginalPositions = positionGroups.original.some(
    (position) => String(position.tickerInput || "").trim(),
  );
  const hasFundedOriginalPositions = hasConfiguredOriginalPositions && calculation.originalValueTwd > 0;
  const betaGuardIsValid = calculation.errors.length === 0;
  const cashEquivalentStatus = getCashEquivalentTargetStatus({
    mode: formState.cashEquivalentMode,
    positions: formState.cashEquivalentPositions,
    realCashTargetPct: formState.realCashTargetPct,
  });
  const [activeSettingsPage, setActiveSettingsPage] = useState(initialPage);
  const settingsPagesWithErrors = new Set(
    calculation.issues.map((issue) => issue.settingsPage).filter(Boolean),
  );
  const betaBlockingIssue = calculation.issues.find((issue) =>
    issue.code === "TARGET_BETA_UNREACHABLE"
    || issue.code === "TARGET_BETA_UNREACHABLE_WITHOUT_LEVERAGE",
  );
  const originalTargetIssue = calculation.issues.find((issue) =>
    issue.code === "ORIGINAL_TARGET_REQUIRED" || issue.code === "INVALID_ORIGINAL_TARGET",
  );
  const targetRealCashRatio = calculation.totalAssetsTwd > 0
    ? calculation.targetRealCashTwd / calculation.totalAssetsTwd
    : 0;
  const targetCashEquivalentRatio = Math.max(calculation.afterCashRatio - targetRealCashRatio, 0);

  function setOriginalAllocationMode(mode) {
    if (mode === "custom") {
      onUpdateSetting("originalTargetPct", calculation.originalRatio * 100);
      return;
    }
    onUpdateSetting("originalAllocationMode", "current");
  }

  return (
    <section className="settingsStack" aria-label="參數設定">
      <div className="settingsIntro">
        <div>
          <div className="cardTitleRow settingsTitleRow">
            <p>參數設定</p>
          </div>
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
              <span>{item.label}</span>
              {settingsPagesWithErrors.has(item.id) && (
                <i className="settingsTabErrorDot" aria-label={`${item.label}有待修正設定`} />
              )}
            </button>
          ))}
        </nav>

        <div className="settingsBody">
          {activeSettingsPage === "cash" && (
            <>
              <div className="positionEditor cashEditor cash" aria-label="現金設定">
              <div className="positionTitle">
                <strong>現金</strong>
              </div>
              <div className="cashFxInfo">
                <span>USD/TWD 匯率</span>
                <strong>{fx.usdTwd ? numberDisplay.format(fx.usdTwd) : "尚未更新"}</strong>
                <em>更新 {formatQuoteDate(fx.date)}</em>
              </div>
              <p className="hint">現金分類</p>
              <div className="cashReasonPanel" role="radiogroup" aria-label="本次現金變動原因">
                <p>本次現金變動原因</p>
                {[
                  {
                    id: "fee",
                    label: "手續費 / 交易成本",
                    hint: "計入績效，適合再平衡後補登費用。",
                  },
                  {
                    id: "external",
                    label: "新資金投入 / 提領",
                    hint: "排除績效，避免加錢或領錢扭曲報酬。",
                  },
                  {
                    id: "correction",
                    label: "資料修正",
                    hint: "排除績效，只修正目前資料。",
                  },
                ].map((item) => (
                  <label
                    className={cashChangeReason === item.id ? "active" : ""}
                    key={item.id}
                  >
                    <input
                      type="radio"
                      name="cashChangeReason"
                      value={item.id}
                      checked={cashChangeReason === item.id}
                      onChange={() => onSetCashChangeReason(item.id)}
                    />
                    <span>
                      <strong>{item.label}</strong>
                      <em>{item.hint}</em>
                    </span>
                  </label>
                ))}
              </div>
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
              <section
                className={`positionEditor cashEquivalentCard cash cashEquivalentSection ${cashEquivalentStatus.isValid ? "ok" : "error"}`}
                aria-label="類現金設定"
              >
                <div className="positionSectionHeader">
                  <div>
                    <strong>類現金標的</strong>
                    <span>{formState.cashEquivalentPositions.length} 筆 ETF</span>
                  </div>
                  {formState.cashEquivalentMode === "custom" && (
                    <em>合計 {formatNumber(cashEquivalentStatus.totalPct)}% / 100%</em>
                  )}
                </div>
                <div className="allocationModeControl" role="radiogroup" aria-label="類現金配置方式">
                  <span>配置方式</span>
                  <div>
                    <button
                      type="button"
                      className={formState.cashEquivalentMode === "auto" ? "active" : ""}
                      onClick={() => onUpdateSetting("cashEquivalentMode", "auto")}
                    >
                      自動配置
                    </button>
                    <button
                      type="button"
                      className={formState.cashEquivalentMode === "custom" ? "active" : ""}
                      onClick={() => onUpdateSetting("cashEquivalentMode", "custom")}
                    >
                      自訂比例
                    </button>
                  </div>
                </div>
                <label>
                  <span>現金部位內的真實現金比例 %</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={formState.realCashTargetPct}
                    onChange={(event) => onUpdateSetting("realCashTargetPct", event.target.value)}
                  />
                </label>
                <p className="hint">此比例只分配現金部位，不代表占總資產的比例。</p>
                {formState.cashEquivalentPositions.map((position, index) => (
                  <div className="positionEditor cashEquivalentEditor" key={position.id}>
                    <div className="positionTitle">
                      <strong>類現金 {index + 1}</strong>
                      <button type="button" className="textButton" onClick={() => onRemoveCashEquivalentPosition(position.id)}>移除</button>
                    </div>
                    <div className="positionEditorPrimaryFields">
                      <label>
                        <span>代號</span>
                        <input
                          value={position.tickerInput}
                          placeholder={getTickerPlaceholder("cashEquivalent")}
                          onChange={(event) => onUpdateCashEquivalentPosition(position.id, "tickerInput", event.target.value)}
                        />
                      </label>
                      <label>
                        <span>股數</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={position.shares}
                          onChange={(event) => onUpdateCashEquivalentPosition(position.id, "shares", event.target.value)}
                        />
                      </label>
                    </div>
                    {formState.cashEquivalentMode === "custom" && (
                      <label className="positionEditorAllocationField">
                        <span>現金桶內目標比例 %</span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={position.targetWeightPct}
                          onChange={(event) => onUpdateCashEquivalentPosition(position.id, "targetWeightPct", event.target.value)}
                        />
                      </label>
                    )}
                  </div>
                ))}
                {!cashEquivalentStatus.isValid && (
                  <p className="fieldError">真實現金與類現金標的目標比例合計必須等於 100%。</p>
                )}
                <p className="hint">類現金 ETF 仍有價格波動，並非保本現金。</p>
                <button type="button" className="secondaryButton fullWidth" onClick={onAddCashEquivalentPosition}>
                  新增類現金標的
                </button>
              </section>
            </>
          )}

          {activeSettingsPage === "positions" && (
            <>
              <div className="settingsSummaryLine">
                <strong>{formState.positions.length} 筆標的</strong>
                <span>
                  槓桿 {positionGroups.leveraged.length} 檔
                  {hasOriginalPositions ? ` / 原形 ${positionGroups.original.length} 檔` : ""}
                </span>
              </div>
              <div className="positionSections">
                <PositionSection
                  addLabel="新增槓桿"
                  emptyText="尚未設定槓桿標的。"
                  formState={formState}
                  onAddPosition={() => onAddPosition(2)}
                  onRemovePosition={onRemovePosition}
                  onUpdatePosition={onUpdatePosition}
                  positions={positionGroups.leveraged}
                  title="槓桿"
                  assetType="leveraged"
                  mode={formState.allocationModes.leveraged}
                  onUpdateAllocationMode={onUpdateAllocationMode}
                />
                {hasOriginalPositions && (
                  <PositionSection
                    addLabel="新增原形"
                    emptyText="尚未設定原形標的。"
                    formState={formState}
                    onAddPosition={() => onAddPosition(1)}
                    onRemovePosition={onRemovePosition}
                    onUpdatePosition={onUpdatePosition}
                    positions={positionGroups.original}
                    title="原形"
                    assetType="original"
                    mode={formState.allocationModes.original}
                    onUpdateAllocationMode={onUpdateAllocationMode}
                  />
                )}
                {!hasOriginalPositions && (
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
            {!hasConfiguredPositions ? (
              <div className="betaSetupSteps" aria-label="首次設定步驟">
                <div className="betaSetupStep">
                  <strong><span>1</span>先設定目標 Beta</strong>
                  <p>輸入你希望維持的市場曝險程度。</p>
                </div>
                <div className="betaSetupStep">
                  <strong><span>2</span>接下來至持股頁新增持股</strong>
                  <p>請新增至少一檔槓桿或原形標的。</p>
                </div>
                <div className="betaSetupStep">
                  <strong><span>3</span>填寫可用資金（選填）</strong>
                  <p>若有台幣、美金或類現金資產，請至現金頁填寫；目前已滿倉可略過。</p>
                </div>
              </div>
            ) : betaGuardIsValid ? (
                <div className="weightGuardSummary">
                  <strong>
                    <span>依目前持股推算配置</span>
                    <span className="weightGuardRatios">
                      槓桿 {formatPercent(calculation.targetLeveragedRatio)} / 原形{" "}
                      {formatPercent(calculation.targetOriginalRatio)} / 現金{" "}
                      {formatPercent(calculation.afterCashRatio)}
                    </span>
                  </strong>
                  <span>
                    {hasConfiguredLeveragedPositions
                      ? `槓桿平均 ${formatExposureMultiplier(calculation.targetLeveragedBeta)}；`
                      : ""}
                    {hasConfiguredLeveragedPositions && hasOriginalPositions
                      ? formState.originalAllocationMode === "custom"
                        ? "原形使用自訂目標比例。"
                        : "原形持股維持目前比例。"
                      : "剩餘資產保留為現金。"}
                  </span>
                  {formState.cashEquivalentPositions.length > 0 && (
                    <span>
                      現金部位包含：真實現金 {formatPercent(targetRealCashRatio)}／類現金標的{" "}
                      {formatPercent(targetCashEquivalentRatio)}
                    </span>
                  )}
                  <span>
                    目前可達 Beta：{formatNumber(calculation.minimumReachableBeta)}～
                    {formatNumber(calculation.maximumReachableBeta)}
                  </span>
                </div>
            ) : (
              <span>
                {betaBlockingIssue ? betaBlockingIssue.message : "完成下方設定後，將顯示推算配置。"}
              </span>
            )}
          </div>
          <div className="positionEditor betaParameterGroup">
            <div className="positionTitle">
              <strong>Beta 目標</strong>
            </div>
            <label>
              <span>目標 Beta</span>
              <input
                type="number"
                step="0.01"
                min="0"
                max="3"
                value={formState.targetBeta}
                placeholder="1.0 / 1.2 / 1.4 / 1.6"
                onChange={(event) => onUpdateSetting("targetBeta", event.target.value)}
              />
              {formState.targetBeta === "" && (
                <small className="fieldError">請輸入目標 Beta。</small>
              )}
            </label>
            <p className="hint">Beta 是目標，持股是工具，現金是結果；更換標的或曝險倍數不會改變目標。</p>
          </div>
          <div className="positionEditor betaParameterGroup secondary">
            <div className="positionTitle">
              <strong>原形配置</strong>
            </div>
            {!hasConfiguredOriginalPositions ? (
              <>
                <p className="hint">尚未新增原形標的，目前原形比例為 0%。</p>
                <button
                  type="button"
                  className="secondaryButton fullWidth"
                  onClick={() => setActiveSettingsPage("positions")}
                >
                  前往持股新增原形
                </button>
              </>
            ) : hasFundedOriginalPositions ? (
              <>
                <div className="allocationModeControl" role="radiogroup" aria-label="原形配置方式">
                  <span>配置方式</span>
                  <div>
                    <button
                      type="button"
                      className={formState.originalAllocationMode === "current" ? "active" : ""}
                      onClick={() => setOriginalAllocationMode("current")}
                    >
                      維持目前比例
                    </button>
                    <button
                      type="button"
                      className={formState.originalAllocationMode === "custom" ? "active" : ""}
                      onClick={() => setOriginalAllocationMode("custom")}
                    >
                      自訂目標比例
                    </button>
                  </div>
                </div>
                {formState.originalAllocationMode === "current" ? (
                  <p className="hint">目前原形占總資產 {formatPercent(calculation.originalRatio)}。</p>
                ) : (
                  <label>
                    <span>原形目標比例 %</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={formState.originalTargetPct}
                      onChange={(event) => onUpdateSetting("originalTargetPct", event.target.value)}
                    />
                  </label>
                )}
              </>
            ) : (
              <>
                {originalTargetIssue && (
                  <p className="fieldError">{originalTargetIssue.message}</p>
                )}
                <label>
                  <span>原形目標比例 %</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={formState.originalTargetPct}
                    onChange={(event) => onUpdateSetting("originalTargetPct", event.target.value)}
                  />
                </label>
              </>
            )}
          </div>
          <div className="positionEditor betaParameterGroup secondary">
            <div className="positionTitle">
              <strong>再平衡容忍度</strong>
            </div>
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
            <p className="hint">Beta 偏離目標在這個範圍內時，首頁會顯示「無需操作」。</p>
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
