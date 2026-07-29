import { createHash } from "node:crypto";

import { compareNewsTitles } from "./dedupe.js";
import {
  runRedisScript,
  SAVE_NEWS_BRIEF_SCRIPT,
  scriptTuple,
} from "./redis-atomic.js";

export const DYNAMIC_BETA_NEWS_KEY_PREFIX = "jj-invest-public:dynamic-beta:news:v1";

function digest(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function keys({ evidenceId, revisionId, briefDate } = {}) {
  return {
    evidenceCurrent: `${DYNAMIC_BETA_NEWS_KEY_PREFIX}:evidence:${evidenceId}:current`,
    evidenceRevision: `${DYNAMIC_BETA_NEWS_KEY_PREFIX}:evidence:${evidenceId}:revision:${revisionId}`,
    evidenceRevisions: `${DYNAMIC_BETA_NEWS_KEY_PREFIX}:evidence:${evidenceId}:revisions`,
    evidenceSummary: `${DYNAMIC_BETA_NEWS_KEY_PREFIX}:evidence:${evidenceId}:summary`,
    evidenceContentIndex: `${DYNAMIC_BETA_NEWS_KEY_PREFIX}:evidence:content-index`,
    evidenceTimeline: `${DYNAMIC_BETA_NEWS_KEY_PREFIX}:evidence:timeline`,
    briefCurrent: `${DYNAMIC_BETA_NEWS_KEY_PREFIX}:brief:${briefDate}:current`,
    briefRevision: `${DYNAMIC_BETA_NEWS_KEY_PREFIX}:brief:${briefDate}:revision:${revisionId}`,
    briefRevisions: `${DYNAMIC_BETA_NEWS_KEY_PREFIX}:brief:${briefDate}:revisions`,
    briefRevisionCount: `${DYNAMIC_BETA_NEWS_KEY_PREFIX}:brief:${briefDate}:revision-count`,
    briefTimeline: `${DYNAMIC_BETA_NEWS_KEY_PREFIX}:brief:timeline`,
  };
}

function evidenceRecord(evidence, duplicateOfEvidenceId, firstSeenAt) {
  return {
    ...evidence,
    duplicateOfEvidenceId: duplicateOfEvidenceId || null,
    firstSeenAt,
    lastSeenAt: evidence.retrievedAt,
  };
}

export function newsBriefRevisionId(brief) {
  return `nbr_${digest(JSON.stringify({
    briefDate: brief.briefDate,
    generatedAt: brief.generatedAt,
    analystLabel: brief.analystLabel,
    analystRationale: brief.analystRationale,
    evidence: brief.evidence.map((item) => ({
      evidenceId: item.evidenceId,
      revisionId: item.revisionId,
    })),
    events: brief.events,
  }))}`;
}

function unpackBrief(record) {
  if (!record?.payload) return null;
  if (typeof record.payload === "object" && !Array.isArray(record.payload)) {
    return record.payload;
  }
  try {
    return JSON.parse(record.payload);
  } catch {
    return null;
  }
}

export function createNewsRepository(redis) {
  if (!redis) throw new Error("News Event repository 需要 Redis。");

  return {
    async saveEvidence(evidence) {
      const evidenceKeys = keys(evidence);
      const currentRevisionId = await redis.get(evidenceKeys.evidenceCurrent);
      if (currentRevisionId === evidence.revisionId) {
        const currentKey = keys({
          evidenceId: evidence.evidenceId,
          revisionId: currentRevisionId,
        }).evidenceRevision;
        await Promise.all([
          redis.hset(currentKey, { lastSeenAt: evidence.retrievedAt }),
          redis.hset(evidenceKeys.evidenceSummary, {
            lastSeenAt: evidence.retrievedAt,
          }),
          redis.zadd(evidenceKeys.evidenceTimeline, {
            score: Date.parse(evidence.retrievedAt),
            member: evidence.evidenceId,
          }),
        ]);
        const current = await redis.hgetall(currentKey);
        return {
          status: "unchanged",
          evidenceId: evidence.evidenceId,
          revisionId: currentRevisionId,
          duplicateOfEvidenceId: current?.duplicateOfEvidenceId || null,
        };
      }

      const duplicateEvidenceId = await redis.hget(
        evidenceKeys.evidenceContentIndex,
        evidence.contentFingerprint,
      );
      const duplicateOfEvidenceId = duplicateEvidenceId && duplicateEvidenceId !== evidence.evidenceId
        ? duplicateEvidenceId
        : null;
      const previous = currentRevisionId
        ? await redis.hgetall(keys({
            evidenceId: evidence.evidenceId,
            revisionId: currentRevisionId,
          }).evidenceRevision)
        : null;
      const historical = await redis.hgetall(evidenceKeys.evidenceRevision);
      if (historical?.revisionId) {
        const retrievedScore = Date.parse(evidence.retrievedAt);
        await Promise.all([
          redis.hset(evidenceKeys.evidenceRevision, {
            lastSeenAt: evidence.retrievedAt,
          }),
          redis.set(evidenceKeys.evidenceCurrent, evidence.revisionId),
          redis.zadd(evidenceKeys.evidenceTimeline, {
            score: retrievedScore,
            member: evidence.evidenceId,
          }),
          redis.hset(evidenceKeys.evidenceSummary, {
            evidenceId: evidence.evidenceId,
            revisionId: evidence.revisionId,
            canonicalUrl: historical.canonicalUrl,
            sourceName: historical.sourceName,
            sourceTier: historical.sourceTier,
            title: historical.title,
            publishedAt: historical.publishedAt,
            firstSeenAt: historical.firstSeenAt,
            lastSeenAt: evidence.retrievedAt,
            contentFingerprint: historical.contentFingerprint,
            duplicateOfEvidenceId: historical.duplicateOfEvidenceId || null,
          }),
        ]);
        return {
          status: "revised",
          evidenceId: evidence.evidenceId,
          revisionId: evidence.revisionId,
          duplicateOfEvidenceId: historical.duplicateOfEvidenceId || null,
        };
      }
      const record = evidenceRecord(
        evidence,
        duplicateOfEvidenceId,
        previous?.firstSeenAt || evidence.retrievedAt,
      );
      const retrievedScore = Date.parse(evidence.retrievedAt);
      await Promise.all([
        redis.hset(evidenceKeys.evidenceRevision, record),
        redis.set(evidenceKeys.evidenceCurrent, evidence.revisionId),
        redis.zadd(evidenceKeys.evidenceRevisions, {
          score: retrievedScore,
          member: evidence.revisionId,
        }),
        redis.zadd(evidenceKeys.evidenceTimeline, {
          score: retrievedScore,
          member: evidence.evidenceId,
        }),
        redis.hset(evidenceKeys.evidenceSummary, {
          evidenceId: evidence.evidenceId,
          revisionId: evidence.revisionId,
          canonicalUrl: evidence.canonicalUrl,
          sourceName: evidence.sourceName,
          sourceTier: evidence.sourceTier,
          title: evidence.title,
          publishedAt: evidence.publishedAt,
          firstSeenAt: record.firstSeenAt,
          lastSeenAt: record.lastSeenAt,
          contentFingerprint: evidence.contentFingerprint,
          duplicateOfEvidenceId,
        }),
        duplicateEvidenceId
          ? Promise.resolve(0)
          : redis.hset(evidenceKeys.evidenceContentIndex, {
              [evidence.contentFingerprint]: evidence.evidenceId,
            }),
      ]);

      return {
        status: currentRevisionId ? "revised" : "inserted",
        evidenceId: evidence.evidenceId,
        revisionId: evidence.revisionId,
        duplicateOfEvidenceId,
      };
    },

    async readEvidenceRevisions(evidenceId) {
      const revisionIds = await redis.zrange(
        keys({ evidenceId }).evidenceRevisions,
        0,
        -1,
      );
      return Promise.all(revisionIds.map((revisionId) => redis.hgetall(
        keys({ evidenceId, revisionId }).evidenceRevision,
      )));
    },

    async readEvidenceSummaries({ since = null, until = null, limit = 100 } = {}) {
      const timelineKey = keys().evidenceTimeline;
      let evidenceIds;
      if (since || until) {
        evidenceIds = await redis.zrange(
          timelineKey,
          since ? Date.parse(since) : Number.NEGATIVE_INFINITY,
          until ? Date.parse(until) : Number.POSITIVE_INFINITY,
          { byScore: true },
        );
      } else {
        evidenceIds = await redis.zrange(timelineKey, 0, -1);
      }
      evidenceIds = evidenceIds.reverse().slice(0, limit);
      return Promise.all(evidenceIds.map((evidenceId) => redis.hgetall(
        keys({ evidenceId }).evidenceSummary,
      )));
    },

    async findLikelyDuplicates(evidence, { windowHours = 72 } = {}) {
      const retrievedScore = Date.parse(evidence.retrievedAt);
      const since = new Date(retrievedScore - windowHours * 60 * 60 * 1000).toISOString();
      const candidates = await this.readEvidenceSummaries({
        since,
        until: evidence.retrievedAt,
        limit: 250,
      });
      return candidates.flatMap((candidate) => {
        if (
          !candidate?.evidenceId ||
          candidate.evidenceId === evidence.evidenceId ||
          candidate.contentFingerprint === evidence.contentFingerprint
        ) return [];
        const comparison = compareNewsTitles(candidate.title, evidence.title);
        return comparison.likelyDuplicate
          ? [{
              evidenceId: candidate.evidenceId,
              title: candidate.title,
              canonicalUrl: candidate.canonicalUrl,
              similarity: comparison.similarity,
            }]
          : [];
      });
    },

    async saveMorningBrief(brief) {
      const revisionId = newsBriefRevisionId(brief);
      const briefKeys = keys({ briefDate: brief.briefDate, revisionId });
      const generatedScore = Date.parse(brief.generatedAt);
      const [status, storedRevisionId, rawRevisionNumber] = scriptTuple(
        await runRedisScript(
          redis,
          SAVE_NEWS_BRIEF_SCRIPT,
          [
            briefKeys.briefCurrent,
            briefKeys.briefRevision,
            briefKeys.briefRevisions,
            briefKeys.briefTimeline,
            briefKeys.briefRevisionCount,
          ],
          [
            revisionId,
            brief.briefDate,
            generatedScore,
            JSON.stringify(brief),
            `${brief.briefDate}:${revisionId}`,
          ],
        ),
      );
      if (!status || !storedRevisionId || !Number.isFinite(Number(rawRevisionNumber))) {
        throw new Error("News Event atomic brief publication 回傳無效結果。");
      }
      return {
        status,
        revisionId: storedRevisionId,
        revisionNumber: Number(rawRevisionNumber),
      };
    },

    async readMorningBrief({ briefDate, revisionId = null }) {
      if (!briefDate) return null;
      const selectedRevisionId = revisionId || await redis.get(
        keys({ briefDate }).briefCurrent,
      );
      if (!selectedRevisionId) return null;
      return unpackBrief(await redis.hgetall(
        keys({ briefDate, revisionId: selectedRevisionId }).briefRevision,
      ));
    },

    async readRecentBriefs({ limit = 20 } = {}) {
      const boundedLimit = Math.max(1, Math.floor(Number(limit) || 20));
      const members = await redis.zrange(
        keys().briefTimeline,
        0,
        boundedLimit - 1,
        { rev: true },
      );
      const rows = await Promise.all(members.map(async (member) => {
        const briefDate = member.slice(0, 10);
        const revisionId = member.slice(11);
        return unpackBrief(await redis.hgetall(
          keys({ briefDate, revisionId }).briefRevision,
        ));
      }));
      return rows.filter(Boolean);
    },
  };
}
