"use client";

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";

import DailyMorningBriefDraftPanel from "./DailyMorningBriefDraftPanel.js";
import { useAdminAccessLifecycle } from "./useAdminAccessLifecycle.js";
import MorningBriefContent, {
  ConfirmationSummary,
} from "../../../src/components/morning-brief/MorningBriefContent.js";
import {
  formatDynamicBetaValue,
  getDynamicBetaFreshnessLabel,
} from "../../../src/lib/dynamic-beta/admin-view.js";
import { buildTodayWorkspaceModel } from "../../../src/lib/dynamic-beta/today-workspace.js";
import { confirmationSnapshotQuery } from "../../../src/lib/dynamic-beta/news/confirmation-admin-state.js";
import {
  AdminResponseError,
  isAdminAccessDenied,
  readAdminJson,
} from "../../../src/lib/dynamic-beta/admin-http.js";

const INITIAL_RESOURCES = Object.freeze({
  briefs: { value: [], status: "loading", error: "", hasLoaded: false },
  confirmation: { value: null, status: "loading", error: "", hasLoaded: false },
  market: { value: [], status: "loading", error: "", hasLoaded: false },
});

const TRACKING_STAGE_LABELS = Object.freeze({
  d1_tracking: "D1 追蹤中",
  d3_tracking: "D3 追蹤中",
  complete: "D1／D3 追蹤完成",
  no_events: "沒有可追蹤事件",
  unavailable: "確認結果尚未提供",
});

function resourcesReducer(state, event) {
  if (event.type === "access-invalidated") {
    const allResources = !event.block;
    return {
      briefs: {
        value: [],
        status: allResources || event.block === "briefs" ? "error" : "idle",
        error: allResources || event.block === "briefs" ? event.error : "",
        hasLoaded: false,
      },
      confirmation: {
        value: null,
        status: allResources || event.block === "confirmation" ? "error" : "idle",
        error: allResources || event.block === "confirmation" ? event.error : "",
        hasLoaded: false,
      },
      market: {
        value: [],
        status: allResources || event.block === "market" ? "error" : "idle",
        error: allResources || event.block === "market" ? event.error : "",
        hasLoaded: false,
      },
    };
  }
  const resource = state[event.block];
  if (!resource) return state;
  if (event.type === "load-started") {
    return {
      ...state,
      [event.block]: { ...resource, status: "loading", error: "" },
    };
  }
  if (event.type === "load-succeeded") {
    return {
      ...state,
      [event.block]: {
        value: event.value,
        status: "ready",
        error: "",
        hasLoaded: true,
      },
    };
  }
  if (event.type === "load-failed") {
    return {
      ...state,
      [event.block]: event.accessDenied
        ? {
          value: event.block === "confirmation" ? null : [],
          status: "error",
          error: event.error,
          hasLoaded: false,
        }
        : { ...resource, status: "error", error: event.error },
    };
  }
  return state;
}

function getAdminToken() {
  if (typeof window === "undefined") return "";
  return new URL(window.location.href).searchParams.get("token") || "";
}

function validTodayPayload(block, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  if (block === "briefs") return Array.isArray(payload.briefs);
  if (block === "market") return Array.isArray(payload.series);
  return typeof payload.snapshotId === "string"
    && payload.snapshotId.length > 0
    && Number.isInteger(payload.snapshotRevisionNumber)
    && payload.snapshotRevisionNumber > 0
    && typeof payload.briefDate === "string"
    && typeof payload.revisionId === "string"
    && typeof payload.asOf === "string"
    && typeof payload.completion?.complete === "boolean"
    && Array.isArray(payload.completion?.pendingReasons)
    && payload.metadata?.vintageMode === "latest_stored_revision_by_observation_date"
    && payload.metadata?.truePointInTime === false
    && Array.isArray(payload.events);
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

function ResourceError({ resource, retryLabel, onRetry }) {
  if (!resource.error) return null;
  return (
    <div className="usageWarning todayWorkspaceError" role="alert">
      <p>{resource.error}</p>
      {resource.hasLoaded && resource.value && (
        Array.isArray(resource.value) ? resource.value.length > 0 : true
      ) && <p>顯示上次成功讀取結果。</p>}
      <button
        type="button"
        className="secondaryButton compact"
        onClick={() => { void onRetry().catch(() => {}); }}
        disabled={resource.status === "loading"}
      >
        {retryLabel}
      </button>
    </div>
  );
}

function MarketAlert({ item }) {
  return (
    <article className="todayWorkspaceAlertCard">
      <div>
        <strong>{item.name || item.seriesId || "市場序列名稱未提供"}</strong>
        <p><code>{item.seriesId || "Series ID 未提供"}</code></p>
      </div>
      <p>
        <strong>{getDynamicBetaFreshnessLabel(item.freshnessStatus)}</strong>
        {" · "}{item.freshnessReason || "異常原因未提供"}
      </p>
      <p className="hint">
        最新值 {formatDynamicBetaValue(item.latestValue)}
        {item.unit ? ` ${item.unit}` : ""}
        {" · Observation "}{item.observationDate || "沒有資料"}
      </p>
    </article>
  );
}

export default function TodayWorkspaceSection({
  onOpenSection,
  draftController = null,
  adminAccess = null,
  onAuthorizationLoss = null,
}) {
  const [resources, dispatch] = useReducer(resourcesReducer, INITIAL_RESOURCES);
  const [draftSnapshot, setDraftSnapshot] = useState({
    drafts: [],
    selectedDraft: null,
    status: "idle",
    error: "",
  });

  useAdminAccessLifecycle(adminAccess, {
    onAccessDenied(snapshot) {
      dispatch({
        type: "access-invalidated",
        error: snapshot.error || "管理權限已失效。",
      });
    },
  });

  const loadBlock = useCallback(async (block) => {
    const requestAccessEpoch = beginAccessRequest(adminAccess);
    dispatch({ type: "load-started", block });
    try {
      const token = getAdminToken();
      if (!token) {
        throw new AdminResponseError("缺少管理 token。", { kind: "authorization" });
      }
      let url;
      let fallbackMessage;
      if (block === "briefs") {
        url = `/api/dynamic-beta/news?token=${encodeURIComponent(token)}`;
        fallbackMessage = "已發布晨報讀取失敗。";
      } else if (block === "market") {
        url = `/api/dynamic-beta/admin?token=${encodeURIComponent(token)}`;
        fallbackMessage = "市場資料讀取失敗。";
      } else {
        url = confirmationSnapshotQuery({ token });
        fallbackMessage = "已保存市場確認讀取失敗。";
      }
      const response = await fetch(url, { cache: "no-store" });
      const payload = await readAdminJson(response, {
        fallbackMessage,
        validate: (value) => validTodayPayload(block, value),
      });
      if (!completeValidatedAccess(adminAccess, requestAccessEpoch)) return null;
      const value = block === "briefs"
        ? payload.briefs
        : block === "market"
          ? payload.series
          : payload;
      dispatch({ type: "load-succeeded", block, value });
      return value;
    } catch (error) {
      const authorizationLoss = error?.kind === "authorization";
      if (authorizationLoss) {
        const accepted = reportAuthorizationLoss({
          adminAccess,
          onAuthorizationLoss,
          error,
          requestAccessEpoch,
        });
        if (!accepted) return null;
        dispatch({
          type: "access-invalidated",
          block,
          error: error instanceof Error ? error.message : "資料讀取失敗。",
        });
        throw error;
      }
      if (!isAccessRequestCurrent(adminAccess, requestAccessEpoch)) return null;
      dispatch({
        type: "load-failed",
        block,
        error: error instanceof Error ? error.message : "資料讀取失敗。",
        accessDenied: isAdminAccessDenied(error),
      });
      throw error;
    }
  }, [adminAccess, onAuthorizationLoss]);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      void Promise.allSettled([
        loadBlock("briefs"),
        loadBlock("confirmation"),
        loadBlock("market"),
      ]);
    }, 0);
    return () => window.clearTimeout(loadTimer);
  }, [loadBlock]);

  const model = useMemo(() => buildTodayWorkspaceModel({
    drafts: draftSnapshot.drafts,
    briefs: resources.briefs.value,
    confirmationResult: resources.confirmation.value,
    series: resources.market.value,
  }), [draftSnapshot.drafts, resources]);

  const openSection = useCallback((sectionId) => {
    if (typeof onOpenSection === "function") onOpenSection(sectionId);
  }, [onOpenSection]);

  const draftReadFinished = draftSnapshot.status !== "idle"
    && draftSnapshot.status !== "loading";
  const showPublishedFallback = draftReadFinished
    && !draftSnapshot.drafts.length
    && resources.briefs.hasLoaded
    && model.brief?.identity;

  return (
    <section className="todayWorkspaceSection" aria-labelledby="today-workspace-title">
      <header>
        <h2 id="today-workspace-title">Today · 每日工作台</h2>
        <p className="todayWorkspaceNotice" role="note">
          內部功能；Scoring 與公開功能仍關閉
        </p>
      </header>

      <section
        className="todayWorkspaceBlock"
        aria-labelledby="today-brief-title"
        aria-busy={resources.briefs.status === "loading"}
      >
        <div className="positionTitle">
          <div>
            <h3 id="today-brief-title">今日晨報</h3>
            <p className="hint">草稿 lifecycle 與精確 revision 由審核面板統一管理。</p>
          </div>
          <div className="todayWorkspaceHeaderActions">
            <button
              type="button"
              className="secondaryButton compact"
              onClick={() => { void loadBlock("briefs").catch(() => {}); }}
              disabled={resources.briefs.status === "loading"}
            >
              {resources.briefs.status === "loading"
                ? "已發布晨報讀取中…"
                : "更新已發布晨報"}
            </button>
            <button
              type="button"
              className="secondaryButton compact"
              onClick={() => openSection("briefs")}
            >
              查看完整晨報
            </button>
          </div>
        </div>
        {resources.briefs.status === "loading" && (
          <p className="hint" role="status" aria-live="polite">已發布晨報讀取中…</p>
        )}
        <DailyMorningBriefDraftPanel
          compact
          controller={draftController}
          onSnapshot={setDraftSnapshot}
        />
        <ResourceError
          resource={resources.briefs}
          retryLabel="重試已發布晨報"
          onRetry={() => loadBlock("briefs")}
        />
        {showPublishedFallback && (
          <div className="todayWorkspacePublishedFallback">
            <p className="hint">沒有可用草稿，顯示最新已發布晨報。</p>
            <MorningBriefContent
              brief={{ ...model.brief, events: (model.brief.events || []).slice(0, 5) }}
              compact
              headingLevel={4}
            />
          </div>
        )}
        {draftReadFinished
          && !draftSnapshot.drafts.length
          && resources.briefs.hasLoaded
          && !model.brief?.identity
          && !resources.briefs.error
          && <p className="hint">目前沒有草稿或已發布晨報。</p>}
      </section>

      <section
        className="todayWorkspaceBlock"
        aria-labelledby="today-confirmation-title"
        aria-busy={resources.confirmation.status === "loading"}
      >
        <div className="positionTitle">
          <div>
            <h3 id="today-confirmation-title">D1／D3 市場確認</h3>
            {resources.confirmation.hasLoaded && (
              <p className="hint">
                目前階段：{TRACKING_STAGE_LABELS[model.confirmation.stage]}
              </p>
            )}
          </div>
          <div className="todayWorkspaceHeaderActions">
            <button
              type="button"
              className="secondaryButton compact"
              onClick={() => { void loadBlock("confirmation").catch(() => {}); }}
              disabled={resources.confirmation.status === "loading"}
            >
              {resources.confirmation.status === "loading"
                ? "已保存快照讀取中…"
                : "更新已保存快照"}
            </button>
            <button
              type="button"
              className="secondaryButton compact"
              onClick={() => openSection("confirmations")}
            >
              查看確認詳情
            </button>
          </div>
        </div>
        <ResourceError
          resource={resources.confirmation}
          retryLabel="重試市場確認"
          onRetry={() => loadBlock("confirmation")}
        />
        {resources.confirmation.status === "loading" && (
          <p className="hint" role="status" aria-live="polite">已保存快照讀取中…</p>
        )}
        {resources.confirmation.value
          ? <ConfirmationSummary summary={model.confirmation} headingLevel={4} />
          : resources.confirmation.hasLoaded
            && !resources.confirmation.error
            && resources.confirmation.status !== "loading"
            && <p className="hint">目前沒有已保存的 D1／D3 快照。</p>}
      </section>

      <section
        className="todayWorkspaceBlock"
        aria-labelledby="today-market-title"
        aria-busy={resources.market.status === "loading"}
      >
        <div className="positionTitle">
          <div>
            <h3 id="today-market-title">異常市場資料</h3>
            <p className="hint">只顯示延遲、過期、無資料或同步失敗的 series。</p>
          </div>
          <div className="todayWorkspaceHeaderActions">
            <button
              type="button"
              className="secondaryButton compact"
              onClick={() => { void loadBlock("market").catch(() => {}); }}
              disabled={resources.market.status === "loading"}
            >
              {resources.market.status === "loading"
                ? "市場資料讀取中…"
                : "更新市場資料"}
            </button>
            <button
              type="button"
              className="secondaryButton compact"
              onClick={() => openSection("data")}
            >
              查看全部資料
            </button>
          </div>
        </div>
        <ResourceError
          resource={resources.market}
          retryLabel="重試市場資料"
          onRetry={() => loadBlock("market")}
        />
        {resources.market.status === "loading" && (
          <p className="hint" role="status" aria-live="polite">市場資料讀取中…</p>
        )}
        {model.market.alerts.length > 0 ? (
          <div className="todayWorkspaceAlerts" aria-label="今日異常市場資料">
            {model.market.alerts.map((item) => (
              <MarketAlert key={item.seriesId} item={item} />
            ))}
          </div>
        ) : resources.market.hasLoaded
          && !resources.market.error
          && resources.market.status !== "loading" ? (
          <p className="hint">
            {model.market.emptyState || model.market.alertEmptyState}
          </p>
        ) : null}
      </section>
    </section>
  );
}
