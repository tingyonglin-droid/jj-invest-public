import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildConfirmationSnapshot } from "../src/lib/dynamic-beta/news/confirmation-snapshot.js";
import { createConfirmationSnapshotRepository } from "../src/lib/dynamic-beta/news/confirmation-snapshot-repository.js";
import { FakeRedis } from "./helpers/news-fake-redis.js";

const PREFIX = "jj-invest-public:dynamic-beta:news:v1:confirmation-snapshot";
const BRIEF_DATE = "2026-07-27";
const REVISION_ID = "nbr_current";
const FIRST_AS_OF = "2026-07-29";
const SECOND_AS_OF = "2026-07-30";

function snapshot({
  asOf = FIRST_AS_OF,
  headline = "Initial confirmation",
  createdAt = `${asOf}T23:00:10.000Z`,
} = {}) {
  return buildConfirmationSnapshot({
    evaluation: {
      briefDate: BRIEF_DATE,
      revisionId: REVISION_ID,
      revisionNumber: 2,
      asOf,
      evaluatedAt: `${asOf}T22:00:00.000Z`,
      events: [{
        rank: 1,
        headline,
        marketDate: BRIEF_DATE,
        rules: [],
        d1: { status: "confirmed", reason: "majority_confirmed" },
        d3: { status: "confirmed", reason: "majority_confirmed" },
        persistence: "sustained",
      }],
    },
    createdAt,
  });
}

function identity(asOf = FIRST_AS_OF) {
  return { briefDate: BRIEF_DATE, revisionId: REVISION_ID, asOf };
}

function revisionKey(value) {
  return `${PREFIX}:revision:${value.briefDate}:${value.revisionId}:${value.asOf}:${value.snapshotId}`;
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, nested]) => [key, reverseObjectKeys(nested)]),
  );
}

function applyUpstashAutomaticDeserialization(redis) {
  for (const [key, row] of redis.hashes.entries()) {
    const deserialized = Object.fromEntries(Object.entries(row).map(([field, value]) => {
      if (typeof value !== "string") return [field, value];
      try {
        return [field, reverseObjectKeys(JSON.parse(value))];
      } catch {
        return [field, value];
      }
    }));
    redis.hashes.set(key, deserialized);
  }
}

async function upstashReadFixture() {
  const redis = new FakeRedis();
  const repository = createConfirmationSnapshotRepository(redis);
  const first = snapshot();
  await repository.saveSnapshot(first);
  applyUpstashAutomaticDeserialization(redis);
  return { redis, repository, first };
}

describe("dynamic beta confirmation snapshot repository", () => {
  // Mutation caught: always allocating a new revision for an identical snapshot ID.
  it("keeps identical writes unchanged and appends immutable changed revisions per as-of date", async () => {
    const repository = createConfirmationSnapshotRepository(new FakeRedis());
    const first = snapshot();

    assert.deepEqual(await repository.saveSnapshot(first), {
      status: "inserted",
      snapshotId: first.snapshotId,
      snapshotRevisionNumber: 1,
    });
    assert.deepEqual(await repository.saveSnapshot(first), {
      status: "unchanged",
      snapshotId: first.snapshotId,
      snapshotRevisionNumber: 1,
    });
    assert.equal((await repository.readSnapshotRevisions(identity())).length, 1);

    const changed = snapshot({ headline: "Revised confirmation" });
    assert.deepEqual(await repository.saveSnapshot(changed), {
      status: "revised",
      snapshotId: changed.snapshotId,
      snapshotRevisionNumber: 2,
    });
    assert.deepEqual(await repository.readLatestSnapshot(identity()), {
      ...changed,
      snapshotRevisionNumber: 2,
    });
    assert.deepEqual(await repository.saveSnapshot(first), {
      status: "unchanged",
      snapshotId: first.snapshotId,
      snapshotRevisionNumber: 1,
    });
    assert.deepEqual(await repository.readLatestSnapshot(identity()), {
      ...changed,
      snapshotRevisionNumber: 2,
    });
    assert.deepEqual(await repository.readSnapshotRevisions(identity()), [
      { ...first, snapshotRevisionNumber: 1 },
      { ...changed, snapshotRevisionNumber: 2 },
    ]);

    const nextDay = snapshot({ asOf: SECOND_AS_OF, headline: "Next-day confirmation" });
    assert.deepEqual(await repository.saveSnapshot(nextDay), {
      status: "inserted",
      snapshotId: nextDay.snapshotId,
      snapshotRevisionNumber: 1,
    });
    assert.deepEqual(
      await repository.readLatestSnapshot({ briefDate: BRIEF_DATE, revisionId: REVISION_ID }),
      { ...nextDay, snapshotRevisionNumber: 1 },
    );
    assert.deepEqual(await repository.readLatestSnapshot(identity()), {
      ...changed,
      snapshotRevisionNumber: 2,
    });
  });

  // Mutation caught: parsing records without enforcing committed === "1", or limiting before filtering.
  it("ignores uncommitted records in exact, revision, latest-across-date, and recent reads", async () => {
    const redis = new FakeRedis();
    const repository = createConfirmationSnapshotRepository(redis);
    const first = snapshot();
    const nextDay = snapshot({ asOf: SECOND_AS_OF, headline: "Next-day confirmation" });
    await repository.saveSnapshot(first);
    await repository.saveSnapshot(nextDay);
    assert.deepEqual(await repository.readRecentLatestSnapshots({
      since: FIRST_AS_OF,
      until: SECOND_AS_OF,
      limit: 1,
    }), [{ ...nextDay, snapshotRevisionNumber: 1 }]);
    await redis.hset(revisionKey(nextDay), { committed: "0" });

    assert.equal(await repository.readLatestSnapshot(identity(SECOND_AS_OF)), null);
    assert.deepEqual(await repository.readSnapshotRevisions(identity(SECOND_AS_OF)), []);
    assert.deepEqual(
      await repository.readLatestSnapshot({ briefDate: BRIEF_DATE, revisionId: REVISION_ID }),
      { ...first, snapshotRevisionNumber: 1 },
    );
    assert.deepEqual(await repository.readRecentLatestSnapshots({
      since: FIRST_AS_OF,
      until: SECOND_AS_OF,
      limit: 1,
    }), [{ ...first, snapshotRevisionNumber: 1 }]);
  });

  // Mutation caught: passing Upstash's reordered object payload directly to an order-sensitive parser.
  it("reads an exact latest snapshot after Upstash reorders top-level and nested object keys", async () => {
    const { repository, first } = await upstashReadFixture();

    assert.deepEqual(await repository.readLatestSnapshot(identity()), {
      ...first,
      snapshotRevisionNumber: 1,
    });
  });

  // Mutation caught: discarding automatically deserialized payload objects while scanning revision history.
  it("reads snapshot revisions from Upstash automatic-deserialization fields", async () => {
    const { repository, first } = await upstashReadFixture();

    assert.deepEqual(await repository.readSnapshotRevisions(identity()), [{
      ...first,
      snapshotRevisionNumber: 1,
    }]);
  });

  // Mutation caught: filtering automatically deserialized records before recent-read limiting.
  it("reads recent latest snapshots from Upstash automatic-deserialization fields", async () => {
    const { repository, first } = await upstashReadFixture();

    assert.deepEqual(await repository.readRecentLatestSnapshots({
      since: FIRST_AS_OF,
      until: FIRST_AS_OF,
      limit: 1,
    }), [{ ...first, snapshotRevisionNumber: 1 }]);
  });

  // Mutation caught: trusting a deserialized object payload without the existing content-hash checks.
  it("keeps strict content validation for Upstash object payloads", async () => {
    const { redis, repository, first } = await upstashReadFixture();
    const key = revisionKey(first);
    const row = await redis.hgetall(key);
    await redis.hset(key, {
      payload: { ...row.payload, snapshotId: "ncs_tampered" },
    });

    assert.equal(await repository.readLatestSnapshot(identity()), null);
    assert.deepEqual(await repository.readSnapshotRevisions(identity()), []);
    assert.deepEqual(await repository.readRecentLatestSnapshots({
      since: FIRST_AS_OF,
      until: FIRST_AS_OF,
      limit: 1,
    }), []);
  });

  // Mutation caught: issuing Redis reads before rejecting incomplete identities or invalid date keys.
  it("validates every read boundary before accessing Redis", async () => {
    const redis = new FakeRedis();
    redis.hgetall = async () => { throw new Error("unexpected Redis read"); };
    redis.zrange = async () => { throw new Error("unexpected Redis read"); };
    const repository = createConfirmationSnapshotRepository(redis);

    assert.equal(await repository.readLatestSnapshot({ briefDate: "2026-07-32", revisionId: REVISION_ID }), null);
    assert.equal(await repository.readLatestSnapshot({ briefDate: BRIEF_DATE, revisionId: "" }), null);
    assert.equal(await repository.readLatestSnapshot({
      briefDate: BRIEF_DATE,
      revisionId: REVISION_ID,
      asOf: "not-a-date",
    }), null);
    assert.deepEqual(await repository.readSnapshotRevisions({
      briefDate: BRIEF_DATE,
      revisionId: REVISION_ID,
      asOf: "2026-02-30",
    }), []);
    assert.deepEqual(await repository.readRecentLatestSnapshots({
      since: "2026-07-32",
      until: SECOND_AS_OF,
      limit: 10,
    }), []);
    assert.deepEqual(await repository.readRecentLatestSnapshots({
      since: FIRST_AS_OF,
      until: "bad-date",
      limit: 10,
    }), []);
  });

  // Mutation caught: treating a failed eval as a successful or partially visible save.
  it("keeps an injected failed append invisible and allows a clean retry", async () => {
    const redis = new FakeRedis();
    const repository = createConfirmationSnapshotRepository(redis);
    const first = snapshot();
    redis.failNextEval("jj-news-confirmation-snapshot-save-v1");

    await assert.rejects(repository.saveSnapshot(first), /forced/);
    assert.equal(await repository.readLatestSnapshot(identity()), null);
    assert.equal((await repository.saveSnapshot(first)).status, "inserted");
  });

  // Mutation caught: setting committed before an index/pointer operation that can still fail.
  it("keeps a real Lua runtime-error append uncommitted until a successful retry", async () => {
    const redis = new FakeRedis();
    const repository = createConfirmationSnapshotRepository(redis);
    const first = snapshot();
    await redis.set(`${PREFIX}:timeline`, "poisoned");

    await assert.rejects(repository.saveSnapshot(first), /WRONGTYPE/);
    assert.equal((await redis.hgetall(revisionKey(first))).committed, "0");
    await redis.del(`${PREFIX}:timeline`);

    assert.equal(await repository.readLatestSnapshot(identity()), null);
    assert.equal(
      await repository.readLatestSnapshot({ briefDate: BRIEF_DATE, revisionId: REVISION_ID }),
      null,
    );
    assert.deepEqual(await repository.readSnapshotRevisions(identity()), []);
    assert.deepEqual(await repository.readRecentLatestSnapshots({
      since: FIRST_AS_OF,
      until: FIRST_AS_OF,
      limit: 1,
    }), []);

    assert.deepEqual(await repository.saveSnapshot(first), {
      status: "inserted",
      snapshotId: first.snapshotId,
      snapshotRevisionNumber: 1,
    });
    assert.deepEqual(await repository.saveSnapshot(first), {
      status: "unchanged",
      snapshotId: first.snapshotId,
      snapshotRevisionNumber: 1,
    });
  });

  // Mutation caught: non-atomic read/increment/write allocation that gives concurrent appends one number.
  it("serializes concurrent same-day appends into distinct immutable revisions", async () => {
    const redis = new FakeRedis();
    const repository = createConfirmationSnapshotRepository(redis);
    const first = snapshot({ headline: "Concurrent first" });
    const second = snapshot({ headline: "Concurrent second" });

    const saved = await Promise.all([
      repository.saveSnapshot(first),
      repository.saveSnapshot(second),
    ]);

    assert.deepEqual(new Set(saved.map((result) => result.snapshotRevisionNumber)), new Set([1, 2]));
    assert.deepEqual(await repository.readSnapshotRevisions(identity()), [
      { ...first, snapshotRevisionNumber: 1 },
      { ...second, snapshotRevisionNumber: 2 },
    ]);
    assert.deepEqual(await repository.readLatestSnapshot(identity()), {
      ...second,
      snapshotRevisionNumber: 2,
    });
  });
});
