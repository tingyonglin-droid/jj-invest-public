import { validateMorningBriefPayload } from "./schema.js";
import { newsBriefRevisionId } from "./repository.js";

function nowIso(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("News Event service 的 now 必須回傳有效時間。");
  }
  return date.toISOString();
}

export function createNewsEventService({ repository, now = () => new Date() }) {
  return {
    async validate(payload) {
      return validateMorningBriefPayload(payload, { now: nowIso(now) });
    },

    async findPublishedBrief(payload) {
      if (!repository?.readMorningBrief || !payload?.briefDate) return null;
      const revisionId = newsBriefRevisionId(payload);
      const brief = await repository.readMorningBrief({
        briefDate: payload.briefDate,
        revisionId,
      });
      if (!brief) return null;
      return {
        revisionId,
        revisionNumber: Number(brief.revisionNumber),
      };
    },

    async ingest(payload) {
      const validation = await this.validate(payload);
      if (!validation.valid) {
        return { ...validation, saved: false };
      }
      if (!repository) {
        throw new Error("News Event ingestion 需要 repository。");
      }

      const evidenceResults = [];
      const dedupeWarnings = [];
      for (const item of validation.value.evidence) {
        const likelyDuplicates = repository.findLikelyDuplicates
          ? await repository.findLikelyDuplicates(item)
          : [];
        for (const duplicate of likelyDuplicates) {
          dedupeWarnings.push({
            evidenceId: item.evidenceId,
            possibleDuplicateOfEvidenceId: duplicate.evidenceId,
            similarity: duplicate.similarity,
            title: duplicate.title,
            canonicalUrl: duplicate.canonicalUrl,
          });
        }
        evidenceResults.push(await repository.saveEvidence(item));
      }

      const briefResult = await repository.saveMorningBrief(validation.value);
      return {
        saved: true,
        valid: true,
        errors: [],
        warnings: validation.warnings,
        dedupeWarnings,
        evidence: evidenceResults,
        brief: briefResult,
      };
    },
  };
}
