import { randomUUID } from "node:crypto";

const DEFAULT_REVIEW_CLAIM_TTL_MS = 2 * 60 * 1000;

function nowIso(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("News Draft service 的 now 必須回傳有效時間。");
  }
  return date.toISOString();
}

function exactDraftInput({ briefDate, draftRevisionId } = {}) {
  return Boolean(briefDate && draftRevisionId);
}

function recordedApproval(draft) {
  return {
    alreadyApproved: true,
    draft,
    brief: {
      revisionId: draft.approvedBriefRevisionId,
      revisionNumber: draft.approvedBriefRevisionNumber,
    },
  };
}

function revalidatablePayload(payload) {
  return {
    ...payload,
    evidence: payload.evidence.map((item) => ({
      url: item.originalUrl || item.canonicalUrl,
      sourceName: item.sourceName,
      sourceTier: item.sourceTier,
      title: item.title,
      summary: item.summary,
      publishedAt: item.publishedAt,
    })),
  };
}

export class NewsDraftNotFoundError extends Error {
  constructor(message = "找不到指定的晨報草稿。") {
    super(message);
    this.name = "NewsDraftNotFoundError";
  }
}

export class NewsDraftConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "NewsDraftConflictError";
  }
}

export function createNewsDraftService({
  draftRepository,
  newsEventService,
  now = () => new Date(),
  reviewClaimTtlMs = DEFAULT_REVIEW_CLAIM_TTL_MS,
  reviewToken = () => randomUUID(),
}) {
  if (!draftRepository) throw new Error("News Draft service 需要 draftRepository。");
  if (!newsEventService) throw new Error("News Draft service 需要 newsEventService。");

  async function readExactDraft(input) {
    if (!exactDraftInput(input)) throw new NewsDraftNotFoundError();
    const draft = await draftRepository.readDraft(input);
    if (!draft) throw new NewsDraftNotFoundError();
    return draft;
  }

  function nextReviewToken() {
    const token = String(reviewToken() || "");
    if (!token) throw new Error("News Draft review token 不得為空白。");
    return token;
  }

  async function claimReview(input, action) {
    const token = nextReviewToken();
    const claim = await draftRepository.claimReview({
      briefDate: input.briefDate,
      draftRevisionId: input.draftRevisionId,
      action,
      token,
      expiresInMs: Math.max(1, Math.floor(Number(reviewClaimTtlMs) || DEFAULT_REVIEW_CLAIM_TTL_MS)),
      startedAt: nowIso(now),
    });
    return { ...claim, token };
  }

  async function releaseReview(input, action, token, clearIntent) {
    if (!token) return;
    await draftRepository.releaseReviewClaim({
      briefDate: input.briefDate,
      draftRevisionId: input.draftRevisionId,
      action,
      token,
      clearIntent,
    });
  }

  function claimConflict(action) {
    const label = action === "approve" ? "核准" : "駁回";
    return new NewsDraftConflictError(`晨報草稿正在進行其他審核，暫時無法${label}。`);
  }

  async function requireAcquiredClaim(input, action) {
    const claim = await claimReview(input, action);
    if (claim.status === "missing") throw new NewsDraftNotFoundError();
    if (claim.status === "terminal") {
      return { terminal: await readExactDraft(input), token: null };
    }
    if (claim.status !== "acquired") throw claimConflict(action);
    const draft = await readExactDraft(input);
    if (draft.status !== "pending") {
      await releaseReview(input, action, claim.token, false);
      return { terminal: draft, token: null };
    }
    return {
      draft,
      token: claim.token,
      approvalPhase: claim.approvalPhase,
      publication: claim.publication,
    };
  }

  function samePublication(left, right) {
    return left?.brief?.revisionId === right?.brief?.revisionId
      && Number(left?.brief?.revisionNumber) === Number(right?.brief?.revisionNumber);
  }

  function publicationResult(publication) {
    return {
      saved: true,
      valid: true,
      errors: [],
      warnings: [],
      dedupeWarnings: publication.dedupeWarnings || [],
      brief: publication.brief,
    };
  }

  async function recoverPublishedBrief(draft) {
    if (typeof newsEventService.findPublishedBrief !== "function") return null;
    const brief = await newsEventService.findPublishedBrief(draft.payload);
    if (!brief) return null;
    if (!brief.revisionId || !Number.isFinite(Number(brief.revisionNumber))) {
      throw new Error("News Event publication recovery 回傳無效晨報版本。");
    }
    return {
      brief: {
        revisionId: brief.revisionId,
        revisionNumber: Number(brief.revisionNumber),
      },
      dedupeWarnings: [],
    };
  }

  async function persistPublication(input, publication, initialToken) {
    let token = initialToken;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await draftRepository.recordPublication({
        briefDate: input.briefDate,
        draftRevisionId: input.draftRevisionId,
        reviewToken: token,
        recordedAt: nowIso(now),
        brief: publication.brief,
        dedupeWarnings: publication.dedupeWarnings || [],
      });
      if (result === "published") return { publication, token };
      if (result === "missing") throw new NewsDraftNotFoundError();
      if (result !== "claim_lost" || attempt > 0) {
        throw new NewsDraftConflictError("晨報草稿的審核狀態已變更。");
      }

      const recovered = await requireAcquiredClaim(input, "approve");
      if (recovered.terminal) {
        if (recovered.terminal.status === "approved") {
          return { terminal: recovered.terminal, token: null };
        }
        throw new NewsDraftConflictError("晨報草稿的審核狀態已變更。");
      }
      token = recovered.token;
      if (recovered.approvalPhase === "published") {
        if (!samePublication(recovered.publication, publication)) {
          throw new NewsDraftConflictError("晨報草稿的發布版本已變更。");
        }
        return { publication: recovered.publication, token };
      }
    }
    throw new NewsDraftConflictError("晨報草稿的審核狀態已變更。");
  }

  async function finishApproval(input, initialToken) {
    let token = initialToken;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const transition = await draftRepository.markApproved({
        briefDate: input.briefDate,
        draftRevisionId: input.draftRevisionId,
        reviewToken: token,
        approvedAt: nowIso(now),
      });
      if (transition.result === "approved") return { draft: transition.draft, token };
      if (transition.result === "missing" || !transition.draft) {
        throw new NewsDraftNotFoundError();
      }
      if (transition.draft.status === "approved") return { draft: transition.draft, token };
      if (transition.result !== "claim_lost" || attempt > 0) {
        throw new NewsDraftConflictError("晨報草稿的審核狀態已變更。");
      }

      const recovered = await requireAcquiredClaim(input, "approve");
      if (recovered.terminal) {
        if (recovered.terminal.status === "approved") {
          return { draft: recovered.terminal, token: null };
        }
        throw new NewsDraftConflictError("晨報草稿的審核狀態已變更。");
      }
      if (recovered.approvalPhase !== "published" || !recovered.publication) {
        throw new NewsDraftConflictError("晨報草稿的發布版本尚未完成記錄。");
      }
      token = recovered.token;
    }
    throw new NewsDraftConflictError("晨報草稿的審核狀態已變更。");
  }

  return {
    async create(payload) {
      const validation = await newsEventService.validate(payload);
      if (!validation.valid) return { ...validation, saved: false };

      const saved = await draftRepository.saveDraft({
        payload: validation.value,
        warnings: validation.warnings,
        createdAt: nowIso(now),
      });
      return { ...validation, ...saved, saved: true };
    },

    async list({ briefDate, draftRevisionId, limit } = {}) {
      if (briefDate) {
        return draftRepository.readDraft({ briefDate, draftRevisionId });
      }
      const requestedLimit = Number(limit);
      const boundedLimit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(Math.floor(requestedLimit), 1), 50)
        : 20;
      return draftRepository.readRecentDrafts({ limit: boundedLimit });
    },

    async approve(input) {
      const initial = await readExactDraft(input);
      if (initial.status === "approved") return recordedApproval(initial);
      if (initial.status !== "pending") {
        throw new NewsDraftConflictError("只有待審核的晨報草稿可以核准。");
      }

      let token = null;
      let clearIntent = false;
      try {
        const claimed = await requireAcquiredClaim(input, "approve");
        token = claimed.token;
        if (claimed.terminal) {
          if (claimed.terminal.status === "approved") return recordedApproval(claimed.terminal);
          throw new NewsDraftConflictError("只有待審核的晨報草稿可以核准。");
        }

        let approvalPhase = claimed.approvalPhase;
        let publication = claimed.publication;
        clearIntent = approvalPhase === "claimed";
        if (approvalPhase === "published" && !publication) {
          throw new NewsDraftConflictError("晨報草稿的發布版本記錄不完整。");
        }
        if (approvalPhase === "publishing") {
          clearIntent = false;
          publication = await recoverPublishedBrief(claimed.draft);
        }

        let publishedResult = publication ? publicationResult(publication) : null;
        if (!publication) {
          const payload = revalidatablePayload(claimed.draft.payload);
          const validation = await newsEventService.validate(payload);
          if (!validation.valid) return { ...validation, saved: false };

          if (approvalPhase === "claimed") {
            const publicationState = await draftRepository.beginPublication({
              briefDate: input.briefDate,
              draftRevisionId: input.draftRevisionId,
              reviewToken: token,
              publicationStartedAt: nowIso(now),
            });
            if (publicationState !== "publishing") {
              throw new NewsDraftConflictError("晨報草稿無法進入發布階段。");
            }
            approvalPhase = "publishing";
            clearIntent = false;
          }
          if (approvalPhase !== "publishing") {
            throw new NewsDraftConflictError("晨報草稿的發布階段無效。");
          }

          const published = await newsEventService.ingest(payload);
          if (!published?.saved) return published;
          if (!published.brief) {
            throw new Error("News Event ingestion 未回傳晨報版本。");
          }
          publication = {
            brief: published.brief,
            dedupeWarnings: published.dedupeWarnings || [],
          };
          publishedResult = published;
        }

        if (approvalPhase !== "published") {
          const persisted = await persistPublication(input, publication, token);
          token = persisted.token;
          if (persisted.terminal) return recordedApproval(persisted.terminal);
          publication = persisted.publication;
        }
        const approved = await finishApproval(input, token);
        token = approved.token;
        return {
          ...publishedResult,
          brief: publication.brief,
          dedupeWarnings: publication.dedupeWarnings || [],
          draft: approved.draft,
        };
      } finally {
        await releaseReview(input, "approve", token, clearIntent);
      }
    },

    async reject(input = {}) {
      const initial = await readExactDraft(input);
      if (initial.status !== "pending") {
        throw new NewsDraftConflictError("只有待審核的晨報草稿可以駁回。");
      }

      const reason = typeof input.reason === "string" ? input.reason.trim() : "";
      if (reason.length > 300) {
        throw new NewsDraftConflictError("駁回原因不得超過 300 個字元。");
      }
      let token = null;
      try {
        const claimed = await requireAcquiredClaim(input, "reject");
        token = claimed.token;
        if (claimed.terminal) {
          throw new NewsDraftConflictError("只有待審核的晨報草稿可以駁回。");
        }
        const transition = await draftRepository.markRejected({
          briefDate: input.briefDate,
          draftRevisionId: input.draftRevisionId,
          reviewToken: token,
          rejectedAt: nowIso(now),
          rejectionReason: reason || null,
        });
        if (transition.result === "missing" || !transition.draft) {
          throw new NewsDraftNotFoundError();
        }
        if (transition.result !== "rejected" || transition.draft.status !== "rejected") {
          throw new NewsDraftConflictError("晨報草稿的審核狀態已變更。");
        }
        return { draft: transition.draft };
      } finally {
        await releaseReview(input, "reject", token, true);
      }
    },
  };
}
