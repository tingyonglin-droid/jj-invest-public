import { createHash } from "node:crypto";

import {
  BEGIN_DRAFT_PUBLICATION_SCRIPT,
  CLAIM_DRAFT_REVIEW_SCRIPT,
  INITIALIZE_DRAFT_INDEX_SCRIPT,
  MARK_DRAFT_APPROVED_SCRIPT,
  MARK_DRAFT_REJECTED_SCRIPT,
  RECORD_DRAFT_PUBLICATION_SCRIPT,
  RELEASE_DRAFT_REVIEW_SCRIPT,
  runRedisScript,
  SAVE_NEWS_DRAFT_SCRIPT,
  scriptTuple,
} from "./redis-atomic.js";

const PREFIX = "jj-invest-public:dynamic-beta:news:v1:draft";

function digest(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function semanticPayload(payload) {
  return {
    ...payload,
    evidence: payload.evidence.map((item) => {
      const semanticEvidence = { ...item };
      delete semanticEvidence.retrievedAt;
      return semanticEvidence;
    }),
  };
}

function revisionId(payload) {
  return `ndrv_${digest(JSON.stringify(semanticPayload(payload)))}`;
}

function keys({ briefDate, draftRevisionId } = {}) {
  return {
    current: `${PREFIX}:${briefDate}:current`,
    revision: `${PREFIX}:${briefDate}:revision:${draftRevisionId}`,
    revisions: `${PREFIX}:${briefDate}:revisions`,
    revisionCount: `${PREFIX}:${briefDate}:revision-count`,
    semanticIndex: `${PREFIX}:${briefDate}:semantic-index`,
    semanticIndexReady: `${PREFIX}:${briefDate}:semantic-index-ready`,
    reviewClaim: `${PREFIX}:${briefDate}:revision:${draftRevisionId}:review-claim`,
    timeline: `${PREFIX}:timeline`,
  };
}

function unpackJson(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function unpackDraft(record) {
  if (!record?.draftRevisionId) return null;
  const {
    approvalPhase: _approvalPhase,
    publicationBriefRevisionId: _publicationBriefRevisionId,
    publicationBriefRevisionNumber: _publicationBriefRevisionNumber,
    publicationDedupeWarnings: _publicationDedupeWarnings,
    publicationRecordedAt: _publicationRecordedAt,
    publicationStartedAt: _publicationStartedAt,
    reviewIntent: _reviewIntent,
    reviewStartedAt: _reviewStartedAt,
    sortScore: _sortScore,
    ...publicRecord
  } = record;
  const approvedBriefRevisionNumber = publicRecord.approvedBriefRevisionNumber;
  return {
    ...publicRecord,
    draftRevisionNumber: Number(publicRecord.draftRevisionNumber),
    approvedBriefRevisionNumber: approvedBriefRevisionNumber === null
      || approvedBriefRevisionNumber === undefined
      || approvedBriefRevisionNumber === ""
      || approvedBriefRevisionNumber === "null"
      ? null
      : Number(approvedBriefRevisionNumber),
    approvedAt: publicRecord.approvedAt || null,
    rejectedAt: publicRecord.rejectedAt || null,
    rejectionReason: publicRecord.rejectionReason || null,
    approvedBriefRevisionId: publicRecord.approvedBriefRevisionId || null,
    validationWarnings: unpackJson(publicRecord.validationWarnings, []),
    dedupeWarnings: unpackJson(publicRecord.dedupeWarnings, []),
    payload: unpackJson(publicRecord.payload, null),
  };
}

export function createNewsDraftRepository(redis) {
  if (!redis) throw new Error("News Draft repository 需要 Redis。");

  async function initializeSemanticIndex(briefDate) {
    const draftKeys = keys({ briefDate });
    if (await redis.get(draftKeys.semanticIndexReady)) return;
    const legacyRevisionIds = await redis.zrange(draftKeys.revisions, 0, -1);
    const semanticMappings = {};
    let maxRevisionNumber = 0;
    for (const legacyRevisionId of legacyRevisionIds) {
      const legacy = unpackDraft(await redis.hgetall(
        keys({ briefDate, draftRevisionId: legacyRevisionId }).revision,
      ));
      if (!legacy?.payload) continue;
      semanticMappings[revisionId(legacy.payload)] = legacyRevisionId;
      maxRevisionNumber = Math.max(maxRevisionNumber, legacy.draftRevisionNumber || 0);
    }
    await runRedisScript(
      redis,
      INITIALIZE_DRAFT_INDEX_SCRIPT,
      [
        draftKeys.revisions,
        draftKeys.revisionCount,
        draftKeys.semanticIndex,
        draftKeys.semanticIndexReady,
      ],
      [JSON.stringify(semanticMappings), maxRevisionNumber],
    );
  }

  async function readExact(briefDate, draftRevisionId) {
    return unpackDraft(await redis.hgetall(keys({ briefDate, draftRevisionId }).revision));
  }

  return {
    async saveDraft({ payload, warnings, createdAt }) {
      const draftRevisionId = revisionId(payload);
      const draftKeys = keys({ briefDate: payload.briefDate, draftRevisionId });
      await initializeSemanticIndex(payload.briefDate);
      const indexedRevisionId = await redis.hget(draftKeys.semanticIndex, draftRevisionId);
      const mappedRevisionId = indexedRevisionId || draftRevisionId;
      const mappedRevisionKey = keys({
        briefDate: payload.briefDate,
        draftRevisionId: mappedRevisionId,
      }).revision;
      const score = Date.parse(createdAt);
      const mappedRecord = await redis.hgetall(mappedRevisionKey);
      const mappedScore = Date.parse(mappedRecord?.createdAt) || score;
      const [status, storedRevisionId] = scriptTuple(await runRedisScript(
        redis,
        SAVE_NEWS_DRAFT_SCRIPT,
        [
          draftKeys.current,
          draftKeys.revision,
          draftKeys.revisions,
          draftKeys.revisionCount,
          draftKeys.semanticIndex,
          draftKeys.timeline,
          draftKeys.semanticIndexReady,
          mappedRevisionKey,
        ],
        [
          draftRevisionId,
          payload.briefDate,
          createdAt,
          score,
          JSON.stringify(warnings || []),
          JSON.stringify(payload),
          mappedScore,
        ],
      ));
      if (!status || !storedRevisionId) {
        throw new Error("News Draft atomic insertion 回傳無效結果。");
      }
      const draft = await readExact(payload.briefDate, storedRevisionId);
      if (!draft) throw new Error("News Draft atomic insertion 後找不到草稿。");
      return { status, draft };
    },

    async readDraft({ briefDate, draftRevisionId = null }) {
      if (!briefDate) return null;
      if (draftRevisionId) {
        return readExact(briefDate, draftRevisionId);
      }
      const draftKeys = keys({ briefDate });
      const revisionIds = await redis.zrange(draftKeys.revisions, 0, -1, { rev: true });
      for (const candidateId of revisionIds) {
        const draft = unpackDraft(await redis.hgetall(
          keys({ briefDate, draftRevisionId: candidateId }).revision,
        ));
        if (draft?.status === "pending") return draft;
      }
      const currentRevisionId = await redis.get(draftKeys.current);
      return currentRevisionId
        ? unpackDraft(await redis.hgetall(
            keys({ briefDate, draftRevisionId: currentRevisionId }).revision,
          ))
        : null;
    },

    async readRecentDrafts({ limit = 20 } = {}) {
      const boundedLimit = Math.max(1, Math.floor(Number(limit) || 20));
      const members = await redis.zrange(
        keys().timeline,
        0,
        boundedLimit - 1,
        { rev: true },
      );
      const drafts = await Promise.all(members.map(async (member) => {
        const briefDate = member.slice(0, 10);
        const draftRevisionId = member.slice(11);
        return unpackDraft(await redis.hgetall(
          keys({ briefDate, draftRevisionId }).revision,
        ));
      }));
      return drafts.filter(Boolean);
    },

    async claimReview({
      briefDate,
      draftRevisionId,
      action,
      token,
      expiresInMs,
      startedAt,
    }) {
      const draftKeys = keys({ briefDate, draftRevisionId });
      const [
        status,
        detail,
        approvalPhase,
        publicationRevisionId,
        rawPublicationRevisionNumber,
        rawPublicationWarnings,
      ] = scriptTuple(await runRedisScript(
        redis,
        CLAIM_DRAFT_REVIEW_SCRIPT,
        [draftKeys.revision, draftKeys.reviewClaim],
        [action, token, expiresInMs, startedAt],
      ));
      return {
        status,
        detail: detail || null,
        approvalPhase: approvalPhase || null,
        publication: publicationRevisionId
          ? {
            brief: {
              revisionId: publicationRevisionId,
              revisionNumber: Number(rawPublicationRevisionNumber),
            },
            dedupeWarnings: unpackJson(rawPublicationWarnings, []),
          }
          : null,
      };
    },

    async releaseReviewClaim({
      briefDate,
      draftRevisionId,
      action,
      token,
      clearIntent = false,
    }) {
      const draftKeys = keys({ briefDate, draftRevisionId });
      return runRedisScript(
        redis,
        RELEASE_DRAFT_REVIEW_SCRIPT,
        [draftKeys.revision, draftKeys.reviewClaim],
        [action, token, clearIntent ? "1" : "0"],
      );
    },

    async beginPublication({
      briefDate,
      draftRevisionId,
      reviewToken,
      publicationStartedAt,
    }) {
      const draftKeys = keys({ briefDate, draftRevisionId });
      return runRedisScript(
        redis,
        BEGIN_DRAFT_PUBLICATION_SCRIPT,
        [draftKeys.revision, draftKeys.reviewClaim],
        [reviewToken, publicationStartedAt],
      );
    },

    async recordPublication({
      briefDate,
      draftRevisionId,
      reviewToken,
      recordedAt,
      brief,
      dedupeWarnings,
    }) {
      const draftKeys = keys({ briefDate, draftRevisionId });
      return runRedisScript(
        redis,
        RECORD_DRAFT_PUBLICATION_SCRIPT,
        [draftKeys.revision, draftKeys.reviewClaim],
        [
          reviewToken,
          brief.revisionId,
          brief.revisionNumber,
          JSON.stringify(dedupeWarnings || []),
          recordedAt,
        ],
      );
    },

    async markApproved({
      briefDate,
      draftRevisionId,
      reviewToken,
      approvedAt,
    }) {
      const draftKeys = keys({ briefDate, draftRevisionId });
      const result = await runRedisScript(
        redis,
        MARK_DRAFT_APPROVED_SCRIPT,
        [draftKeys.revision, draftKeys.reviewClaim],
        [
          reviewToken,
          approvedAt,
        ],
      );
      return { result, draft: await readExact(briefDate, draftRevisionId) };
    },

    async markRejected({
      briefDate,
      draftRevisionId,
      reviewToken,
      rejectedAt,
      rejectionReason,
    }) {
      const draftKeys = keys({ briefDate, draftRevisionId });
      const result = await runRedisScript(
        redis,
        MARK_DRAFT_REJECTED_SCRIPT,
        [draftKeys.revision, draftKeys.reviewClaim],
        [reviewToken, rejectedAt, rejectionReason || ""],
      );
      return { result, draft: await readExact(briefDate, draftRevisionId) };
    },
  };
}
