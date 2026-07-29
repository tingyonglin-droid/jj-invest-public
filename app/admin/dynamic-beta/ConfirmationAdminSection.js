"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { useAdminAccessLifecycle } from "./useAdminAccessLifecycle.js";

import {
  ConfirmationStatusBadge,
  ConfirmationSummary,
} from "../../../src/components/morning-brief/MorningBriefContent.js";
import {
  confirmationAdminReducer,
  createConfirmationAdminController,
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

function todayDateKey() {
  return new Date().toISOString().slice(0, 10);
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

export default function ConfirmationAdminSection({
  adminAccess = null,
  onAuthorizationLoss = null,
}) {
  const [state, dispatch] = useReducer(
    confirmationAdminReducer,
    INITIAL_CONFIRMATION_ADMIN_STATE,
  );
  const [briefDate, setBriefDate] = useState("");
  const [revisionId, setRevisionId] = useState("");
  const [asOf, setAsOf] = useState(todayDateKey);
  const controller = useMemo(() => createConfirmationAdminController({
    fetchImpl: (...args) => fetch(...args),
  }), []);

  useAdminAccessLifecycle(adminAccess, {
    onAccessDenied(snapshot) {
      dispatch({
        type: "load-failed",
        error: snapshot.error || "管理權限已失效。",
        accessDenied: true,
      });
    },
  });

  const loadConfirmations = useCallback(async () => {
    const requestAccessEpoch = beginAccessRequest(adminAccess);
    dispatch({ type: "load-started" });
    try {
      const result = await controller.load({
        token: getAdminToken(),
        briefDate,
        revisionId,
        asOf,
      });
      if (!completeValidatedAccess(adminAccess, requestAccessEpoch)) return null;
      dispatch({ type: "load-succeeded", result });
      return result;
    } catch (loadError) {
      if (loadError?.kind === "authorization") {
        const accepted = reportAuthorizationLoss({
          adminAccess,
          onAuthorizationLoss,
          error: loadError,
          requestAccessEpoch,
        });
        if (!accepted) return null;
      } else if (!isAccessRequestCurrent(adminAccess, requestAccessEpoch)) {
        return null;
      }
      dispatch({
        type: "load-failed",
        error: loadError instanceof Error
          ? loadError.message
          : "Confirmation data 讀取失敗。",
        accessDenied: isAdminAccessDenied(loadError),
      });
      throw loadError;
    }
  }, [adminAccess, asOf, briefDate, controller, onAuthorizationLoss, revisionId]);
  const initialLoad = useRef(loadConfirmations);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      void initialLoad.current().catch(() => {});
    }, 0);
    return () => window.clearTimeout(loadTimer);
  }, []);

  const aggregateSummary = useMemo(
    () => summarizeConfirmationResult(state.result),
    [state.result],
  );

  return (
    <section className="confirmationAdminSection" aria-labelledby="confirmation-admin-title">
      <header className="positionTitle">
        <div>
          <h2 id="confirmation-admin-title">News Market Confirmation</h2>
          <p className="hint">
            手動讀取市場確認結果；Brief date 留空時使用最新已發布晨報。
          </p>
        </div>
        <button
          type="button"
          className="secondaryButton compact"
          onClick={() => { void loadConfirmations().catch(() => {}); }}
          disabled={state.status === "loading"}
        >
          {state.status === "loading" ? "讀取中…" : "讀取確認結果"}
        </button>
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

      {state.error && (
        <div className="usageWarning" role="alert">
          <p>{state.error}</p>
          {state.stale && <p>顯示上次成功讀取結果。</p>}
          <button
            type="button"
            className="secondaryButton compact"
            onClick={() => { void loadConfirmations().catch(() => {}); }}
            disabled={state.status === "loading"}
          >
            重試讀取
          </button>
        </div>
      )}

      {state.result && (
        <section className="confirmationAdminResult" aria-label="確認結果">
          <p>
            <strong>
              {state.result.briefDate} · Revision #{state.result.revisionNumber ?? "版本號未提供"}
            </strong>{" "}
            · As of {state.result.asOf}
          </p>
          <p className="hint">
            市場資料採各 observation date 最新儲存 revision，並非完整 point-in-time vintage。
          </p>
          <ConfirmationSummary summary={aggregateSummary} headingLevel={3} />
          <div className="confirmationAdminEvents">
            {(state.result.events || []).map((event, index) => (
              <EventConfirmationDetails
                key={`${event.rank ?? index}:${event.headline || "event"}`}
                event={event}
              />
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
