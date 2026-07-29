"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { useAdminAccessLifecycle } from "./useAdminAccessLifecycle.js";

import {
  ConfirmationStatusBadge,
  ConfirmationSummary,
} from "../../../src/components/morning-brief/MorningBriefContent.js";
import {
  confirmationAdminReducer,
  createConfirmationPreviewAdminController,
  createConfirmationSnapshotAdminController,
  INITIAL_CONFIRMATION_ADMIN_STATE,
  summarizeConfirmationResult,
} from "../../../src/lib/dynamic-beta/news/confirmation-admin-state.js";
import { isAdminAccessDenied } from "../../../src/lib/dynamic-beta/admin-http.js";
import {
  confirmationLabel,
  formatConfirmationMove,
  formatConfirmationObservation,
  formatRuleExpectation,
  persistenceLabel,
} from "../../../src/lib/dynamic-beta/news/confirmation-view.js";

function getAdminToken() {
  if (typeof window === "undefined") return "";
  return new URL(window.location.href).searchParams.get("token") || "";
}

function taipeiTodayDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
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

function EventConfirmationDetails({ event }) {
  const d1Status = event.d1?.status;
  return (
    <details className="confirmationAdminEvent">
      <summary>
        #{event.rank ?? "?"} {event.headline || "事件標題未提供"} · 市場日：
        {event.marketDate || "市場日期未提供"} · D1 主要確認：
        {confirmationLabel(d1Status)}
        {event.d1?.isFinal ? "（最終）" : "（暫定）"} · D3 持續性：
        {persistenceLabel(event.persistence)}
      </summary>
      <div className="confirmationAdminEventBody">
        <p>
          <ConfirmationStatusBadge status={d1Status} label={confirmationLabel(d1Status)} />
          {" D1 "}{event.d1?.isFinal ? "最終結果" : "暫定結果"}
          {" · D3 "}
          <ConfirmationStatusBadge
            status={event.d3?.status}
            label={confirmationLabel(event.d3?.status)}
          />
          {" · 持續性 "}{persistenceLabel(event.persistence)}
        </p>
        <div className="adminWideTableScroll">
          <table className="analyticsTable confirmationRuleTable">
            <caption>市場確認規則明細</caption>
            <thead>
              <tr>
                <th scope="col">Series</th>
                <th scope="col">預期／門檻</th>
                <th scope="col">Baseline</th>
                <th scope="col">D1 observation</th>
                <th scope="col">D1 status</th>
                <th scope="col">D1 move</th>
                <th scope="col">D1 reason</th>
                <th scope="col">D3 observation</th>
                <th scope="col">D3 status</th>
                <th scope="col">D3 move</th>
                <th scope="col">D3 reason</th>
              </tr>
            </thead>
            <tbody>
              {(event.rules || []).map((rule, index) => (
                <tr key={`${rule.seriesId || "rule"}:${index}`}>
                  <th scope="row"><code>{rule.seriesId || "序列未提供"}</code></th>
                  <td>{formatRuleExpectation(rule)}</td>
                  <td>{formatConfirmationObservation(rule.baseline)}</td>
                  <td>{formatConfirmationObservation(rule.d1?.observation)}</td>
                  <td>{confirmationLabel(rule.d1?.status)}</td>
                  <td>{formatConfirmationMove(rule.d1?.rawMove, rule.changeType)}</td>
                  <td>{rule.d1?.reason || "原因未提供"}</td>
                  <td>{formatConfirmationObservation(rule.d3?.observation)}</td>
                  <td>{confirmationLabel(rule.d3?.status)}</td>
                  <td>{formatConfirmationMove(rule.d3?.rawMove, rule.changeType)}</td>
                  <td>{rule.d3?.reason || "原因未提供"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

function ConfirmationLoadError({ state, retryLabel, onRetry }) {
  if (!state.error) return null;
  return (
    <div className="usageWarning" role="alert">
      <p>{state.error}</p>
      {state.stale && <p>顯示上次成功讀取結果。</p>}
      <button
        type="button"
        className="secondaryButton compact"
        onClick={() => { void onRetry().catch(() => {}); }}
        disabled={state.status === "loading"}
      >
        {retryLabel}
      </button>
    </div>
  );
}

function ConfirmationResult({ result, label, saved = false }) {
  const aggregateSummary = summarizeConfirmationResult(result);
  return (
    <section className="confirmationAdminResult" aria-label={label}>
      <h3>{label}</h3>
      <p>
        <strong>
          {result.briefDate} · Revision #{result.revisionNumber ?? "版本號未提供"}
        </strong>{" "}
        · As of {result.asOf}
      </p>
      {saved && (
        <>
          <p>{`Snapshot revision #${result.snapshotRevisionNumber} · ${
            result.completion.complete ? "追蹤完成" : "追蹤中"
          }`}</p>
          <p className="hint">
            建立時間 {result.createdAt} · 評估時間 {result.evaluatedAt || "未提供"}
          </p>
          {!result.completion.complete && result.completion.pendingReasons.length > 0 && (
            <details>
              <summary>待完成原因 {result.completion.pendingReasons.length} 項</summary>
              <ul>
                {result.completion.pendingReasons.map((reason, index) => (
                  <li key={`${reason.eventRank ?? "event"}:${reason.seriesId ?? "series"}:${index}`}>
                    事件 #{reason.eventRank ?? "?"} · {reason.seriesId || "Series 未提供"}
                    {" · "}{reason.reason || "原因未提供"}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      <p className="hint">
        資料採各 observation date 最新儲存 revision，並非完整 point-in-time vintage。
      </p>
      <ConfirmationSummary summary={aggregateSummary} headingLevel={4} />
      <div className="confirmationAdminEvents">
        {(result.events || []).map((event, index) => (
          <EventConfirmationDetails
            key={`${event.rank ?? index}:${event.headline || "event"}`}
            event={event}
          />
        ))}
      </div>
    </section>
  );
}

export default function ConfirmationAdminSection({
  adminAccess = null,
  onAuthorizationLoss = null,
}) {
  const [snapshotState, dispatchSnapshot] = useReducer(
    confirmationAdminReducer,
    INITIAL_CONFIRMATION_ADMIN_STATE,
  );
  const [previewState, dispatchPreview] = useReducer(
    confirmationAdminReducer,
    INITIAL_CONFIRMATION_ADMIN_STATE,
  );
  const [briefDate, setBriefDate] = useState("");
  const [revisionId, setRevisionId] = useState("");
  const [asOf, setAsOf] = useState("");
  const snapshotController = useMemo(() => createConfirmationSnapshotAdminController({
    fetchImpl: (...args) => fetch(...args),
  }), []);
  const previewController = useMemo(() => createConfirmationPreviewAdminController({
    fetchImpl: (...args) => fetch(...args),
  }), []);

  useAdminAccessLifecycle(adminAccess, {
    onAccessDenied(snapshot) {
      const failure = {
        type: "load-failed",
        error: snapshot.error || "管理權限已失效。",
        accessDenied: true,
      };
      dispatchSnapshot(failure);
      dispatchPreview(failure);
    },
  });

  const handleLoadError = useCallback(({
    error,
    requestAccessEpoch,
    dispatch,
    fallbackMessage,
  }) => {
    if (error?.kind === "authorization") {
      const accepted = reportAuthorizationLoss({
        adminAccess,
        onAuthorizationLoss,
        error,
        requestAccessEpoch,
      });
      if (!accepted) return false;
    } else if (!isAccessRequestCurrent(adminAccess, requestAccessEpoch)) {
      return false;
    }
    const accessDenied = isAdminAccessDenied(error);
    const failure = {
      type: "load-failed",
      error: error instanceof Error ? error.message : fallbackMessage,
      accessDenied,
    };
    if (accessDenied) {
      dispatchSnapshot(failure);
      dispatchPreview(failure);
    } else {
      dispatch(failure);
    }
    return true;
  }, [adminAccess, onAuthorizationLoss]);

  const loadSavedSnapshot = useCallback(async () => {
    const requestAccessEpoch = beginAccessRequest(adminAccess);
    dispatchSnapshot({ type: "load-started" });
    try {
      const result = await snapshotController.load({
        token: getAdminToken(),
        briefDate,
        revisionId,
        asOf,
      });
      if (!completeValidatedAccess(adminAccess, requestAccessEpoch)) return null;
      dispatchSnapshot({ type: "load-succeeded", result });
      return result;
    } catch (loadError) {
      handleLoadError({
        error: loadError,
        requestAccessEpoch,
        dispatch: dispatchSnapshot,
        fallbackMessage: "Confirmation snapshot 讀取失敗。",
      });
      throw loadError;
    }
  }, [adminAccess, asOf, briefDate, handleLoadError, revisionId, snapshotController]);

  const loadPreview = useCallback(async () => {
    const requestAccessEpoch = beginAccessRequest(adminAccess);
    dispatchPreview({ type: "load-started" });
    const previewAsOf = asOf || taipeiTodayDateKey();
    if (!asOf) setAsOf(previewAsOf);
    try {
      const result = await previewController.load({
        token: getAdminToken(),
        briefDate,
        revisionId,
        asOf: previewAsOf,
      });
      if (!completeValidatedAccess(adminAccess, requestAccessEpoch)) return null;
      dispatchPreview({ type: "load-succeeded", result });
      return result;
    } catch (loadError) {
      handleLoadError({
        error: loadError,
        requestAccessEpoch,
        dispatch: dispatchPreview,
        fallbackMessage: "Confirmation Preview 讀取失敗。",
      });
      throw loadError;
    }
  }, [adminAccess, asOf, briefDate, handleLoadError, previewController, revisionId]);

  const initialLoad = useRef(loadSavedSnapshot);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      void initialLoad.current().catch(() => {});
    }, 0);
    return () => window.clearTimeout(loadTimer);
  }, []);

  return (
    <section className="confirmationAdminSection" aria-labelledby="confirmation-admin-title">
      <header className="positionTitle">
        <div>
          <h2 id="confirmation-admin-title">News Market Confirmation</h2>
          <p className="hint">
            預設顯示每日 07:00 保存結果；即時 Preview 只供人工檢查且不會保存。
          </p>
        </div>
        <div className="todayWorkspaceHeaderActions">
          <button
            type="button"
            className="secondaryButton compact"
            onClick={() => { void loadSavedSnapshot().catch(() => {}); }}
            disabled={snapshotState.status === "loading"}
          >
            {snapshotState.status === "loading" ? "讀取中…" : "讀取已保存快照"}
          </button>
          <button
            type="button"
            className="secondaryButton compact"
            onClick={() => { void loadPreview().catch(() => {}); }}
            disabled={previewState.status === "loading"}
          >
            {previewState.status === "loading" ? "計算中…" : "計算即時 Preview"}
          </button>
        </div>
      </header>

      <div className="confirmationAdminFilters">
        <label>
          Brief date
          <input
            type="date"
            value={briefDate}
            onChange={(event) => setBriefDate(event.target.value)}
          />
        </label>
        <label>
          Revision ID
          <input
            type="text"
            value={revisionId}
            onChange={(event) => setRevisionId(event.target.value)}
            placeholder="選填"
          />
        </label>
        <label>
          As of
          <input
            type="date"
            value={asOf}
            onChange={(event) => setAsOf(event.target.value)}
          />
        </label>
      </div>

      <ConfirmationLoadError
        state={snapshotState}
        retryLabel="重試已保存快照"
        onRetry={loadSavedSnapshot}
      />
      {snapshotState.result && (
        <ConfirmationResult
          result={snapshotState.result}
          label="07:00 已保存快照"
          saved
        />
      )}

      <ConfirmationLoadError
        state={previewState}
        retryLabel="重試 Preview"
        onRetry={loadPreview}
      />
      {previewState.result && (
        <ConfirmationResult
          result={previewState.result}
          label="即時 Preview（不會保存）"
        />
      )}
    </section>
  );
}
