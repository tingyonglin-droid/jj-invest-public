import { AdminResponseError, readAdminJson } from "../admin-http.js";

export const INITIAL_BRIEFS_ADMIN_STATE = Object.freeze({
  drafts: [],
  publishedBriefs: [],
  selectedPublishedRevisionId: "",
  status: "idle",
  error: "",
  stale: false,
});

function comparePublishedBriefs(left, right) {
  const dateOrder = String(right.briefDate || "").localeCompare(String(left.briefDate || ""));
  if (dateOrder !== 0) return dateOrder;

  const revisionOrder = Number(right.revisionNumber || 0) - Number(left.revisionNumber || 0);
  if (revisionOrder !== 0) return revisionOrder;

  const generatedOrder = String(right.generatedAt || "").localeCompare(
    String(left.generatedAt || ""),
  );
  if (generatedOrder !== 0) return generatedOrder;
  return String(right.revisionId || "").localeCompare(String(left.revisionId || ""));
}

function publishedBriefsFrom(event, currentBriefs) {
  const hasPublishedBriefs = Object.hasOwn(event, "publishedBriefs");
  const hasBriefs = Object.hasOwn(event, "briefs");
  if (!hasPublishedBriefs && !hasBriefs) return currentBriefs;
  const input = hasPublishedBriefs ? event.publishedBriefs : event.briefs;
  return (Array.isArray(input) ? input : [])
    .filter((brief) => typeof brief?.revisionId === "string" && brief.revisionId.length > 0)
    .slice()
    .sort(comparePublishedBriefs);
}

function selectedRevision(briefs, currentRevisionId) {
  return briefs.some((brief) => brief.revisionId === currentRevisionId)
    ? currentRevisionId
    : briefs[0]?.revisionId || "";
}

export function briefsAdminReducer(state, event) {
  switch (event.type) {
    case "load-started":
      return { ...state, status: "loading", error: "" };
    case "load-succeeded": {
      const publishedBriefs = publishedBriefsFrom(event, state.publishedBriefs);
      return {
        ...state,
        drafts: Object.hasOwn(event, "drafts")
          ? (Array.isArray(event.drafts) ? event.drafts : [])
          : state.drafts,
        publishedBriefs,
        selectedPublishedRevisionId: selectedRevision(
          publishedBriefs,
          state.selectedPublishedRevisionId,
        ),
        status: "ready",
        error: "",
        stale: false,
      };
    }
    case "load-failed":
      if (event.accessDenied) {
        return {
          ...state,
          drafts: [],
          publishedBriefs: [],
          selectedPublishedRevisionId: "",
          status: "error",
          error: event.error,
          stale: false,
        };
      }
      return {
        ...state,
        status: "error",
        error: event.error,
        stale: state.publishedBriefs.length > 0,
      };
    case "select-published": {
      const revisionId = event.revisionId;
      if (!state.publishedBriefs.some((brief) => brief.revisionId === revisionId)) return state;
      return { ...state, selectedPublishedRevisionId: revisionId };
    }
    default:
      return state;
  }
}

export function getSelectedPublishedBrief(state) {
  return state.publishedBriefs.find(
    (brief) => brief.revisionId === state.selectedPublishedRevisionId,
  ) || null;
}

function requireToken(token) {
  if (!token) {
    throw new AdminResponseError("缺少管理 token。", { kind: "authorization" });
  }
  return encodeURIComponent(token);
}

export function createBriefsAdminController({ fetchImpl }) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Briefs admin controller 需要 fetchImpl。");
  }
  return {
    async loadPublished({ token }) {
      const response = await fetchImpl(
        `/api/dynamic-beta/news?token=${requireToken(token)}`,
        { cache: "no-store" },
      );
      return readAdminJson(response, {
        fallbackMessage: "已發布晨報讀取失敗",
        validate: (payload) => (
          payload !== null
          && typeof payload === "object"
          && !Array.isArray(payload)
          && Array.isArray(payload.briefs)
        ),
      });
    },
  };
}
