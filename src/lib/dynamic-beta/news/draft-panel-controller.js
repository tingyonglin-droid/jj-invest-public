import { approvalFailureMessage } from "./draft-view.js";
import { buildPublishedBriefPresentation } from "./brief-presentation.js";
import {
  AdminResponseError,
  readAdminJson,
} from "../admin-http.js";

export const INITIAL_DRAFT_PANEL_STATE = Object.freeze({
  drafts: [],
  selectedRevisionId: "",
  status: "loading",
  error: "",
});

function selectedRevision(drafts, currentRevisionId) {
  return drafts.some((draft) => draft.draftRevisionId === currentRevisionId)
    ? currentRevisionId
    : drafts[0]?.draftRevisionId || "";
}

export function draftPanelReducer(state, event) {
  switch (event.type) {
    case "load-started":
      return { ...state, status: "loading", error: "" };
    case "load-succeeded": {
      const drafts = Array.isArray(event.drafts) ? event.drafts : [];
      return {
        ...state,
        drafts,
        selectedRevisionId: selectedRevision(drafts, state.selectedRevisionId),
        status: "ready",
        error: "",
      };
    }
    case "load-failed":
      return event.accessDenied
        ? {
          ...state,
          drafts: [],
          selectedRevisionId: "",
          status: "error",
          error: event.error,
        }
        : { ...state, status: "error", error: event.error };
    case "terminal-draft": {
      if (!event.draft?.draftRevisionId) return state;
      const drafts = state.drafts.some((draft) => (
        draft.briefDate === event.draft.briefDate
        && draft.draftRevisionId === event.draft.draftRevisionId
      ))
        ? state.drafts.map((draft) => (
          draft.briefDate === event.draft.briefDate
          && draft.draftRevisionId === event.draft.draftRevisionId
            ? event.draft
            : draft
        ))
        : [event.draft, ...state.drafts];
      return {
        ...state,
        drafts,
        selectedRevisionId: event.draft.draftRevisionId,
        error: "",
      };
    }
    case "select":
      return { ...state, selectedRevisionId: event.draftRevisionId };
    case "clear-error":
      return { ...state, error: "" };
    case "lifecycle-started":
      return { ...state, status: event.status, error: "" };
    case "lifecycle-failed":
      return event.accessDenied
        ? {
          ...state,
          drafts: [],
          selectedRevisionId: "",
          status: "error",
          error: event.error,
        }
        : { ...state, status: "error", error: event.error };
    default:
      return state;
  }
}

export function draftActionState(draft, lifecycleActive) {
  const disabled = !draft || draft.status !== "pending" || lifecycleActive;
  return {
    approveDisabled: disabled,
    rejectDisabled: disabled,
  };
}

export function buildDraftPreview(draft) {
  if (!draft) return null;
  const payload = draft.payload || {};
  const normalizedContent = buildPublishedBriefPresentation({
    ...payload,
    briefDate: payload.briefDate || draft.briefDate,
    revisionId: draft.draftRevisionId,
    revisionNumber: draft.draftRevisionNumber,
    status: draft.status,
  });
  return {
    identity: {
      briefDate: draft.briefDate,
      draftRevisionId: draft.draftRevisionId,
      draftRevisionNumber: draft.draftRevisionNumber,
      status: draft.status,
    },
    analysis: {
      label: payload.analystLabel || null,
      rationale: payload.analystRationale || null,
    },
    timestamps: {
      generatedAt: payload.generatedAt || null,
      createdAt: draft.createdAt || null,
      updatedAt: draft.updatedAt || null,
      approvedAt: draft.approvedAt || null,
      rejectedAt: draft.rejectedAt || null,
    },
    rejectionReason: draft.rejectionReason || null,
    publishedBrief: draft.approvedBriefRevisionId
      ? {
        revisionId: draft.approvedBriefRevisionId,
        revisionNumber: draft.approvedBriefRevisionNumber,
      }
      : null,
    validationWarnings: Array.isArray(draft.validationWarnings)
      ? draft.validationWarnings
      : [],
    dedupeWarnings: Array.isArray(draft.dedupeWarnings) ? draft.dedupeWarnings : [],
    evidence: (payload.evidence || []).map((source) => ({
      evidenceId: source.evidenceId || null,
      url: source.canonicalUrl || source.originalUrl || source.url || null,
      title: source.title || null,
      summary: source.summary || null,
      sourceName: source.sourceName || null,
      sourceTier: source.sourceTier || null,
      publishedAt: source.publishedAt || null,
      retrievedAt: source.retrievedAt || null,
    })),
    events: (payload.events || []).map((event) => ({ ...event })),
    content: {
      ...normalizedContent,
      identity: {
        ...normalizedContent.identity,
        kind: "draft",
      },
    },
  };
}

function requireToken(token) {
  if (!token) {
    throw new AdminResponseError("缺少管理 token。", { kind: "authorization" });
  }
  return encodeURIComponent(token);
}

function draftKey(draft) {
  return draft?.briefDate && draft?.draftRevisionId
    ? `${draft.briefDate}\u0000${draft.draftRevisionId}`
    : "";
}

function validDraftListPayload(payload) {
  return Boolean(payload && typeof payload === "object" && Array.isArray(payload.drafts));
}

function validLifecyclePayload(payload, { action, draft }) {
  if (payload?.saved === false) return true;
  const terminal = payload?.draft;
  const expectedStatus = action === "approve" ? "approved" : "rejected";
  const saved = action === "approve"
    ? payload?.saved === true || payload?.alreadyApproved === true
    : payload?.saved !== false;
  return Boolean(
    saved
    && terminal
    && terminal.briefDate === draft.briefDate
    && terminal.draftRevisionId === draft.draftRevisionId
    && terminal.status === expectedStatus
  );
}

export function createDraftPanelController({
  fetchImpl,
  confirmImpl,
  promptImpl,
}) {
  if (typeof fetchImpl !== "function") throw new Error("Draft panel controller 需要 fetchImpl。");
  if (typeof confirmImpl !== "function") throw new Error("Draft panel controller 需要 confirmImpl。");
  if (typeof promptImpl !== "function") throw new Error("Draft panel controller 需要 promptImpl。");
  const overlays = new Map();
  const subscribers = new Set();
  let accessEpoch = 0;
  let snapshot = Object.freeze({
    phase: "idle",
    action: null,
    draftKey: "",
    terminalDraft: null,
    error: "",
    accessEpoch,
  });

  function publish(nextSnapshot) {
    snapshot = Object.freeze({ ...nextSnapshot, accessEpoch });
    for (const subscriber of subscribers) subscriber();
  }

  function setPhase(phase, values = {}) {
    publish({
      phase,
      action: values.action ?? snapshot.action,
      draftKey: values.draftKey ?? snapshot.draftKey,
      terminalDraft: values.terminalDraft === undefined
        ? snapshot.terminalDraft
        : values.terminalDraft,
      error: values.error === undefined ? snapshot.error : values.error,
    });
  }

  function resetLifecycle() {
    publish({
      phase: "idle",
      action: null,
      draftKey: "",
      terminalDraft: null,
      error: "",
    });
  }

  function invalidateAccess(error) {
    accessEpoch += 1;
    overlays.clear();
    publish({
      phase: "access-denied",
      action: null,
      draftKey: "",
      terminalDraft: null,
      error: error instanceof Error ? error.message : "管理權限已失效。",
    });
  }

  function accessInvalidationError() {
    return new AdminResponseError(
      snapshot.error || "管理權限已失效。",
      { kind: "authorization" },
    );
  }

  function throwIfAccessChanged(requestAccessEpoch) {
    if (requestAccessEpoch !== accessEpoch) throw accessInvalidationError();
  }

  function applyDraftOverlays(drafts, lifecycleState = snapshot) {
    if (lifecycleState?.phase === "access-denied") return [];
    const terminalKey = draftKey(lifecycleState?.terminalDraft);
    return (Array.isArray(drafts) ? drafts : []).map((draft) => (
      overlays.get(draftKey(draft))
      || (terminalKey === draftKey(draft) ? lifecycleState.terminalDraft : null)
      || draft
    ));
  }

  function effectiveDraft(draft) {
    return overlays.get(draftKey(draft)) || draft;
  }

  function reconcileDrafts(drafts) {
    if (snapshot.phase !== "reconciling" && snapshot.phase !== "uncertain") return;
    const authoritative = drafts.find((draft) => draftKey(draft) === snapshot.draftKey);
    if (!authoritative) return;
    const overlay = overlays.get(snapshot.draftKey);
    if (overlay && authoritative.status !== overlay.status) {
      setPhase("uncertain");
      return;
    }
    if (authoritative.status === "approved" || authoritative.status === "rejected") {
      overlays.set(snapshot.draftKey, authoritative);
    }
    resetLifecycle();
  }

  async function runLifecycle({
    action,
    token,
    draft,
    reason,
    reload = async () => {},
    onPhase = () => {},
    onTerminalDraft = () => {},
  }) {
    if (snapshot.phase !== "idle") return { skipped: "busy" };
    const actionAccessEpoch = accessEpoch;
    const currentDraft = effectiveDraft(draft);
    if (!currentDraft || currentDraft.status !== "pending") return { skipped: "status" };
    draft = currentDraft;
    let encodedToken;
    try {
      encodedToken = requireToken(token);
    } catch (error) {
      if (error?.kind === "authorization") invalidateAccess(error);
      throw error;
    }
    const actionDraftKey = draftKey(draft);
    setPhase("active", {
      action,
      draftKey: actionDraftKey,
      terminalDraft: null,
      error: "",
    });
    onPhase(action === "approve" ? "approving" : "rejecting");
    try {
      const body = action === "approve"
        ? {
          briefDate: draft.briefDate,
          draftRevisionId: draft.draftRevisionId,
        }
        : {
          briefDate: draft.briefDate,
          draftRevisionId: draft.draftRevisionId,
          reason,
        };
      const response = await fetchImpl(
        `/api/dynamic-beta/news/drafts/${action}?token=${encodedToken}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      throwIfAccessChanged(actionAccessEpoch);
      const payload = await readAdminJson(response, {
        fallbackMessage: action === "approve" ? "晨報草稿核准" : "晨報草稿駁回",
        validate: (value) => validLifecyclePayload(value, { action, draft }),
      });
      throwIfAccessChanged(actionAccessEpoch);
      if (payload.saved === false) {
        throw new AdminResponseError(
          action === "approve"
            ? approvalFailureMessage(payload)
            : payload.error || "晨報草稿無法駁回。",
          { kind: "request", payload },
        );
      }
      overlays.set(actionDraftKey, payload.draft);
      setPhase("reconciling", { terminalDraft: payload.draft });
      onTerminalDraft(payload.draft);
      const reloaded = await reload();
      throwIfAccessChanged(actionAccessEpoch);
      if (snapshot.phase === "reconciling") {
        const reloadedDrafts = Array.isArray(reloaded?.drafts) ? reloaded.drafts : [];
        reconcileDrafts(reloadedDrafts);
      }
      if (snapshot.phase !== "idle") setPhase("uncertain");
      return payload;
    } catch (error) {
      if (actionAccessEpoch !== accessEpoch) throw accessInvalidationError();
      if (error?.kind === "authorization") {
        invalidateAccess(error);
      } else {
        setPhase("uncertain");
      }
      throw error;
    }
  }

  return {
    isLifecycleActive() {
      return snapshot.phase !== "idle";
    },

    getLifecycleSnapshot() {
      return snapshot;
    },

    subscribeLifecycle(subscriber) {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },

    beginAccessRequest() {
      return accessEpoch;
    },

    isAccessRequestCurrent(requestAccessEpoch) {
      return requestAccessEpoch === accessEpoch;
    },

    reportAuthorizationLoss(error, requestAccessEpoch = accessEpoch) {
      if (error?.kind !== "authorization" || requestAccessEpoch !== accessEpoch) {
        return false;
      }
      invalidateAccess(error);
      return true;
    },

    completeValidatedAccess(requestAccessEpoch) {
      if (requestAccessEpoch !== accessEpoch) return false;
      if (snapshot.phase === "access-denied") resetLifecycle();
      return true;
    },

    applyDraftOverlays,

    clearLifecycleAfterAccessLoss(error) {
      invalidateAccess(error);
    },

    async load({ token }) {
      const requestAccessEpoch = accessEpoch;
      try {
        const encodedToken = requireToken(token);
        const response = await fetchImpl(
          `/api/dynamic-beta/news/drafts?token=${encodedToken}`,
          { cache: "no-store" },
        );
        const payload = await readAdminJson(response, {
          fallbackMessage: "晨報草稿",
          validate: validDraftListPayload,
        });
        throwIfAccessChanged(requestAccessEpoch);
        if (snapshot.phase === "access-denied") resetLifecycle();
        reconcileDrafts(payload.drafts);
        return {
          ...payload,
          drafts: applyDraftOverlays(payload.drafts),
        };
      } catch (error) {
        if (error?.kind === "authorization" && requestAccessEpoch === accessEpoch) {
          invalidateAccess(error);
        }
        throw error;
      }
    },

    async approve({ token, draft, reload, onPhase, onTerminalDraft }) {
      if (snapshot.phase !== "idle") return { skipped: "busy" };
      const currentDraft = effectiveDraft(draft);
      if (!currentDraft || currentDraft.status !== "pending") return { skipped: "status" };
      if (!confirmImpl(
        `核准並發布 ${currentDraft.briefDate} revision #${currentDraft.draftRevisionNumber}？`,
      )) return { cancelled: true };
      return runLifecycle({
        action: "approve",
        token,
        draft: currentDraft,
        reload,
        onPhase,
        onTerminalDraft,
      });
    },

    async reject({ token, draft, reload, onPhase, onTerminalDraft }) {
      if (snapshot.phase !== "idle") return { skipped: "busy" };
      const currentDraft = effectiveDraft(draft);
      if (!currentDraft || currentDraft.status !== "pending") return { skipped: "status" };
      const reason = promptImpl("請輸入駁回原因（選填）", currentDraft.rejectionReason || "");
      if (reason === null) return { cancelled: true };
      if (!confirmImpl(
        `拒絕草稿 ${currentDraft.briefDate} revision #${currentDraft.draftRevisionNumber}？`,
      )) return { cancelled: true };
      return runLifecycle({
        action: "reject",
        token,
        draft: currentDraft,
        reason,
        reload,
        onPhase,
        onTerminalDraft,
      });
    },
  };
}
