"use client";

import { useCallback, useEffect, useState } from "react";

import { useAdminAccessLifecycle } from "./useAdminAccessLifecycle.js";

import {
  isAdminAccessDenied,
  readAdminJson,
} from "../../../src/lib/dynamic-beta/admin-http.js";
import { formatDynamicBetaValue } from "../../../src/lib/dynamic-beta/admin-view.js";
import { createMorningBriefTemplate } from "../../../src/lib/dynamic-beta/news/template.js";

function getAdminToken() {
  if (typeof window === "undefined") return "";
  return new URL(window.location.href).searchParams.get("token") || "";
}

function flagLabel(value) {
  if (value === true) return "啟用";
  if (value === false) return "關閉";
  return "尚未讀取";
}

function FeatureFlagStatus({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd data-feature-enabled={value === true ? "true" : "false"}>
        {flagLabel(value)}
      </dd>
    </div>
  );
}

function formatPercent(value) {
  return Number.isFinite(Number(value))
    ? `${(Number(value) * 100).toFixed(1)}%`
    : "資料不足";
}

function hasSanitizedFlags(value) {
  return value
    && typeof value.dataEnabled === "boolean"
    && typeof value.scoringEnabled === "boolean"
    && typeof value.publicEnabled === "boolean";
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isFiniteNumberOrNull(value) {
  return value === null || isFiniteNumber(value);
}

function hasScorePreviewShape(value) {
  return isRecord(value)
    && typeof value.modelVersion === "string"
    && typeof value.status === "string"
    && typeof value.historyQuality === "string"
    && isFiniteNumber(value.coverage)
    && isFiniteNumberOrNull(value.score)
    && Array.isArray(value.categories)
    && value.categories.every((category) => (
      isRecord(category)
      && typeof category.id === "string"
      && isFiniteNumber(category.weight)
      && isFiniteNumber(category.availableWeight)
      && isFiniteNumberOrNull(category.score)
    ))
    && Array.isArray(value.signals)
    && value.signals.every((signal) => (
      isRecord(signal)
      && typeof signal.id === "string"
      && isFiniteNumber(signal.weight)
      && isFiniteNumberOrNull(signal.score)
      && Array.isArray(signal.actualSeriesIds)
    ));
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function hasNewsResultShape(value, mode) {
  if (!isRecord(value)
    || typeof value.valid !== "boolean"
    || !isStringArray(value.errors)
    || !isStringArray(value.warnings)) {
    return false;
  }
  if (mode !== "save") return true;
  if (value.valid === false) return value.saved === false;
  return value.saved === true
    && value.valid === true
    && isRecord(value.brief)
    && isFiniteNumber(value.brief.revisionNumber);
}

function requestErrorMessage(error, fallbackMessage) {
  return error instanceof Error ? error.message : fallbackMessage;
}

function beginAccessRequest(adminAccess) {
  return typeof adminAccess?.beginAccessRequest === "function"
    ? adminAccess.beginAccessRequest()
    : undefined;
}

function isAccessRequestCurrent(adminAccess, requestAccessEpoch) {
  return typeof adminAccess?.isAccessRequestCurrent !== "function"
    || adminAccess.isAccessRequestCurrent(requestAccessEpoch);
}

function completeValidatedAccess(adminAccess, requestAccessEpoch) {
  return typeof adminAccess?.completeValidatedAccess !== "function"
    || adminAccess.completeValidatedAccess(requestAccessEpoch);
}

function reportAuthorizationLoss({
  adminAccess,
  onAuthorizationLoss,
  error,
  requestAccessEpoch,
}) {
  if (typeof onAuthorizationLoss === "function") {
    return onAuthorizationLoss(error, requestAccessEpoch) !== false;
  }
  if (typeof adminAccess?.reportAuthorizationLoss === "function") {
    return adminAccess.reportAuthorizationLoss(error, requestAccessEpoch);
  }
  return true;
}

async function readFlagStatus({ key, label, url }) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    const payload = await readAdminJson(response, {
      fallbackMessage: `${label} 功能狀態`,
      validate: (candidate) => hasSanitizedFlags(candidate?.flags),
    });
    return { key, flags: payload.flags };
  } catch (error) {
    return {
      key,
      error: error?.kind === "malformed"
        ? `${label} 功能狀態回應格式無效。`
        : requestErrorMessage(error, `${label} 功能狀態讀取失敗。`),
      denialKind: isAdminAccessDenied(error) ? error.kind : null,
      denialError: isAdminAccessDenied(error) ? error : null,
    };
  }
}

export default function AdvancedToolsSection({
  adminAccess = null,
  onAuthorizationLoss = null,
} = {}) {
  const [flags, setFlags] = useState({ market: null, news: null });
  const [flagsStatus, setFlagsStatus] = useState("idle");
  const [flagsError, setFlagsError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [scoreDate, setScoreDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [scorePreview, setScorePreview] = useState(null);
  const [scoreStatus, setScoreStatus] = useState("idle");
  const [scoreError, setScoreError] = useState("");
  const [newsJson, setNewsJson] = useState(() => JSON.stringify(
    createMorningBriefTemplate(),
    null,
    2,
  ));
  const [newsStatus, setNewsStatus] = useState("idle");
  const [newsError, setNewsError] = useState("");
  const [newsResult, setNewsResult] = useState(null);

  const clearRetainedAfterAccessLoss = useCallback((error) => {
    const message = typeof error === "string"
      ? error
      : requestErrorMessage(error, "管理權限已失效。");
    setAccessDenied(true);
    setFlags({ market: null, news: null });
    setScorePreview(null);
    setNewsResult(null);
    setFlagsError(message);
    setScoreError(message);
    setNewsError(message);
    setFlagsStatus("error");
    setScoreStatus("error");
    setNewsStatus("error");
  }, []);

  const clearAfterAuthorizationLoss = useCallback((error, requestAccessEpoch) => {
    const accepted = reportAuthorizationLoss({
      adminAccess,
      onAuthorizationLoss,
      error,
      requestAccessEpoch,
    });
    if (!accepted) return false;
    clearRetainedAfterAccessLoss(error);
    return true;
  }, [adminAccess, clearRetainedAfterAccessLoss, onAuthorizationLoss]);

  useAdminAccessLifecycle(adminAccess, {
    onAccessDenied(snapshot) {
      clearRetainedAfterAccessLoss(snapshot.error || "管理權限已失效。");
    },
    onAccessRecovered() {
      setAccessDenied(false);
      setFlagsError("");
      setScoreError("");
      setNewsError("");
    },
  });

  const loadFlags = useCallback(async () => {
    const token = getAdminToken();
    if (!token) {
      setFlagsError("缺少管理 token。");
      setFlagsStatus("error");
      return;
    }

    const requestAccessEpoch = beginAccessRequest(adminAccess);
    setFlagsStatus("loading");
    setFlagsError("");
    const encodedToken = encodeURIComponent(token);
    const results = await Promise.allSettled([
      readFlagStatus({
        key: "market",
        label: "Dynamic Beta",
        url: `/api/dynamic-beta/admin?token=${encodedToken}`,
      }),
      readFlagStatus({
        key: "news",
        label: "News Event",
        url: `/api/dynamic-beta/news?token=${encodedToken}`,
      }),
    ]);
    const nextFlags = {};
    const errors = [];
    let authorizationDenied = false;
    let authorizationError = null;
    for (const [index, result] of results.entries()) {
      const fallbackLabel = index === 0 ? "Dynamic Beta" : "News Event";
      if (result.status === "rejected") {
        errors.push(`${fallbackLabel} 功能狀態讀取失敗。`);
        continue;
      }
      if (result.value.error) {
        errors.push(result.value.error);
        if (result.value.denialKind === "authorization") {
          authorizationDenied = true;
          authorizationError ||= result.value.denialError;
        } else if (result.value.denialKind === "gate") {
          nextFlags[result.value.key] = null;
        }
        continue;
      }
      nextFlags[result.value.key] = result.value.flags;
    }
    if (authorizationDenied) {
      if (!clearAfterAuthorizationLoss(authorizationError, requestAccessEpoch)) return null;
      setFlagsError(errors.join(" "));
      return;
    }
    if (Object.keys(nextFlags).length) {
      if (!completeValidatedAccess(adminAccess, requestAccessEpoch)) return null;
      setAccessDenied(false);
    } else if (!isAccessRequestCurrent(adminAccess, requestAccessEpoch)) {
      return null;
    }
    if (Object.keys(nextFlags).length) {
      setFlags((previous) => ({ ...previous, ...nextFlags }));
    }
    if (errors.length) {
      setFlagsError(errors.join(" "));
      setFlagsStatus("error");
    } else {
      setFlagsStatus("ready");
    }
  }, [adminAccess, clearAfterAuthorizationLoss]);

  const runScorePreview = useCallback(async () => {
    const token = getAdminToken();
    if (!token) {
      setScoreError("缺少管理 token。");
      setScoreStatus("error");
      return;
    }

    const requestAccessEpoch = beginAccessRequest(adminAccess);
    setScoreStatus("loading");
    setScoreError("");
    try {
      const response = await fetch(
        `/api/dynamic-beta/score-preview?token=${encodeURIComponent(token)}&date=${encodeURIComponent(scoreDate)}`,
        { cache: "no-store" },
      );
      const payload = await readAdminJson(response, {
        fallbackMessage: "Score preview 計算失敗",
        validate: hasScorePreviewShape,
      });
      if (!completeValidatedAccess(adminAccess, requestAccessEpoch)) return null;
      setScorePreview(payload);
      setScoreStatus("ready");
    } catch (previewError) {
      if (previewError?.kind === "authorization") {
        if (!clearAfterAuthorizationLoss(previewError, requestAccessEpoch)) return null;
      } else {
        if (!isAccessRequestCurrent(adminAccess, requestAccessEpoch)) return null;
        if (isAdminAccessDenied(previewError)) setScorePreview(null);
      }
      setScoreError(
        requestErrorMessage(previewError, "Score preview 計算失敗。"),
      );
      setScoreStatus("error");
    }
  }, [adminAccess, clearAfterAuthorizationLoss, scoreDate]);

  const submitNewsJson = useCallback(async (mode) => {
    const token = getAdminToken();
    if (!token) {
      setNewsError("缺少管理 token。");
      setNewsStatus("error");
      return;
    }

    const requestAccessEpoch = beginAccessRequest(adminAccess);
    setNewsStatus(mode === "save" ? "saving" : "validating");
    setNewsError("");
    try {
      const path = mode === "save"
        ? "/api/dynamic-beta/news"
        : "/api/dynamic-beta/news/validate";
      const response = await fetch(
        `${path}?token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: newsJson,
        },
      );
      const payload = await readAdminJson(response, {
        fallbackMessage: "News Event data 處理失敗",
        validate: (candidate) => hasNewsResultShape(candidate, mode),
      });
      if (!completeValidatedAccess(adminAccess, requestAccessEpoch)) return null;
      setNewsResult(payload);
      setNewsStatus("ready");
    } catch (submitError) {
      if (
        submitError?.kind === "request"
        && submitError.status === 400
        && submitError.payload?.valid === false
        && hasNewsResultShape(submitError.payload, mode)
      ) {
        if (!completeValidatedAccess(adminAccess, requestAccessEpoch)) return null;
        setNewsResult(submitError.payload);
        setNewsStatus("ready");
        return submitError.payload;
      }
      if (submitError?.kind === "authorization") {
        if (!clearAfterAuthorizationLoss(submitError, requestAccessEpoch)) return null;
      } else {
        if (!isAccessRequestCurrent(adminAccess, requestAccessEpoch)) return null;
        if (isAdminAccessDenied(submitError)) setNewsResult(null);
      }
      setNewsError(
        requestErrorMessage(submitError, "News Event data 處理失敗。"),
      );
      setNewsStatus("error");
    }
  }, [adminAccess, clearAfterAuthorizationLoss, newsJson]);

  const resetNewsTemplate = useCallback(() => {
    setNewsJson(JSON.stringify(createMorningBriefTemplate(), null, 2));
    setNewsResult(null);
    setNewsError("");
    setNewsStatus("idle");
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadFlags();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadFlags]);

  return (
    <section className="advancedToolsSection" aria-labelledby="advanced-tools-title">
      <header>
        <h2 id="advanced-tools-title">More · 進階工具</h2>
        <p className="hint">
          內部限定；只供診斷與手動驗證，不影響 Target Beta，也不提供公開功能。
        </p>
      </header>

      <div className="advancedToolsFlags" aria-label="功能狀態">
        <div className="positionTitle">
          <strong>Feature status</strong>
          <button
            type="button"
            className="secondaryButton compact"
            onClick={loadFlags}
            disabled={flagsStatus === "loading"}
          >
            {flagsStatus === "loading" ? "讀取中…" : "更新功能狀態"}
          </button>
        </div>
        {flagsError && <p className="usageWarning">{flagsError}</p>}
        {flagsError && (flags.market || flags.news) && (
          <p className="hint">顯示上次成功讀取的功能狀態。</p>
        )}
        <dl>
          <FeatureFlagStatus label="Dynamic Beta data" value={flags.market?.dataEnabled} />
          <FeatureFlagStatus label="Dynamic Beta scoring" value={flags.market?.scoringEnabled} />
          <FeatureFlagStatus label="Dynamic Beta public" value={flags.market?.publicEnabled} />
          <FeatureFlagStatus label="News data" value={flags.news?.dataEnabled} />
          <FeatureFlagStatus label="News scoring" value={flags.news?.scoringEnabled} />
          <FeatureFlagStatus label="News public" value={flags.news?.publicEnabled} />
        </dl>
      </div>

      <p className="hint">
        歷史資料未完整回補 ALFRED vintage；分數預覽不代表完整 point-in-time 回測。
      </p>

      <details className="advancedToolsDisclosure">
        <summary>Market Risk Score v0 · Offline Preview</summary>
        <div className="advancedToolsDisclosureContent">
          <p className="hint">
            管理員手動驗證，不啟用 scoring、不影響 Target Beta。
          </p>
          <div className="advancedToolsControls">
            <label>
              Preview date
              <input
                type="date"
                value={scoreDate}
                onChange={(event) => setScoreDate(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="secondaryButton compact"
              onClick={runScorePreview}
              disabled={accessDenied || scoreStatus === "loading"}
            >
              {scoreStatus === "loading" ? "計算中…" : "計算 Preview"}
            </button>
          </div>
          <div aria-live="polite">
            {scoreError && <p className="usageWarning">{scoreError}</p>}
            {scoreError && scorePreview && (
              <p className="hint">顯示上次成功計算結果。</p>
            )}
          </div>
          {scorePreview && (
            <div className="advancedToolsScoreResult">
              <p>
                <strong>總分：{scorePreview.score ?? "資料不足"} / 100</strong>
                {" · "}狀態 {scorePreview.status || "資料不足"}
                {" · "}覆蓋率 {formatPercent(scorePreview.coverage)}
                {" · "}<code>{scorePreview.modelVersion || "資料不足"}</code>
              </p>
              <p className="hint">
                歷史品質：{scorePreview.historyQuality || "資料不足"}。不代表完整
                point-in-time 回測。
              </p>
              <div className="analyticsTable advancedToolsScoreTable">
                <div>
                  <strong>分類／訊號</strong>
                  <strong>值</strong>
                  <strong>分數</strong>
                  <strong>權重</strong>
                  <strong>資料日期</strong>
                  <strong>實際來源</strong>
                </div>
                {(scorePreview.categories || []).map((category) => (
                  <div key={category.id}>
                    <span><strong>{category.id}</strong></span>
                    <span>不適用</span>
                    <span>{category.score ?? "資料不足"}</span>
                    <span>{formatPercent(category.weight)}</span>
                    <span>不適用</span>
                    <span>有效 {formatPercent(category.availableWeight)}</span>
                  </div>
                ))}
                {(scorePreview.signals || []).map((signal) => (
                  <div key={signal.id}>
                    <span title={signal.reason || ""}>{signal.name || signal.id}</span>
                    <span>
                      {signal.value === null || signal.value === undefined
                        ? "資料不足"
                        : formatDynamicBetaValue(signal.value)}
                    </span>
                    <span>{signal.score ?? "資料不足"}</span>
                    <span>{formatPercent(signal.weight)}</span>
                    <span>{signal.observationDate || "資料不足"}</span>
                    <span>
                      {(signal.actualSeriesIds || []).filter(Boolean).join(", ")
                        || "資料不足"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </details>
      <details className="advancedToolsDisclosure">
        <summary>News Event JSON · Internal Ingestion</summary>
        <div className="advancedToolsDisclosureContent">
          <div className="positionTitle advancedToolsJsonHeader">
            <p className="hint">
              貼上每天晨報的結構化 JSON；只供內部驗證與寫入，不自動搜尋新聞、
              不計分，也不影響 Dynamic Beta。
            </p>
            <button
              type="button"
              className="secondaryButton compact"
              onClick={resetNewsTemplate}
            >
              重設範本
            </button>
          </div>
          <textarea
            aria-label="Morning brief JSON"
            className="advancedToolsJsonInput"
            value={newsJson}
            onChange={(event) => setNewsJson(event.target.value)}
            spellCheck="false"
          />
          <div className="advancedToolsControls">
            <button
              type="button"
              className="secondaryButton compact"
              onClick={() => submitNewsJson("validate")}
              disabled={accessDenied || newsStatus === "validating" || newsStatus === "saving"}
            >
              {newsStatus === "validating" ? "驗證中…" : "只驗證"}
            </button>
            <button
              type="button"
              className="secondaryButton compact"
              onClick={() => submitNewsJson("save")}
              disabled={accessDenied || newsStatus === "validating" || newsStatus === "saving"}
            >
              {newsStatus === "saving" ? "儲存中…" : "驗證並儲存"}
            </button>
          </div>
          <div aria-live="polite">
            {newsError && <p className="usageWarning">{newsError}</p>}
            {newsError && newsResult && (
              <p className="hint">顯示上次成功的 JSON 處理結果。</p>
            )}
          </div>
          {newsResult && (
            <div className="advancedToolsJsonResult">
              <p>
                <strong>
                  {newsResult.saved
                    ? `已儲存 revision #${newsResult.brief?.revisionNumber ?? "資料不足"}`
                    : newsResult.valid
                      ? "格式驗證通過，尚未寫入"
                      : "格式驗證失敗"}
                </strong>
              </p>
              {(newsResult.errors || []).map((message) => (
                <p className="usageWarning" key={message}>{message}</p>
              ))}
              {(newsResult.warnings || []).map((message) => (
                <p className="hint" key={message}>{message}</p>
              ))}
              {(newsResult.dedupeWarnings || []).map((warning) => (
                <p
                  className="hint"
                  key={`${warning.evidenceId}:${warning.possibleDuplicateOfEvidenceId}`}
                >
                  可能重複：{warning.evidenceId} → {warning.possibleDuplicateOfEvidenceId}
                  {Number.isFinite(Number(warning.similarity))
                    ? ` (${(Number(warning.similarity) * 100).toFixed(0)}%)`
                    : "（相似度資料不足）"}
                </p>
              ))}
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
