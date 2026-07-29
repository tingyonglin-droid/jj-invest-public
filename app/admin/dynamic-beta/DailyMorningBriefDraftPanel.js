"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useSyncExternalStore,
} from "react";

import { useAdminAccessLifecycle } from "./useAdminAccessLifecycle.js";
import {
  buildDraftPreview,
  createDraftPanelController,
  draftActionState,
  draftPanelReducer,
  INITIAL_DRAFT_PANEL_STATE,
} from "../../../src/lib/dynamic-beta/news/draft-panel-controller.js";

import { draftStatusLabel } from "../../../src/lib/dynamic-beta/news/draft-view.js";
import MorningBriefContent from "../../../src/components/morning-brief/MorningBriefContent.js";
import { isAdminAccessDenied } from "../../../src/lib/dynamic-beta/admin-http.js";

function getAdminToken() {
  if (typeof window === "undefined") return "";
  return new URL(window.location.href).searchParams.get("token") || "";
}

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
}

function approvalTimeText(preview) {
  if (preview.timestamps.approvedAt) return formatTime(preview.timestamps.approvedAt);
  if (preview.identity.status === "approved") return "核准時間未提供";
  if (preview.identity.status === "pending" || preview.identity.status === "rejected") {
    return "尚未核准";
  }
  return "核准狀態未知";
}

function rejectionTimeText(preview) {
  if (preview.timestamps.rejectedAt) return formatTime(preview.timestamps.rejectedAt);
  if (preview.identity.status === "rejected") return "拒絕時間未提供";
  if (preview.identity.status === "pending" || preview.identity.status === "approved") {
    return "未遭拒絕";
  }
  return "拒絕狀態未知";
}

function rejectionReasonText(preview) {
  if (preview.identity.status === "rejected") {
    return preview.rejectionReason || "未提供駁回原因";
  }
  if (preview.identity.status === "pending" || preview.identity.status === "approved") {
    return "不適用";
  }
  return "拒絕狀態未知";
}

function warningText(warning) {
  if (typeof warning === "string") return warning;
  if (!warning || typeof warning !== "object") return "—";
  const source = warning.evidenceId || "來源未標示";
  const duplicate = warning.possibleDuplicateOfEvidenceId || "可能重複來源未標示";
  const similarity = Number.isFinite(warning.similarity)
    ? ` (${(warning.similarity * 100).toFixed(0)}%)`
    : "";
  return `${source} → ${duplicate}${similarity}`;
}

function List({ items, empty = "—", renderItem = (item) => item }) {
  if (!items?.length) return <span>{empty}</span>;
  return (
    <ul>
      {items.map((item, index) => (
        <li key={`${String(item)}:${index}`}>{renderItem(item, index)}</li>
      ))}
    </ul>
  );
}

export default function DailyMorningBriefDraftPanel({
  compact = false,
  controller: suppliedController = null,
  onSnapshot = null,
}) {
  const [state, dispatch] = useReducer(draftPanelReducer, INITIAL_DRAFT_PANEL_STATE);
  const { drafts, selectedRevisionId, status, error } = state;
  const localController = useMemo(() => createDraftPanelController({
    fetchImpl: (...args) => fetch(...args),
    confirmImpl: (...args) => window.confirm(...args),
    promptImpl: (...args) => window.prompt(...args),
  }), []);
  const controller = suppliedController || localController;
  useAdminAccessLifecycle(controller, {
    onAccessDenied(snapshot) {
      dispatch({
        type: "lifecycle-failed",
        error: snapshot.error || "管理權限已失效。",
        accessDenied: true,
      });
    },
  });
  const lifecycleSnapshot = useSyncExternalStore(
    controller.subscribeLifecycle,
    controller.getLifecycleSnapshot,
    controller.getLifecycleSnapshot,
  );
  const visibleDrafts = useMemo(
    () => controller.applyDraftOverlays(drafts, lifecycleSnapshot),
    [controller, drafts, lifecycleSnapshot],
  );

  const selected = useMemo(
    () => visibleDrafts.find((draft) => draft.draftRevisionId === selectedRevisionId) || null,
    [selectedRevisionId, visibleDrafts],
  );
  const lifecycleActive = lifecycleSnapshot.phase !== "idle";
  const lifecycleReconciliationActive = lifecycleSnapshot.phase === "active"
    || lifecycleSnapshot.phase === "reconciling";
  const actions = draftActionState(selected, lifecycleActive);
  const preview = useMemo(() => buildDraftPreview(selected), [selected]);
  const compactContent = useMemo(() => (
    preview?.content
      ? { ...preview.content, events: (preview.content.events || []).slice(0, 5) }
      : null
  ), [preview]);

  const loadDrafts = useCallback(async () => {
    const token = getAdminToken();
    const requestAccessEpoch = controller.beginAccessRequest?.();
    dispatch({ type: "load-started" });
    try {
      const payload = await controller.load({ token });
      if (controller.isAccessRequestCurrent?.(requestAccessEpoch) === false) return null;
      dispatch({ type: "load-succeeded", drafts: payload.drafts });
      return payload;
    } catch (loadError) {
      if (controller.isAccessRequestCurrent?.(requestAccessEpoch) === false) return null;
      dispatch({
        type: "load-failed",
        error: loadError instanceof Error ? loadError.message : "晨報草稿讀取失敗。",
        accessDenied: isAdminAccessDenied(loadError) || !token,
      });
      throw loadError;
    }
  }, [controller]);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      void loadDrafts().catch(() => {});
    }, 0);
    return () => window.clearTimeout(loadTimer);
  }, [loadDrafts]);

  useEffect(() => {
    if (typeof onSnapshot !== "function") return;
    onSnapshot({ drafts: visibleDrafts, selectedDraft: selected, status, error });
  }, [error, onSnapshot, selected, status, visibleDrafts]);

  const approve = useCallback(async () => {
    const requestAccessEpoch = controller.beginAccessRequest?.();
    dispatch({ type: "clear-error" });
    try {
      await controller.approve({
        token: getAdminToken(),
        draft: selected,
        reload: loadDrafts,
        onPhase: (nextStatus) => dispatch({
          type: "lifecycle-started",
          status: nextStatus,
        }),
        onTerminalDraft: (draft) => dispatch({ type: "terminal-draft", draft }),
      });
    } catch (approveError) {
      if (controller.isAccessRequestCurrent?.(requestAccessEpoch) === false) return;
      dispatch({
        type: "lifecycle-failed",
        error: approveError instanceof Error ? approveError.message : "晨報草稿核准失敗。",
        accessDenied: isAdminAccessDenied(approveError),
      });
    }
  }, [controller, loadDrafts, selected]);

  const reject = useCallback(async () => {
    const requestAccessEpoch = controller.beginAccessRequest?.();
    dispatch({ type: "clear-error" });
    try {
      await controller.reject({
        token: getAdminToken(),
        draft: selected,
        reload: loadDrafts,
        onPhase: (nextStatus) => dispatch({
          type: "lifecycle-started",
          status: nextStatus,
        }),
        onTerminalDraft: (draft) => dispatch({ type: "terminal-draft", draft }),
      });
    } catch (rejectError) {
      if (controller.isAccessRequestCurrent?.(requestAccessEpoch) === false) return;
      dispatch({
        type: "lifecycle-failed",
        error: rejectError instanceof Error ? rejectError.message : "晨報草稿駁回失敗。",
        accessDenied: isAdminAccessDenied(rejectError),
      });
    }
  }, [controller, loadDrafts, selected]);

  return (
    <div className="usageStatsPanel" aria-busy={status === "loading"}>
      <div className="positionTitle">
        <div>
          <strong>Daily Morning Brief Draft · Internal Approval</strong>
          <p className="hint">
            核准只會發布到內部 News Event 系統，不會啟用 scoring、Dynamic Beta 或公開功能。
          </p>
        </div>
        <button
          type="button"
          className="secondaryButton compact"
          onClick={() => { void loadDrafts().catch(() => {}); }}
          disabled={status === "loading" || lifecycleReconciliationActive}
        >
          {status === "loading" ? "讀取中…" : "更新草稿"}
        </button>
      </div>

      {error && (
        <div className="usageWarning" role="alert">
          <p>{error}</p>
          {drafts.length > 0 && <p>顯示上次成功讀取結果。</p>}
          <button
            type="button"
            className="secondaryButton compact"
            onClick={() => { void loadDrafts().catch(() => {}); }}
            disabled={status === "loading" || lifecycleReconciliationActive}
          >
            重試草稿
          </button>
        </div>
      )}

      {status === "loading" && (
        <p className="hint" role="status" aria-live="polite">晨報草稿讀取中…</p>
      )}

      {!visibleDrafts.length && status !== "loading" && !error && (
        <p className="hint">目前沒有可預覽的晨報草稿。</p>
      )}

      {visibleDrafts.length > 0 && (
        <p>
          <label>
            草稿 revision{" "}
            <select
              value={selectedRevisionId}
              onChange={(event) => dispatch({
                type: "select",
                draftRevisionId: event.target.value,
              })}
              disabled={lifecycleActive}
            >
              {visibleDrafts.map((draft) => (
                <option key={draft.draftRevisionId} value={draft.draftRevisionId}>
                  {draft.briefDate} · #{draft.draftRevisionNumber} · {draftStatusLabel(draft.status)}
                </option>
              ))}
            </select>
          </label>
        </p>
      )}

      {preview && (
        <article
          className="morningBriefAdmin"
          aria-label={`${preview.identity.briefDate} revision #${preview.identity.draftRevisionNumber} 晨報草稿`}
        >
          <div className="positionTitle">
            <div>
              <strong>晨報草稿審核操作</strong>
              <p className="hint">
                Draft revision ID: <code>{preview.identity.draftRevisionId}</code>
              </p>
            </div>
            {preview.identity.status === "pending" && (
              <div
                className="morningBriefLifecycleActions"
                aria-label="晨報草稿 lifecycle 操作"
              >
                <button
                  type="button"
                  className="secondaryButton compact"
                  onClick={approve}
                  disabled={actions.approveDisabled}
                >
                  {lifecycleSnapshot.action === "approve" && lifecycleActive
                    ? "發布中…"
                    : "核准並發布"}
                </button>
                <button
                  type="button"
                  className="secondaryButton compact morningBriefRejectButton"
                  onClick={reject}
                  disabled={actions.rejectDisabled}
                >
                  {lifecycleSnapshot.action === "reject" && lifecycleActive
                    ? "駁回中…"
                    : "拒絕草稿"}
                </button>
              </div>
            )}
          </div>

          <MorningBriefContent
            brief={compact ? compactContent : preview.content}
            compact={compact}
            headingLevel={4}
          />

          {compact ? (
            <dl className="morningBriefDefinitionList morningBriefAdminMetadata">
              <dt>Published brief revision ID · 已發布 Brief</dt>
              <dd>
                {preview.publishedBrief
                  ? <><code>{preview.publishedBrief.revisionId}</code> · Revision #{preview.publishedBrief.revisionNumber ?? "版本號未提供"}</>
                  : "尚未發布"}
              </dd>
            </dl>
          ) : (
            <details className="morningBriefAdminDetails">
              <summary>管理資訊</summary>
              <dl className="morningBriefDefinitionList morningBriefAdminMetadata">
                <dt>建立時間</dt>
                <dd>{formatTime(preview.timestamps.createdAt)}</dd>
                <dt>更新時間</dt>
                <dd>{formatTime(preview.timestamps.updatedAt)}</dd>
                <dt>核准時間</dt>
                <dd>{approvalTimeText(preview)}</dd>
                <dt>拒絕時間</dt>
                <dd>{rejectionTimeText(preview)}</dd>
                <dt>拒絕原因</dt>
                <dd>{rejectionReasonText(preview)}</dd>
                <dt>Published brief revision ID · 已發布 Brief</dt>
                <dd>
                  {preview.publishedBrief
                    ? <><code>{preview.publishedBrief.revisionId}</code> · Revision #{preview.publishedBrief.revisionNumber ?? "版本號未提供"}</>
                    : "尚未發布"}
                </dd>
              </dl>

              <section className="morningBriefAdminWarnings" aria-label="草稿警告">
                <p><strong>驗證警告</strong></p>
                <List items={preview.validationWarnings} empty="沒有驗證警告。" />
                <p><strong>核准時重複警告</strong></p>
                <List
                  items={preview.dedupeWarnings}
                  empty="沒有核准時重複警告。"
                  renderItem={warningText}
                />
              </section>
            </details>
          )}
        </article>
      )}
    </div>
  );
}
