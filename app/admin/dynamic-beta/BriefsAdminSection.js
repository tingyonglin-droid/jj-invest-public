"use client";

import { useCallback, useEffect, useMemo, useReducer } from "react";

import DailyMorningBriefDraftPanel from "./DailyMorningBriefDraftPanel.js";
import { useAdminAccessLifecycle } from "./useAdminAccessLifecycle.js";
import MorningBriefContent from "../../../src/components/morning-brief/MorningBriefContent.js";
import { buildPublishedBriefPresentation } from "../../../src/lib/dynamic-beta/news/brief-presentation.js";
import {
  briefsAdminReducer,
  createBriefsAdminController,
  getSelectedPublishedBrief,
  INITIAL_BRIEFS_ADMIN_STATE,
} from "../../../src/lib/dynamic-beta/news/briefs-admin-state.js";
import { isAdminAccessDenied } from "../../../src/lib/dynamic-beta/admin-http.js";

function getAdminToken() {
  if (typeof window === "undefined") return "";
  return new URL(window.location.href).searchParams.get("token") || "";
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

export default function BriefsAdminSection({
  draftController = null,
  adminAccess = draftController,
  onAuthorizationLoss = null,
}) {
  const [state, dispatch] = useReducer(briefsAdminReducer, INITIAL_BRIEFS_ADMIN_STATE);
  const controller = useMemo(() => createBriefsAdminController({
    fetchImpl: (...args) => fetch(...args),
  }), []);
  const selectedBrief = getSelectedPublishedBrief(state);
  const presentation = useMemo(
    () => buildPublishedBriefPresentation(selectedBrief),
    [selectedBrief],
  );

  useAdminAccessLifecycle(adminAccess, {
    onAccessDenied(snapshot) {
      dispatch({
        type: "load-failed",
        error: snapshot.error || "管理權限已失效。",
        accessDenied: true,
      });
    },
  });

  const loadPublished = useCallback(async () => {
    const requestAccessEpoch = beginAccessRequest(adminAccess);
    dispatch({ type: "load-started" });
    try {
      const payload = await controller.loadPublished({ token: getAdminToken() });
      if (!completeValidatedAccess(adminAccess, requestAccessEpoch)) return null;
      dispatch({ type: "load-succeeded", briefs: payload.briefs });
      return payload;
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
        error: loadError instanceof Error ? loadError.message : "已發布晨報讀取失敗。",
        accessDenied: isAdminAccessDenied(loadError),
      });
      throw loadError;
    }
  }, [adminAccess, controller, onAuthorizationLoss]);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      void loadPublished().catch(() => {});
    }, 0);
    return () => window.clearTimeout(loadTimer);
  }, [loadPublished]);

  return (
    <section className="briefsAdminSection" aria-labelledby="briefs-admin-title">
      <header>
        <h2 id="briefs-admin-title">晨報版本</h2>
        <p className="hint">草稿與已發布晨報使用不同 revision identity，所有操作都鎖定精確版本。</p>
      </header>

      <section className="briefsAdminView" aria-label="Draft revisions">
        <h3>草稿版本 · Draft revisions</h3>
        <DailyMorningBriefDraftPanel compact={false} controller={draftController} />
      </section>

      <section className="briefsAdminView" aria-label="Published revisions">
        <div className="positionTitle">
          <div>
            <h3>已發布版本 · Published revisions</h3>
            <p className="hint">此區為唯讀，選擇值只使用 Published brief revision ID。</p>
          </div>
          <button
            type="button"
            className="secondaryButton compact"
            onClick={() => { void loadPublished().catch(() => {}); }}
            disabled={state.status === "loading"}
          >
            {state.status === "loading" ? "讀取中…" : "更新已發布晨報"}
          </button>
        </div>

        {state.error && (
          <div className="usageWarning" role="alert">
            <p>{state.error}</p>
            {state.stale && <p>顯示上次成功讀取結果。</p>}
            <button
              type="button"
              className="secondaryButton compact"
              onClick={() => { void loadPublished().catch(() => {}); }}
              disabled={state.status === "loading"}
            >
              重試讀取
            </button>
          </div>
        )}

        {state.publishedBriefs.length > 0 && (
          <label className="briefsAdminSelector">
            已發布日期／revision
            <select
              value={state.selectedPublishedRevisionId}
              onChange={(event) => dispatch({
                type: "select-published",
                revisionId: event.target.value,
              })}
            >
              {state.publishedBriefs.map((brief) => (
                <option key={brief.revisionId} value={brief.revisionId}>
                  {brief.briefDate} · #{brief.revisionNumber ?? "版本號未提供"} · {brief.revisionId}
                </option>
              ))}
            </select>
          </label>
        )}

        {!state.publishedBriefs.length && state.status !== "loading" && !state.error && (
          <p className="hint">目前沒有已發布晨報。</p>
        )}

        {presentation && (
          <article className="briefsAdminPublishedPreview">
            <p className="hint">
              Published brief revision ID: <code>{presentation.identity.revisionId}</code>
            </p>
            <MorningBriefContent brief={presentation} headingLevel={4} />
          </article>
        )}
      </section>
    </section>
  );
}
