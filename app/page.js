"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { createBetaRailModel } from "../src/lib/beta-rail.js";
import { calculateCashTwdValue } from "../src/lib/cash.js";
import { normalizeTicker } from "../src/lib/market-data.js";
import { calculatePortfolio } from "../src/lib/portfolio.js";
import {
  applyRebalanceToState,
  getRebalanceShareDelta,
} from "../src/lib/rebalance-apply.js";
import {
  getActionText,
  getEstimatedShares,
  getPositionDisplayName,
  getTickerBadgeText,
} from "../src/lib/presentation.js";

const STORAGE_KEY = "jj-invest-public-overview-v1";

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
  const estimatedShares = primaryRecommendation
    ? getEstimatedShares(primaryRecommendation.tradeAmountTwd, primaryRecommendation.priceTwd)
    : 0;

  if (!calculation.isValid) {
    return {
      tone: "none",
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
      label: "無需操作",
      ticker: "目前位於容忍區間",
      amount: "目前位於容忍區間",
      shares: "0 股",
    };
  }

  return {
    tone: calculation.totalTradeAmountTwd > 0 ? "buy" : "sell",
    label: calculation.totalTradeAmountTwd > 0 ? "買入" : "賣出",
    ticker: primaryRecommendation.normalizedTicker,
    amount: formatTwd(Math.abs(calculation.totalTradeAmountTwd)),
    shares: `${estimatedShares.toLocaleString("zh-TW")} 股`,
  };
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

export default function Home() {
  const [formState, setFormState, hydrated] = useStoredState();
  const [quoteResult, setQuoteResult] = useState(emptyQuoteResult);
  const [status, setStatus] = useState("idle");
  const [requestError, setRequestError] = useState("");
  const [rebalancePrecision, setRebalancePrecision] = useState("shares");
  const operationsRef = useRef(null);

  const tickers = useMemo(
    () =>
      formState.positions
        .map((position) => position.tickerInput)
        .filter((ticker) => String(ticker || "").trim()),
    [formState.positions],
  );

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
  const betaRail = createBetaRailModel(calculation);
  const primaryRecommendation = getPrimaryRecommendation(calculation.recommendations);
  const advice = getAdvice(calculation, primaryRecommendation);
  const canApplyRebalance =
    calculation.isValid &&
    calculation.needsRebalance &&
    calculation.recommendations.length > 0 &&
    Math.abs(calculation.totalTradeAmountTwd) > 0.5;

  async function refreshQuotes() {
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
      setQuoteResult(payload);
      setStatus("ready");
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "價格更新失敗。");
      setStatus("error");
    }
  }

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

  function addPosition() {
    setFormState((current) => ({
      ...current,
      positions: [
        ...current.positions,
        {
          id: `position-${Date.now()}`,
          tickerInput: "",
          shares: 0,
          assetBeta: 2,
          targetWeightPct: 0,
        },
      ],
    }));
  }

  function removePosition(id) {
    setFormState((current) => ({
      ...current,
      positions:
        current.positions.length === 1
          ? current.positions
          : current.positions.filter((position) => position.id !== id),
    }));
  }

  function resetState() {
    setFormState(DEFAULT_STATE);
    setQuoteResult(emptyQuoteResult);
    setStatus("idle");
    setRequestError("");
  }

  function scrollToOperations() {
    operationsRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function applyOneClickRebalance() {
    if (!canApplyRebalance) {
      return;
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
        recommendations: calculation.recommendations,
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
  }

  return (
    <main className="appShell">
      <AppHeader fx={quoteResult.fx} status={status} onRefresh={refreshQuotes} />

      {(requestError || quoteResult.fx.error || quoteErrors.length > 0 || calculation.errors.length > 0) && (
        <div className="alertCard" role="alert">
          {requestError && <p>{requestError}</p>}
          {quoteResult.fx.error && <p>匯率：{quoteResult.fx.error}</p>}
          {quoteErrors.map((quote) => (
            <p key={quote.inputTicker}>
              {quote.inputTicker}：{quote.error}
            </p>
          ))}
          {calculation.errors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      )}

      <BetaCard calculation={calculation} betaRail={betaRail} />

      <AdviceCard
        advice={advice}
        canApplyRebalance={canApplyRebalance}
        precision={rebalancePrecision}
        onApplyRebalance={applyOneClickRebalance}
        onPrecisionChange={setRebalancePrecision}
        onViewOperations={scrollToOperations}
      />

      <AllocationCard calculation={calculation} />

      <HoldingList
        recommendations={calculation.recommendations}
        precision={rebalancePrecision}
        refTarget={operationsRef}
      />

      <SettingsAccordions
        calculation={calculation}
        formState={formState}
        hydrated={hydrated}
        onAddPosition={addPosition}
        onRemovePosition={removePosition}
        onReset={resetState}
        onUpdatePosition={updatePosition}
        onUpdateSetting={updateSetting}
      />
    </main>
  );
}

function AppHeader({ fx, status, onRefresh }) {
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
          <span>Beta 再平衡公開試算版</span>
        </div>
      </div>
      <button
        type="button"
        className="iconButton"
        onClick={onRefresh}
        disabled={status === "loading"}
        aria-label="更新價格"
      >
        {status === "loading" ? "..." : "↻"}
      </button>
      <div className="fxPill">
        USD/TWD{" "}
        <strong>{fx.usdTwd ? numberDisplay.format(fx.usdTwd) : "尚未更新"}</strong>
      </div>
    </header>
  );
}

function BetaCard({ calculation, betaRail }) {
  const betaStatus = getBetaStatus(calculation);

  return (
    <section className="appCard betaCard">
      <div className="betaTopline">
        <div>
          <p className="cardLabel">目前 Beta</p>
          <div className="megaNumber">{formatNumber(calculation.currentBeta)}</div>
        </div>
        <div className="betaMetaGrid">
          <div>
            <span>目標 Beta</span>
            <strong>{formatNumber(calculation.targetBeta)}</strong>
          </div>
          <div>
            <span>容忍區間</span>
            <strong>
              {formatNumber(calculation.betaLower)} ~ {formatNumber(calculation.betaUpper)}
            </strong>
          </div>
        </div>
      </div>

      <div className={`statusPill ${betaStatus.tone === "ok" ? "ok" : "warning"}`}>
        <span />
        {betaStatus.label}
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

      <div className="betaInsightGrid">
        <p className="betaDrift">
          與目標差距{" "}
          <strong className={calculation.betaDrift > 0 ? "sell" : "buy"}>
            {calculation.betaDrift >= 0 ? "+" : ""}
            {formatNumber(calculation.betaDrift)}
          </strong>
        </p>
        <p className="betaDrift">
          {betaStatus.boundaryLabel}{" "}
          <strong className={betaStatus.tone === "sell" ? "sell" : "buy"}>
            {betaStatus.boundaryGap >= 0 ? "+" : ""}
            {formatNumber(betaStatus.boundaryGap)}
          </strong>
        </p>
      </div>
    </section>
  );
}

function AdviceCard({
  advice,
  canApplyRebalance,
  precision,
  onApplyRebalance,
  onPrecisionChange,
  onViewOperations,
}) {
  return (
    <section className="appCard adviceCard">
      <div className={`adviceIcon ${advice.tone}`} aria-hidden="true">
        <span />
      </div>
      <div className="adviceContent">
        <p className="cardLabel">再平衡建議</p>
        <h2 className={advice.tone}>{advice.label}</h2>
        <strong>{advice.amount}</strong>
      </div>
      {canApplyRebalance && (
        <div className="rebalanceApplyPanel">
          <div className="precisionControl" aria-label="再平衡精度">
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
            <label className={precision === "lots" ? "selected" : ""}>
              <input
                type="radio"
                name="rebalancePrecision"
                value="lots"
                checked={precision === "lots"}
                onChange={() => onPrecisionChange("lots")}
              />
              台股精確到張數
            </label>
          </div>
          <p>美股固定精確到股數。</p>
          <button type="button" className="primaryButton" onClick={onApplyRebalance}>
            一鍵再平衡
          </button>
        </div>
      )}
      <button type="button" className="secondaryButton fullWidth adviceSecondaryButton" onClick={onViewOperations}>
        查看操作清單
      </button>
    </section>
  );
}

function AllocationCard({ calculation }) {
  const cashValueTwd = calculation.totalAssetsTwd - calculation.stockValueTwd;

  return (
    <section className="appCard allocationCard">
      <div className="cardHeaderRow">
        <div>
          <h2>資產配置比例</h2>
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

function HoldingList({ recommendations, precision, refTarget }) {
  return (
    <section className="appCard holdingsCard" ref={refTarget}>
      <div className="cardHeaderRow">
        <div>
          <h2>再平衡操作清單</h2>
          <p>標的、市值、目前比例、目標比例、建議操作</p>
        </div>
      </div>

      <div className="holdingList">
        {recommendations.map((item) => (
          <HoldingRow item={item} key={item.id} precision={precision} />
        ))}
        {recommendations.length === 0 && (
          <div className="emptyState">更新價格後會顯示再平衡操作清單。</div>
        )}
      </div>

    </section>
  );
}

function HoldingRow({ item, precision }) {
  const estimatedShares = Math.abs(getRebalanceShareDelta(item, precision));
  const displayedAction = estimatedShares === 0 ? "none" : item.action;
  const actionText = getActionText(displayedAction);
  const displayedTradeAmountTwd = estimatedShares * item.priceTwd;
  const drift = item.currentSleeveWeight - item.targetSleeveWeight;
  const driftClass = getDriftClass(drift);
  const currentPct = clampPercent(item.currentSleeveWeight);
  const targetPct = clampPercent(item.targetSleeveWeight);

  return (
    <article className="holdingRow">
      <div className="holdingAsset">
        <div className={`tickerBadge ${getTradeClass(item)}`}>
          {getTickerBadgeText(item.normalizedTicker)}
        </div>
        <div className="holdingIdentity">
          <strong>{item.normalizedTicker}</strong>
          <span>{getPositionDisplayName(item.normalizedTicker)}</span>
          <em>市值 {formatTwd(item.currentValueTwd)}</em>
          <em>股價 {formatTwdPrice(item.priceTwd)} · 更新 {formatQuoteDate(item.date)}</em>
        </div>
      </div>

      <div className="holdingRatioPanel">
        <div
          className={`holdingProgress ${driftClass}`}
          style={{
            "--current-ratio": `${currentPct}%`,
            "--target-ratio": `${targetPct}%`,
          }}
          aria-label={`目前 ${formatPercent(item.currentSleeveWeight)}，目標 ${formatPercent(item.targetSleeveWeight)}`}
        >
          <span className="holdingProgressFill" />
          <span className="holdingProgressTarget" />
        </div>
        <div className="holdingRatioLabels">
          <span>目前 {formatPercent(item.currentSleeveWeight)}</span>
          <span>目標 {formatPercent(item.targetSleeveWeight)}</span>
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

function SettingsAccordions({
  calculation,
  formState,
  hydrated,
  onAddPosition,
  onRemovePosition,
  onReset,
  onUpdatePosition,
  onUpdateSetting,
}) {
  const leveragedTargetWeightTotalPct = formState.positions.reduce(
    (sum, position) =>
      sum + (Number(position.assetBeta) === 1 ? 0 : Number(position.targetWeightPct) || 0),
    0,
  );
  const originalTargetWeightTotalPct = formState.positions.reduce(
    (sum, position) =>
      sum + (Number(position.assetBeta) === 1 ? Number(position.targetWeightPct) || 0 : 0),
    0,
  );
  const hasOriginalTarget = Number(formState.originalTargetPct) > 0;
  const hasOriginalPositions = formState.positions.some((position) => Number(position.assetBeta) === 1);
  const targetGuardIsValid = calculation.errors.length === 0;

  return (
    <section className="settingsStack" aria-label="進階設定">
      <details className="settingsPanel">
        <summary>
          <span>投資組合設定</span>
          <em>
            {formState.positions.length} 筆 / 正二 {formatNumber(leveragedTargetWeightTotalPct)}%
            {hasOriginalPositions ? ` / 原形 ${formatNumber(originalTargetWeightTotalPct)}%` : ""}
          </em>
        </summary>
        <div className="settingsBody">
          <div className="positionEditor cashEditor">
            <div className="positionTitle">
              <strong>現金</strong>
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
          <div className="positionList">
            {formState.positions.map((position, index) => (
              <div className="positionEditor" key={position.id}>
                <div className="positionTitle">
                  <strong>標的 {index + 1}</strong>
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
                    <span>資產類型</span>
                    <select
                      value={Number(position.assetBeta) === 1 ? "1" : "2"}
                      onChange={(event) =>
                        onUpdatePosition(position.id, "assetBeta", event.target.value)
                      }
                    >
                      <option value="2">正二（Beta 2）</option>
                      <option value="1">原形（Beta 1）</option>
                    </select>
                  </label>
                </div>
                <label>
                  <span>同類資產內目標比例 %</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={position.targetWeightPct}
                    onChange={(event) =>
                      onUpdatePosition(position.id, "targetWeightPct", event.target.value)
                    }
                  />
                </label>
                <p className="hint">
                  正規化代號：{normalizeTicker(position.tickerInput) || "尚未輸入"}
                </p>
              </div>
            ))}
          </div>
          <div className={`weightGuard ${targetGuardIsValid ? "ok" : "error"}`}>
            <strong>
              同類資產分配：正二 {formatNumber(leveragedTargetWeightTotalPct)}%
              {hasOriginalTarget || hasOriginalPositions
                ? ` / 原形 ${formatNumber(originalTargetWeightTotalPct)}%`
                : ""}
            </strong>
            <span>
              {targetGuardIsValid
                ? "需要配置的資產類型各自符合 100%，可用於再平衡試算。"
                : "請調整同類資產內比例，需配置的類型合計必須等於 100%。"}
            </span>
          </div>
          <div className="buttonRow portfolioActions">
            <button type="button" className="secondaryButton fullWidth" onClick={onAddPosition}>
              新增標的
            </button>
            <button type="button" className="secondaryButton compact" onClick={onReset}>
              恢復預設
            </button>
          </div>
          <p className="hint">{hydrated ? "已自動儲存在此瀏覽器" : "讀取本機設定中"}</p>
        </div>
      </details>

      <details className="settingsPanel">
        <summary>
          <span>Beta 參數</span>
          <em>
            {formatNumber(Number(formState.targetBeta) || 0)} / 原形 {Number(formState.originalTargetPct) || 0}%
          </em>
        </summary>
        <div className="settingsBody">
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
          </div>
          <div className="twoCol">
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
          <div className={`weightGuard ${targetGuardIsValid ? "ok" : "error"}`}>
            <strong>
              推算目標：正二 {formatPercent(calculation.targetLeveragedRatio)} / 原形{" "}
              {formatPercent(calculation.targetOriginalRatio)} / 現金{" "}
              {formatPercent(calculation.afterCashRatio)}
            </strong>
            <span>目標 Beta 會先保留原形比例，再自動推算需要多少正二與現金。</span>
          </div>
        </div>
      </details>
    </section>
  );
}
