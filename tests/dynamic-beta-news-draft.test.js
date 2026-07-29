import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateMorningBriefPayload } from "../src/lib/dynamic-beta/news/schema.js";
import { createNewsRepository } from "../src/lib/dynamic-beta/news/repository.js";
import { createNewsEventService } from "../src/lib/dynamic-beta/news/service.js";
import { createNewsDraftRepository } from "../src/lib/dynamic-beta/news/draft-repository.js";
import {
  createNewsDraftService,
  NewsDraftConflictError,
  NewsDraftNotFoundError,
} from "../src/lib/dynamic-beta/news/draft-service.js";
import { FakeRedis, InstrumentedRedis } from "./helpers/news-fake-redis.js";

function morningBrief(overrides = {}) {
  return {
    briefDate: "2026-07-28",
    generatedAt: "2026-07-28T00:00:00.000Z",
    analystLabel: "risk_elevated",
    analystRationale: "等待市場數據確認。",
    evidence: [{
      url: "https://example.com/source",
      sourceName: "Example Source",
      sourceTier: "primary",
      title: "Example source title",
      publishedAt: "2026-07-27T23:00:00.000Z",
    }],
    events: Array.from({ length: 5 }, (_, index) => ({
      rank: index + 1,
      headline: `Event ${index + 1}`,
      summary: `Summary ${index + 1}`,
      topicIds: ["global_macro_fed"],
      evidenceUrls: ["https://example.com/source"],
      transmissionPath: ["事件", "市場", "資產"],
      affectedAssets: ["SPY"],
      marketDate: "2026-07-28",
      dataToConfirm: ["YAHOO:SPY"],
      confirmationRules: [{
        seriesId: "YAHOO:SPY",
        expectedDirection: "down",
        changeType: "percent",
        threshold: 1,
      }],
      interpretation: "等待確認。",
      confidence: 0.7,
    })),
    ...overrides,
  };
}

function normalizedBrief(overrides = {}) {
  const payload = morningBrief(overrides);
  const result = validateMorningBriefPayload(payload, {
    now: "2026-07-28T00:05:00.000Z",
  });
  assert.equal(result.valid, true);
  return result.value;
}

function draftService(repository, { ingest, validate } = {}) {
  return createNewsDraftService({
    draftRepository: repository,
    newsEventService: {
      async validate(payload) {
        if (validate) return validate(payload);
        return validateMorningBriefPayload(payload, {
          now: "2026-07-28T00:05:00.000Z",
        });
      },
      async ingest(payload) {
        if (ingest) return ingest(payload);
        throw new Error("create must not publish");
      },
    },
    now: () => new Date("2026-07-28T00:10:00.000Z"),
  });
}

function withRetrievedAt(payload, retrievedAt) {
  return {
    ...payload,
    evidence: payload.evidence.map((item) => ({ ...item, retrievedAt })),
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

let repositoryReviewSequence = 0;

async function claimRepositoryReview(repository, input, action) {
  const token = `${action}-repository-token-${++repositoryReviewSequence}`;
  const claim = await repository.claimReview({
    briefDate: input.briefDate,
    draftRevisionId: input.draftRevisionId,
    action,
    token,
    expiresInMs: 60_000,
    startedAt: input.approvedAt || input.rejectedAt || "2026-07-28T00:00:00.000Z",
  });
  assert.equal(claim.status, "acquired");
  return token;
}

async function approveRepositoryDraft(repository, input) {
  const reviewToken = await claimRepositoryReview(repository, input, "approve");
  assert.equal(await repository.beginPublication({
    briefDate: input.briefDate,
    draftRevisionId: input.draftRevisionId,
    reviewToken,
    publicationStartedAt: input.approvedAt,
  }), "publishing");
  assert.equal(await repository.recordPublication({
    briefDate: input.briefDate,
    draftRevisionId: input.draftRevisionId,
    reviewToken,
    recordedAt: input.approvedAt,
    brief: input.brief,
    dedupeWarnings: input.dedupeWarnings,
  }), "published");
  return (await repository.markApproved({ ...input, reviewToken })).draft;
}

async function rejectRepositoryDraft(repository, input) {
  const reviewToken = await claimRepositoryReview(repository, input, "reject");
  return (await repository.markRejected({ ...input, reviewToken })).draft;
}

async function seedLegacyDraft(redis, {
  payload,
  draftRevisionId,
  draftRevisionNumber,
  createdAt,
}) {
  const prefix = "jj-invest-public:dynamic-beta:news:v1:draft";
  const legacy = {
    draftId: payload.briefDate,
    draftRevisionId,
    draftRevisionNumber,
    briefDate: payload.briefDate,
    status: "pending",
    createdAt,
    updatedAt: createdAt,
    approvedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    approvedBriefRevisionId: null,
    approvedBriefRevisionNumber: null,
    validationWarnings: "[]",
    dedupeWarnings: "[]",
    payload: JSON.stringify(payload),
  };
  await redis.hset(`${prefix}:${payload.briefDate}:revision:${draftRevisionId}`, legacy);
  await redis.set(`${prefix}:${payload.briefDate}:current`, draftRevisionId);
  await redis.zadd(`${prefix}:${payload.briefDate}:revisions`, {
    score: Date.parse(createdAt),
    member: draftRevisionId,
  });
  await redis.zadd(`${prefix}:timeline`, {
    score: Date.parse(createdAt),
    member: `${payload.briefDate}:${draftRevisionId}`,
  });
}

describe("dynamic beta news drafts", () => {
  it("commits a new draft atomically and leaves no partial keys after an injected failure", async () => {
    const redis = new FakeRedis();
    const repository = createNewsDraftRepository(redis);
    const payload = normalizedBrief();
    redis.failNextEval("jj-news-draft-save-v1", new Error("atomic draft write failed"));

    await assert.rejects(repository.saveDraft({
      payload,
      warnings: ["first writer"],
      createdAt: "2026-07-28T00:10:00.000Z",
    }), /atomic draft write failed/);

    assert.equal(await repository.readDraft({ briefDate: payload.briefDate }), null);
    assert.deepEqual(await repository.readRecentDrafts({ limit: 20 }), []);

    const retried = await repository.saveDraft({
      payload,
      warnings: ["first writer"],
      createdAt: "2026-07-28T00:10:00.000Z",
    });
    assert.equal(retried.status, "inserted");
    assert.equal(retried.draft.draftRevisionNumber, 1);
  });

  it("repairs a mapped draft revision whose pointer and indexes were partially lost", async () => {
    const redis = new FakeRedis();
    const repository = createNewsDraftRepository(redis);
    const payload = normalizedBrief();
    const saved = await repository.saveDraft({
      payload,
      warnings: ["preserved"],
      createdAt: "2026-07-28T00:10:00.000Z",
    });
    const prefix = "jj-invest-public:dynamic-beta:news:v1:draft";
    redis.strings.delete(`${prefix}:${payload.briefDate}:current`);
    redis.sortedSets.delete(`${prefix}:${payload.briefDate}:revisions`);
    redis.sortedSets.delete(`${prefix}:timeline`);

    const repaired = await repository.saveDraft({
      payload: withRetrievedAt(payload, "2026-07-28T00:20:00.000Z"),
      warnings: ["must not replace"],
      createdAt: "2026-07-28T00:20:00.000Z",
    });

    assert.equal(repaired.status, "unchanged");
    assert.equal((await repository.readDraft({ briefDate: payload.briefDate })).draftRevisionId,
      saved.draft.draftRevisionId);
    assert.deepEqual(
      (await repository.readRecentDrafts({ limit: 20 })).map((draft) => draft.draftRevisionId),
      [saved.draft.draftRevisionId],
    );
    assert.equal(repaired.draft.createdAt, "2026-07-28T00:10:00.000Z");
  });

  it("allocates unique display revisions for concurrent distinct drafts", async () => {
    const repository = createNewsDraftRepository(new FakeRedis());
    const [first, second] = await Promise.all([
      repository.saveDraft({
        payload: normalizedBrief(),
        warnings: [],
        createdAt: "2026-07-28T00:10:00.000Z",
      }),
      repository.saveDraft({
        payload: normalizedBrief({ analystLabel: "high_alert" }),
        warnings: [],
        createdAt: "2026-07-28T00:20:00.000Z",
      }),
    ]);

    assert.deepEqual(
      [first.draft.draftRevisionNumber, second.draft.draftRevisionNumber].sort((a, b) => a - b),
      [1, 2],
    );
    assert.notEqual(first.draft.draftRevisionId, second.draft.draftRevisionId);
  });

  it("uses first-writer metadata for concurrent identical semantic submissions", async () => {
    const repository = createNewsDraftRepository(new FakeRedis());
    const payload = normalizedBrief();
    const [first, duplicate] = await Promise.all([
      repository.saveDraft({
        payload,
        warnings: ["first writer"],
        createdAt: "2026-07-28T00:10:00.000Z",
      }),
      repository.saveDraft({
        payload: withRetrievedAt(payload, "2026-07-28T00:15:00.000Z"),
        warnings: ["must not replace"],
        createdAt: "2026-07-28T00:20:00.000Z",
      }),
    ]);
    const stored = await repository.readDraft({
      briefDate: payload.briefDate,
      draftRevisionId: first.draft.draftRevisionId,
    });

    assert.equal(first.draft.draftRevisionId, duplicate.draft.draftRevisionId);
    assert.equal(stored.createdAt, "2026-07-28T00:10:00.000Z");
    assert.deepEqual(stored.validationWarnings, ["first writer"]);
    assert.equal(stored.payload.evidence[0].retrievedAt, payload.evidence[0].retrievedAt);
  });

  it("indexes every legacy semantic revision once and avoids later history scans", async () => {
    const redis = new InstrumentedRedis();
    const repository = createNewsDraftRepository(redis);
    const firstPayload = normalizedBrief();
    const secondPayload = normalizedBrief({ analystLabel: "high_alert" });
    await seedLegacyDraft(redis, {
      payload: firstPayload,
      draftRevisionId: "ndrv_legacy_first",
      draftRevisionNumber: 1,
      createdAt: "2026-07-28T00:10:00.000Z",
    });
    await seedLegacyDraft(redis, {
      payload: secondPayload,
      draftRevisionId: "ndrv_legacy_second",
      draftRevisionNumber: 2,
      createdAt: "2026-07-28T00:20:00.000Z",
    });

    const firstResubmission = await repository.saveDraft({
      payload: withRetrievedAt(firstPayload, "2026-07-28T00:35:00.000Z"),
      warnings: [],
      createdAt: "2026-07-28T00:40:00.000Z",
    });
    assert.equal(firstResubmission.status, "unchanged");
    assert.equal(firstResubmission.draft.draftRevisionId, "ndrv_legacy_first");
    assert.equal(redis.revisionScanCount("2026-07-28"), 1);

    const newDraft = await repository.saveDraft({
      payload: normalizedBrief({ analystRationale: "新的編輯內容。" }),
      warnings: [],
      createdAt: "2026-07-28T00:50:00.000Z",
    });
    assert.equal(newDraft.status, "revised");
    assert.equal(redis.revisionScanCount("2026-07-28"), 1);

    const secondResubmission = await repository.saveDraft({
      payload: withRetrievedAt(secondPayload, "2026-07-28T00:55:00.000Z"),
      warnings: [],
      createdAt: "2026-07-28T01:00:00.000Z",
    });

    assert.equal(secondResubmission.status, "unchanged");
    assert.equal(secondResubmission.draft.draftRevisionId, "ndrv_legacy_second");
    assert.equal(secondResubmission.draft.payload.evidence[0].retrievedAt, "2026-07-28T00:05:00.000Z");
    assert.equal(redis.revisionScanCount("2026-07-28"), 1);
  });

  it("marks an empty date indexed so later new content does not scan history", async () => {
    const redis = new InstrumentedRedis();
    const repository = createNewsDraftRepository(redis);

    const first = await repository.saveDraft({
      payload: normalizedBrief(),
      warnings: [],
      createdAt: "2026-07-28T00:10:00.000Z",
    });
    const second = await repository.saveDraft({
      payload: normalizedBrief({ analystLabel: "high_alert" }),
      warnings: [],
      createdAt: "2026-07-28T00:20:00.000Z",
    });

    assert.equal(first.status, "inserted");
    assert.equal(second.status, "revised");
    assert.equal(redis.revisionScanCount("2026-07-28"), 1);
  });

  it("keeps immutable revisions and returns unchanged content without resetting lifecycle", async () => {
    const repository = createNewsDraftRepository(new FakeRedis());
    const firstPayload = normalizedBrief();
    const first = await repository.saveDraft({
      payload: firstPayload,
      warnings: ["review"],
      createdAt: "2026-07-28T00:10:00.000Z",
    });
    await approveRepositoryDraft(repository, {
      briefDate: firstPayload.briefDate,
      draftRevisionId: first.draft.draftRevisionId,
      approvedAt: "2026-07-28T00:12:00.000Z",
      brief: { revisionId: "nbr_first", revisionNumber: 1 },
      dedupeWarnings: ["duplicate candidate"],
    });
    const unchanged = await repository.saveDraft({
      payload: firstPayload,
      warnings: ["review"],
      createdAt: "2026-07-28T00:15:00.000Z",
    });
    const changedPayload = normalizedBrief({ analystLabel: "high_alert" });
    const changed = await repository.saveDraft({
      payload: changedPayload,
      warnings: [],
      createdAt: "2026-07-28T00:20:00.000Z",
    });

    assert.deepEqual(
      [first.status, unchanged.status, changed.status],
      ["inserted", "unchanged", "revised"],
    );
    assert.equal(first.draft.draftRevisionNumber, 1);
    assert.equal(changed.draft.draftRevisionNumber, 2);
    assert.equal(unchanged.draft.status, "approved");
    assert.equal(unchanged.draft.approvedAt, "2026-07-28T00:12:00.000Z");
    assert.deepEqual(
      (await repository.readDraft({
        briefDate: firstPayload.briefDate,
        draftRevisionId: first.draft.draftRevisionId,
      })).payload,
      firstPayload,
    );
    assert.deepEqual(
      (await repository.readDraft({
        briefDate: firstPayload.briefDate,
        draftRevisionId: changed.draft.draftRevisionId,
      })).payload,
      changedPayload,
    );
  });

  it("records approval and rejection lifecycle metadata without mutating payload snapshots", async () => {
    const repository = createNewsDraftRepository(new FakeRedis());
    const firstPayload = normalizedBrief();
    const first = await repository.saveDraft({
      payload: firstPayload,
      warnings: ["review"],
      createdAt: "2026-07-28T00:10:00.000Z",
    });
    const secondPayload = normalizedBrief({ analystLabel: "high_alert" });
    const second = await repository.saveDraft({
      payload: secondPayload,
      warnings: [],
      createdAt: "2026-07-28T00:20:00.000Z",
    });

    const approved = await approveRepositoryDraft(repository, {
      briefDate: firstPayload.briefDate,
      draftRevisionId: first.draft.draftRevisionId,
      approvedAt: "2026-07-28T00:25:00.000Z",
      brief: { revisionId: "nbr_approved", revisionNumber: 7 },
      dedupeWarnings: ["matching title"],
    });
    const rejected = await rejectRepositoryDraft(repository, {
      briefDate: firstPayload.briefDate,
      draftRevisionId: second.draft.draftRevisionId,
      rejectedAt: "2026-07-28T00:30:00.000Z",
      rejectionReason: "Needs stronger evidence.",
    });

    assert.equal(approved.status, "approved");
    assert.equal(approved.approvedAt, "2026-07-28T00:25:00.000Z");
    assert.equal(approved.approvedBriefRevisionId, "nbr_approved");
    assert.equal(approved.approvedBriefRevisionNumber, 7);
    assert.deepEqual(approved.dedupeWarnings, ["matching title"]);
    assert.deepEqual(approved.payload, firstPayload);
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.rejectedAt, "2026-07-28T00:30:00.000Z");
    assert.equal(rejected.rejectionReason, "Needs stronger evidence.");
    assert.deepEqual(rejected.payload, secondPayload);
    const missing = await repository.markRejected({
      briefDate: firstPayload.briefDate,
      draftRevisionId: "ndrv_missing",
      reviewToken: "missing-token",
      rejectedAt: "2026-07-28T00:35:00.000Z",
      rejectionReason: "Missing",
    });
    assert.equal(missing.result, "missing");
    assert.equal(missing.draft, null);
  });

  it("selects the newest pending draft and falls back to the latest reviewed revision", async () => {
    const repository = createNewsDraftRepository(new FakeRedis());
    const firstPayload = normalizedBrief();
    const first = await repository.saveDraft({
      payload: firstPayload,
      warnings: [],
      createdAt: "2026-07-28T00:10:00.000Z",
    });
    const second = await repository.saveDraft({
      payload: normalizedBrief({ analystLabel: "high_alert" }),
      warnings: [],
      createdAt: "2026-07-28T00:20:00.000Z",
    });
    const third = await repository.saveDraft({
      payload: normalizedBrief({ analystRationale: "仍待市場數據確認。" }),
      warnings: [],
      createdAt: "2026-07-28T00:30:00.000Z",
    });

    assert.equal(
      (await repository.readDraft({ briefDate: firstPayload.briefDate })).draftRevisionId,
      third.draft.draftRevisionId,
    );
    await approveRepositoryDraft(repository, {
      briefDate: firstPayload.briefDate,
      draftRevisionId: first.draft.draftRevisionId,
      approvedAt: "2026-07-28T00:31:00.000Z",
      brief: { revisionId: "nbr_1", revisionNumber: 1 },
      dedupeWarnings: [],
    });
    await rejectRepositoryDraft(repository, {
      briefDate: firstPayload.briefDate,
      draftRevisionId: second.draft.draftRevisionId,
      rejectedAt: "2026-07-28T00:32:00.000Z",
      rejectionReason: "Not now.",
    });
    await rejectRepositoryDraft(repository, {
      briefDate: firstPayload.briefDate,
      draftRevisionId: third.draft.draftRevisionId,
      rejectedAt: "2026-07-28T00:33:00.000Z",
      rejectionReason: "Too late.",
    });
    assert.equal(
      (await repository.readDraft({ briefDate: firstPayload.briefDate })).draftRevisionId,
      third.draft.draftRevisionId,
    );
  });

  it("returns newest draft timeline rows within the requested limit", async () => {
    const repository = createNewsDraftRepository(new FakeRedis());
    await repository.saveDraft({
      payload: normalizedBrief(),
      warnings: [],
      createdAt: "2026-07-28T00:10:00.000Z",
    });
    const newerPayload = normalizedBrief({
      briefDate: "2026-07-29",
      generatedAt: "2026-07-29T00:00:00.000Z",
    });
    const newer = await repository.saveDraft({
      payload: newerPayload,
      warnings: [],
      createdAt: "2026-07-29T00:10:00.000Z",
    });

    const rows = await repository.readRecentDrafts({ limit: 1 });
    assert.deepEqual(rows.map((row) => row.draftRevisionId), [newer.draft.draftRevisionId]);
    assert.equal(rows[0].briefDate, "2026-07-29");
  });

  it("bounds a fifty-row draft timeline read inside Redis", async () => {
    const redis = new InstrumentedRedis();
    const repository = createNewsDraftRepository(redis);

    await repository.readRecentDrafts({ limit: 50 });

    const timelineKey = "jj-invest-public:dynamic-beta:news:v1:draft:timeline";
    const timelineRead = redis.zrangeCalls.findLast((call) => call.key === timelineKey);
    assert.deepEqual(timelineRead?.args, [0, 49, { rev: true }]);
  });

  it("does not let an identical resubmission overwrite a concurrent review transition", async () => {
    const repository = createNewsDraftRepository(new FakeRedis());
    const payload = normalizedBrief();
    const saved = await repository.saveDraft({
      payload,
      warnings: ["original warning"],
      createdAt: "2026-07-28T00:10:00.000Z",
    });
    const input = {
      briefDate: payload.briefDate,
      draftRevisionId: saved.draft.draftRevisionId,
      rejectedAt: "2026-07-28T00:20:00.000Z",
      rejectionReason: "Review won.",
    };
    const reviewToken = await claimRepositoryReview(repository, input, "reject");

    const [resubmitted, transition] = await Promise.all([
      repository.saveDraft({
        payload: withRetrievedAt(payload, "2026-07-28T00:30:00.000Z"),
        warnings: ["must not replace"],
        createdAt: "2026-07-28T00:30:00.000Z",
      }),
      repository.markRejected({ ...input, reviewToken }),
    ]);
    const stored = await repository.readDraft(input);

    assert.equal(resubmitted.status, "unchanged");
    assert.equal(transition.result, "rejected");
    assert.equal(stored.status, "rejected");
    assert.equal(stored.createdAt, "2026-07-28T00:10:00.000Z");
    assert.deepEqual(stored.validationWarnings, ["original warning"]);
  });

  it("uses token-safe release so an expired owner cannot clear a replacement approval claim", async () => {
    const redis = new FakeRedis();
    const repository = createNewsDraftRepository(redis);
    const payload = normalizedBrief();
    const saved = await repository.saveDraft({
      payload,
      warnings: [],
      createdAt: "2026-07-28T00:10:00.000Z",
    });
    const identity = {
      briefDate: payload.briefDate,
      draftRevisionId: saved.draft.draftRevisionId,
    };
    assert.equal((await repository.claimReview({
      ...identity,
      action: "approve",
      token: "expired-owner",
      expiresInMs: 10,
      startedAt: "2026-07-28T00:11:00.000Z",
    })).status, "acquired");
    redis.advance(11);
    assert.equal((await repository.claimReview({
      ...identity,
      action: "approve",
      token: "replacement-owner",
      expiresInMs: 10,
      startedAt: "2026-07-28T00:12:00.000Z",
    })).status, "acquired");

    assert.equal(await repository.releaseReviewClaim({
      ...identity,
      action: "approve",
      token: "expired-owner",
      clearIntent: true,
    }), "not_owner");
    assert.equal(await repository.beginPublication({
      ...identity,
      reviewToken: "replacement-owner",
      publicationStartedAt: "2026-07-28T00:12:30.000Z",
    }), "publishing");
    assert.equal(await repository.recordPublication({
      ...identity,
      reviewToken: "replacement-owner",
      recordedAt: "2026-07-28T00:12:45.000Z",
      brief: { revisionId: "nbr_recovered", revisionNumber: 1 },
      dedupeWarnings: [],
    }), "published");
    const approved = await repository.markApproved({
      ...identity,
      reviewToken: "replacement-owner",
      approvedAt: "2026-07-28T00:13:00.000Z",
      brief: { revisionId: "nbr_recovered", revisionNumber: 1 },
      dedupeWarnings: [],
    });
    assert.equal(approved.result, "approved");
    assert.equal(approved.draft.status, "approved");
  });

  // Mutation caught: treating a safely expired pre-publication approval claim as irreversible.
  it("lets rejection take over after an approval claim expires before publication begins", async () => {
    const redis = new FakeRedis();
    const repository = createNewsDraftRepository(redis);
    const payload = normalizedBrief();
    const saved = await repository.saveDraft({
      payload,
      warnings: [],
      createdAt: "2026-07-28T00:10:00.000Z",
    });
    const identity = {
      briefDate: payload.briefDate,
      draftRevisionId: saved.draft.draftRevisionId,
    };

    assert.equal((await repository.claimReview({
      ...identity,
      action: "approve",
      token: "approval-owner-that-died",
      expiresInMs: 10,
      startedAt: "2026-07-28T00:11:00.000Z",
    })).status, "acquired");
    redis.advance(11);

    const rejectionClaim = await repository.claimReview({
      ...identity,
      action: "reject",
      token: "replacement-rejection-owner",
      expiresInMs: 10,
      startedAt: "2026-07-28T00:12:00.000Z",
    });
    assert.equal(rejectionClaim.status, "acquired");
    const rejected = await repository.markRejected({
      ...identity,
      reviewToken: "replacement-rejection-owner",
      rejectedAt: "2026-07-28T00:13:00.000Z",
      rejectionReason: "Approval never reached publication.",
    });
    assert.equal(rejected.result, "rejected");
    assert.equal(rejected.draft.status, "rejected");
  });

  it("does not move the current reviewed draft when an older revision is resubmitted", async () => {
    const repository = createNewsDraftRepository(new FakeRedis());
    const firstPayload = normalizedBrief();
    const first = await repository.saveDraft({
      payload: firstPayload,
      warnings: [],
      createdAt: "2026-07-28T00:10:00.000Z",
    });
    const second = await repository.saveDraft({
      payload: normalizedBrief({ analystLabel: "high_alert" }),
      warnings: [],
      createdAt: "2026-07-28T00:20:00.000Z",
    });
    await rejectRepositoryDraft(repository, {
      briefDate: firstPayload.briefDate,
      draftRevisionId: first.draft.draftRevisionId,
      rejectedAt: "2026-07-28T00:25:00.000Z",
      rejectionReason: "Superseded.",
    });
    await approveRepositoryDraft(repository, {
      briefDate: firstPayload.briefDate,
      draftRevisionId: second.draft.draftRevisionId,
      approvedAt: "2026-07-28T00:30:00.000Z",
      brief: { revisionId: "nbr_current", revisionNumber: 2 },
      dedupeWarnings: [],
    });

    const resubmitted = await repository.saveDraft({
      payload: firstPayload,
      warnings: ["ignored"],
      createdAt: "2026-07-28T00:35:00.000Z",
    });

    assert.equal(resubmitted.status, "unchanged");
    assert.equal(resubmitted.draft.status, "rejected");
    assert.equal(
      (await repository.readDraft({ briefDate: firstPayload.briefDate })).draftRevisionId,
      second.draft.draftRevisionId,
    );
  });

  it("preserves an approved lifecycle result across repeated and incompatible review actions", async () => {
    const repository = createNewsDraftRepository(new FakeRedis());
    const payload = normalizedBrief();
    const saved = await repository.saveDraft({
      payload,
      warnings: [],
      createdAt: "2026-07-28T00:10:00.000Z",
    });
    const reviewToken = await claimRepositoryReview(repository, {
      briefDate: payload.briefDate,
      draftRevisionId: saved.draft.draftRevisionId,
      approvedAt: "2026-07-28T00:20:00.000Z",
    }, "approve");
    assert.equal(await repository.beginPublication({
      briefDate: payload.briefDate,
      draftRevisionId: saved.draft.draftRevisionId,
      reviewToken,
      publicationStartedAt: "2026-07-28T00:20:00.000Z",
    }), "publishing");
    assert.equal(await repository.recordPublication({
      briefDate: payload.briefDate,
      draftRevisionId: saved.draft.draftRevisionId,
      reviewToken,
      recordedAt: "2026-07-28T00:20:00.000Z",
      brief: { revisionId: "nbr_original", revisionNumber: 1 },
      dedupeWarnings: ["first warning"],
    }), "published");
    const firstApproval = await repository.markApproved({
      briefDate: payload.briefDate,
      draftRevisionId: saved.draft.draftRevisionId,
      reviewToken,
      approvedAt: "2026-07-28T00:20:00.000Z",
      brief: { revisionId: "nbr_original", revisionNumber: 1 },
      dedupeWarnings: ["first warning"],
    });
    const repeatedApproval = await repository.markApproved({
      briefDate: payload.briefDate,
      draftRevisionId: saved.draft.draftRevisionId,
      reviewToken,
      approvedAt: "2026-07-28T00:30:00.000Z",
      brief: { revisionId: "nbr_replaced", revisionNumber: 2 },
      dedupeWarnings: ["replacement warning"],
    });
    const rejected = await repository.markRejected({
      briefDate: payload.briefDate,
      draftRevisionId: saved.draft.draftRevisionId,
      reviewToken,
      rejectedAt: "2026-07-28T00:40:00.000Z",
      rejectionReason: "Must not replace approval.",
    });

    assert.equal(firstApproval.result, "approved");
    assert.equal(repeatedApproval.result, "claim_lost");
    assert.equal(rejected.result, "claim_lost");
    assert.deepEqual(repeatedApproval.draft, firstApproval.draft);
    assert.deepEqual(rejected.draft, firstApproval.draft);
  });
});

describe("dynamic beta news draft lifecycle service", () => {
  it("honors a requested collection limit of fifty", async () => {
    let repositoryLimit = null;
    const service = createNewsDraftService({
      draftRepository: {
        async readRecentDrafts({ limit }) {
          repositoryLimit = limit;
          return [];
        },
      },
      newsEventService: {},
    });

    await service.list({ limit: 50 });

    assert.equal(repositoryLimit, 50);
  });

  it("holds an approval claim across publication so a racing rejection cannot win", async () => {
    const repository = createNewsDraftRepository(new FakeRedis());
    const ingestEntered = deferred();
    const finishIngest = deferred();
    const service = draftService(repository, {
      async ingest() {
        ingestEntered.resolve();
        await finishIngest.promise;
        return {
          saved: true,
          dedupeWarnings: [],
          brief: { revisionId: "nbr_race_approved", revisionNumber: 1 },
        };
      },
    });
    const created = await service.create(morningBrief());
    const input = {
      briefDate: "2026-07-28",
      draftRevisionId: created.draft.draftRevisionId,
    };

    const approval = service.approve(input);
    await ingestEntered.promise;
    await assert.rejects(service.reject(input), NewsDraftConflictError);
    finishIngest.resolve();

    assert.equal((await approval).draft.status, "approved");
    assert.equal((await repository.readDraft(input)).status, "approved");
  });

  it("keeps a durable approval intent after claim expiry so rejection cannot contradict a publish", async () => {
    const redis = new FakeRedis();
    const repository = createNewsDraftRepository(redis);
    const ingestEntered = deferred();
    const finishIngest = deferred();
    let tokenNumber = 0;
    const service = createNewsDraftService({
      draftRepository: repository,
      newsEventService: {
        async validate(payload) {
          return validateMorningBriefPayload(payload, {
            now: "2026-07-28T00:05:00.000Z",
          });
        },
        async ingest() {
          ingestEntered.resolve();
          await finishIngest.promise;
          return {
            saved: true,
            dedupeWarnings: [],
            brief: { revisionId: "nbr_expired_claim", revisionNumber: 1 },
          };
        },
      },
      now: () => new Date("2026-07-28T00:10:00.000Z"),
      reviewClaimTtlMs: 50,
      reviewToken: () => `review-token-${++tokenNumber}`,
    });
    const created = await service.create(morningBrief());
    const input = {
      briefDate: "2026-07-28",
      draftRevisionId: created.draft.draftRevisionId,
    };

    const approval = service.approve(input);
    await ingestEntered.promise;
    redis.advance(51);
    await assert.rejects(service.reject(input), NewsDraftConflictError);
    finishIngest.resolve();

    const result = await approval;
    assert.equal(result.draft.status, "approved");
    assert.equal(result.brief.revisionId, "nbr_expired_claim");
  });

  it("holds a rejection claim so a racing approval cannot publish", async () => {
    const repository = createNewsDraftRepository(new FakeRedis());
    const rejectionEntered = deferred();
    const finishRejection = deferred();
    const markRejected = repository.markRejected.bind(repository);
    repository.markRejected = async (input) => {
      rejectionEntered.resolve();
      await finishRejection.promise;
      return markRejected(input);
    };
    let ingestCalls = 0;
    const service = draftService(repository, {
      async ingest() {
        ingestCalls += 1;
        return {
          saved: true,
          dedupeWarnings: [],
          brief: { revisionId: "nbr_must_not_publish", revisionNumber: 1 },
        };
      },
    });
    const created = await service.create(morningBrief());
    const input = {
      briefDate: "2026-07-28",
      draftRevisionId: created.draft.draftRevisionId,
    };

    const rejection = service.reject(input);
    await rejectionEntered.promise;
    await assert.rejects(service.approve(input), NewsDraftConflictError);
    finishRejection.resolve();

    assert.equal((await rejection).draft.status, "rejected");
    assert.equal(ingestCalls, 0);
  });

  it("reuses the semantic draft revision when only evidence retrieval time changes", async () => {
    const redis = new FakeRedis();
    const repository = createNewsDraftRepository(redis);
    let validationNow = "2026-07-28T00:05:00.000Z";
    let draftNow = "2026-07-28T00:10:00.000Z";
    const service = createNewsDraftService({
      draftRepository: repository,
      newsEventService: createNewsEventService({
        repository: createNewsRepository(redis),
        now: () => new Date(validationNow),
      }),
      now: () => new Date(draftNow),
    });

    const first = await service.create(morningBrief());
    validationNow = "2026-07-28T00:35:00.000Z";
    draftNow = "2026-07-28T00:40:00.000Z";
    const resubmitted = await service.create(morningBrief());
    const revisions = await repository.readRecentDrafts({ limit: 20 });

    assert.equal(first.status, "inserted");
    assert.equal(resubmitted.status, "unchanged");
    assert.equal(resubmitted.draft.draftRevisionId, first.draft.draftRevisionId);
    assert.equal(resubmitted.draft.payload.evidence[0].retrievedAt, "2026-07-28T00:05:00.000Z");
    assert.equal(revisions.length, 1);
  });

  it("keeps invalid drafts out of storage and lists a normalized pending draft", async () => {
    const repository = createNewsDraftRepository(new FakeRedis());
    const service = draftService(repository);

    const invalid = await service.create({ events: [] });
    assert.equal(invalid.saved, false);
    assert.equal((await repository.readRecentDrafts()).length, 0);

    const created = await service.create(morningBrief());
    assert.equal(created.saved, true);
    assert.equal(created.draft.status, "pending");
    assert.equal(created.draft.createdAt, "2026-07-28T00:10:00.000Z");
    assert.equal(
      (await service.list({ briefDate: "2026-07-28" })).draftRevisionId,
      created.draft.draftRevisionId,
    );
    assert.equal(
      (await service.list({
        briefDate: "2026-07-28",
        draftRevisionId: created.draft.draftRevisionId,
      })).draftRevisionId,
      created.draft.draftRevisionId,
    );
  });

  it("approves an exact pending draft once and returns its recorded result on retry", async () => {
    const repository = createNewsDraftRepository(new FakeRedis());
    let ingestCalls = 0;
    const service = draftService(repository, {
      async ingest() {
        ingestCalls += 1;
        return {
          saved: true,
          valid: true,
          errors: [],
          warnings: [],
          dedupeWarnings: ["matching evidence"],
          brief: { revisionId: "nbr_approved", revisionNumber: 7 },
        };
      },
    });
    const created = await service.create(morningBrief());

    const approved = await service.approve({
      briefDate: "2026-07-28",
      draftRevisionId: created.draft.draftRevisionId,
    });
    const repeated = await service.approve({
      briefDate: "2026-07-28",
      draftRevisionId: created.draft.draftRevisionId,
    });

    assert.equal(approved.draft.status, "approved");
    assert.equal(approved.brief.revisionId, "nbr_approved");
    assert.deepEqual(approved.draft.dedupeWarnings, ["matching evidence"]);
    assert.equal(repeated.alreadyApproved, true);
    assert.equal(repeated.brief.revisionId, "nbr_approved");
    assert.equal(ingestCalls, 1);
    await assert.rejects(
      service.reject({ briefDate: "2026-07-28", draftRevisionId: created.draft.draftRevisionId }),
      NewsDraftConflictError,
    );
    await assert.rejects(
      service.approve({ briefDate: "2026-07-28", draftRevisionId: "ndrv_missing" }),
      NewsDraftNotFoundError,
    );
  });

  it("rejects only exact pending drafts and bounds a trimmed reason without publishing", async () => {
    const repository = createNewsDraftRepository(new FakeRedis());
    let ingestCalls = 0;
    const service = draftService(repository, {
      async ingest() {
        ingestCalls += 1;
        return { saved: true, brief: { revisionId: "nbr_unused", revisionNumber: 1 } };
      },
    });
    const created = await service.create(morningBrief());

    const rejected = await service.reject({
      briefDate: "2026-07-28",
      draftRevisionId: created.draft.draftRevisionId,
      reason: "  Needs stronger evidence.  ",
    });
    assert.equal(rejected.draft.status, "rejected");
    assert.equal(rejected.draft.rejectionReason, "Needs stronger evidence.");
    assert.equal(ingestCalls, 0);
    await assert.rejects(
      service.approve({ briefDate: "2026-07-28", draftRevisionId: created.draft.draftRevisionId }),
      NewsDraftConflictError,
    );
    const pending = await service.create(morningBrief({ analystLabel: "high_alert" }));
    await assert.rejects(
      service.reject({
        briefDate: "2026-07-28",
        draftRevisionId: pending.draft.draftRevisionId,
        reason: "x".repeat(301),
      }),
      NewsDraftConflictError,
    );
    assert.equal(
      (await repository.readDraft({
        briefDate: "2026-07-28",
        draftRevisionId: pending.draft.draftRevisionId,
      })).status,
      "pending",
    );
    await assert.rejects(
      service.reject({ briefDate: "2026-07-28", draftRevisionId: "ndrv_missing" }),
      NewsDraftNotFoundError,
    );
  });

  it("does not publish terminal drafts or mark a failed publication as approved", async () => {
    const repository = createNewsDraftRepository(new FakeRedis());
    let ingestCalls = 0;
    const service = draftService(repository, {
      async ingest() {
        ingestCalls += 1;
        throw new Error("publication unavailable");
      },
    });
    const created = await service.create(morningBrief());

    await assert.rejects(
      service.approve({ briefDate: "2026-07-28", draftRevisionId: created.draft.draftRevisionId }),
      /publication unavailable/,
    );
    assert.equal(
      (await repository.readDraft({
        briefDate: "2026-07-28",
        draftRevisionId: created.draft.draftRevisionId,
      })).status,
      "pending",
    );
    assert.equal(ingestCalls, 1);
  });

  // Mutation caught: clearing an irreversible publication phase after a later validation failure.
  it("blocks rejection after a committed response-loss publish and recovers despite an invalid retry", async () => {
    const redis = new FakeRedis();
    const draftRepository = createNewsDraftRepository(redis);
    const newsRepository = createNewsRepository(redis);
    const baseNewsEventService = createNewsEventService({
      repository: newsRepository,
      now: () => new Date("2026-07-28T00:05:00.000Z"),
    });
    let validationCalls = 0;
    let recoveryAvailable = false;
    let committedBrief = null;
    const service = createNewsDraftService({
      draftRepository,
      newsEventService: {
        async validate(payload) {
          validationCalls += 1;
          if (validationCalls === 3) {
            return { valid: false, saved: false, errors: ["deployed schema changed"], warnings: [] };
          }
          return baseNewsEventService.validate(payload);
        },
        async ingest(payload) {
          const published = await baseNewsEventService.ingest(payload);
          committedBrief = published.brief;
          throw new Error("publication response lost");
        },
        async findPublishedBrief(payload) {
          if (!recoveryAvailable) return null;
          return baseNewsEventService.findPublishedBrief(payload);
        },
      },
      now: () => new Date("2026-07-28T00:10:00.000Z"),
      reviewClaimTtlMs: 10,
      reviewToken: (() => {
        let sequence = 0;
        return () => `response-loss-token-${++sequence}`;
      })(),
    });
    const created = await service.create(morningBrief());
    const request = {
      briefDate: "2026-07-28",
      draftRevisionId: created.draft.draftRevisionId,
    };

    await assert.rejects(service.approve(request), /publication response lost/);
    assert.ok(committedBrief?.revisionId);
    assert.equal((await draftRepository.readDraft(request)).status, "pending");

    redis.advance(11);
    const invalidRetry = await service.approve(request);
    assert.equal(invalidRetry.saved, false);
    await assert.rejects(service.reject(request), NewsDraftConflictError);

    recoveryAvailable = true;
    const recovered = await service.approve(request);
    assert.equal(recovered.draft.status, "approved");
    assert.equal(recovered.brief.revisionId, committedBrief.revisionId);
    assert.equal((await newsRepository.readRecentBriefs({ limit: 20 })).length, 1);
  });

  // Mutation caught: clearing an existing ambiguous publication phase when a retry returns saved:false.
  it("keeps rejection blocked across a saved-false retry and finalizes the committed identity", async () => {
    const redis = new FakeRedis();
    const draftRepository = createNewsDraftRepository(redis);
    const newsRepository = createNewsRepository(redis);
    const baseNewsEventService = createNewsEventService({
      repository: newsRepository,
      now: () => new Date("2026-07-28T00:05:00.000Z"),
    });
    let ingestCalls = 0;
    let recoveryAvailable = false;
    let committedBrief = null;
    const service = createNewsDraftService({
      draftRepository,
      newsEventService: {
        validate: (payload) => baseNewsEventService.validate(payload),
        async ingest(payload) {
          ingestCalls += 1;
          if (ingestCalls === 1) {
            const published = await baseNewsEventService.ingest(payload);
            committedBrief = published.brief;
            throw new Error("publication response lost");
          }
          return { saved: false, valid: false, errors: ["later ingestion rejected"], warnings: [] };
        },
        async findPublishedBrief(payload) {
          if (!recoveryAvailable) return null;
          return baseNewsEventService.findPublishedBrief(payload);
        },
      },
      now: () => new Date("2026-07-28T00:10:00.000Z"),
      reviewToken: (() => {
        let sequence = 0;
        return () => `saved-false-token-${++sequence}`;
      })(),
    });
    const created = await service.create(morningBrief());
    const request = {
      briefDate: "2026-07-28",
      draftRevisionId: created.draft.draftRevisionId,
    };

    await assert.rejects(service.approve(request), /publication response lost/);
    const failedRetry = await service.approve(request);
    assert.equal(failedRetry.saved, false);
    assert.equal(ingestCalls, 2);
    await assert.rejects(service.reject(request), NewsDraftConflictError);

    recoveryAvailable = true;
    const recovered = await service.approve(request);
    assert.equal(recovered.draft.status, "approved");
    assert.equal(recovered.brief.revisionId, committedBrief.revisionId);
    assert.equal(ingestCalls, 2);
  });

  it("recovers a failed approval status write without creating a second morning-brief revision", async () => {
    const redis = new FakeRedis();
    const repository = createNewsDraftRepository(redis);
    const originalMarkApproved = repository.markApproved.bind(repository);
    let markFailures = 1;
    repository.markApproved = async (input) => {
      if (markFailures > 0) {
        markFailures -= 1;
        throw new Error("status write unavailable");
      }
      return originalMarkApproved(input);
    };
    const newsRepository = createNewsRepository(redis);
    const newsEventService = createNewsEventService({
      repository: newsRepository,
      now: () => new Date("2026-07-28T00:05:00.000Z"),
    });
    const service = createNewsDraftService({
      draftRepository: repository,
      newsEventService,
      now: () => new Date("2026-07-28T00:10:00.000Z"),
    });
    const created = await service.create(morningBrief());
    const request = { briefDate: "2026-07-28", draftRevisionId: created.draft.draftRevisionId };

    await assert.rejects(service.approve(request), /status write unavailable/);
    const firstPublished = await newsRepository.readMorningBrief({ briefDate: "2026-07-28" });
    const recovered = await service.approve(request);
    const persisted = await newsRepository.readRecentBriefs({ limit: 20 });

    assert.equal(recovered.draft.status, "approved");
    assert.equal(recovered.brief.revisionId, firstPublished.revisionId);
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].revisionId, firstPublished.revisionId);
  });
});
