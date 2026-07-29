import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createNewsDraftRepository } from "../src/lib/dynamic-beta/news/draft-repository.js";
import { createNewsRepository } from "../src/lib/dynamic-beta/news/repository.js";
import {
  runRedisScript,
  SAVE_CONFIRMATION_SNAPSHOT_SCRIPT,
  SAVE_NEWS_BRIEF_SCRIPT,
  SAVE_NEWS_DRAFT_SCRIPT,
} from "../src/lib/dynamic-beta/news/redis-atomic.js";
import { validateMorningBriefPayload } from "../src/lib/dynamic-beta/news/schema.js";
import { FakeRedis } from "./helpers/news-fake-redis.js";

const BRIEF_DATE = "2026-07-28";
const CREATED_AT = "2026-07-28T00:10:00.000Z";
const CREATED_SCORE = Date.parse(CREATED_AT);

function morningBrief() {
  return {
    briefDate: BRIEF_DATE,
    generatedAt: "2026-07-28T00:00:00.000Z",
    analystLabel: "risk_elevated",
    analystRationale: "Waiting for confirmation.",
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
      transmissionPath: ["event", "market", "asset"],
      affectedAssets: ["SPY"],
      marketDate: BRIEF_DATE,
      dataToConfirm: ["YAHOO:SPY"],
      confirmationRules: [{
        seriesId: "YAHOO:SPY",
        expectedDirection: "down",
        changeType: "percent",
        threshold: 1,
      }],
      interpretation: "Waiting for confirmation.",
      confidence: 0.7,
    })),
  };
}

function normalizedBrief() {
  const result = validateMorningBriefPayload(morningBrief(), {
    now: "2026-07-28T00:05:00.000Z",
  });
  assert.equal(result.valid, true);
  return result.value;
}

function briefScriptInput(label) {
  const revisionId = `nbr_${label}`;
  return {
    keys: [
      `brief:${label}:current`,
      `brief:${label}:revision:${revisionId}`,
      `brief:${label}:revisions`,
      `brief:${label}:timeline`,
      `brief:${label}:counter`,
    ],
    args: [
      revisionId,
      BRIEF_DATE,
      String(CREATED_SCORE),
      JSON.stringify({ briefDate: BRIEF_DATE }),
      `${BRIEF_DATE}:${revisionId}`,
    ],
  };
}

function draftScriptInput(label) {
  const draftRevisionId = `ndrv_${label}`;
  const revisionKey = `draft:${label}:revision:${draftRevisionId}`;
  return {
    keys: [
      `draft:${label}:current`,
      revisionKey,
      `draft:${label}:revisions`,
      `draft:${label}:counter`,
      `draft:${label}:semantic-index`,
      `draft:${label}:timeline`,
      `draft:${label}:semantic-index-ready`,
      revisionKey,
    ],
    args: [
      draftRevisionId,
      BRIEF_DATE,
      CREATED_AT,
      String(CREATED_SCORE),
      "[]",
      JSON.stringify({ briefDate: BRIEF_DATE }),
      String(CREATED_SCORE),
    ],
  };
}

function confirmationSnapshotScriptInput(label) {
  const snapshotId = `ncs_${label}`;
  const asOf = "2026-07-29";
  const asOfScore = Date.parse(`${asOf}T00:00:00.000Z`);
  const scope = `snapshot:${label}`;
  return {
    snapshotId,
    asOf,
    asOfScore,
    timelineMember: `${BRIEF_DATE}:nbr_current:${asOf}`,
    keys: [
      `${scope}:revision:${snapshotId}`,
      `${scope}:revisions`,
      `${scope}:latest`,
      `${scope}:revision-count`,
      `${scope}:dates`,
      "snapshot:timeline",
    ],
    args: [
      snapshotId,
      String(asOfScore),
      asOf,
      JSON.stringify({ snapshotId, snapshotRevisionNumber: null }),
      `${BRIEF_DATE}:nbr_current:${asOf}`,
    ],
  };
}

async function seedTwoMembers(redis, key) {
  await redis.zadd(key, { score: 1, member: "first" });
  await redis.zadd(key, { score: 2, member: "second" });
}

function commandScript(body) {
  return `-- jj-news-lua-command-contract-v1\n${body}`;
}

function runCommandScript(redis, body) {
  return runRedisScript(redis, commandScript(body), [], []);
}

describe("dynamic beta production Redis Lua boundary", () => {
  // Mutation caught: replacing production Lua with invalid text while retaining its recognized marker.
  it("rejects invalid Lua even when the production marker is recognized", async () => {
    const redis = new FakeRedis();
    const input = briefScriptInput("invalid");
    const invalidScript = `-- jj-news-brief-save-v1\nthis is not valid Lua !!!`;

    await assert.rejects(
      runRedisScript(redis, invalidScript, input.keys, input.args),
      /Lua|syntax|parse|unexpected/i,
    );
  });

  // Mutation caught: deleting the final value from production draft HSET while leaving valid Lua.
  it("rejects a syntactically valid production Lua mutation with an unmatched HSET field", async () => {
    const redis = new FakeRedis();
    const input = draftScriptInput("invalid-hset-pair");
    const mutatedScript = SAVE_NEWS_DRAFT_SCRIPT.replace(
      '"sortScore", ARGV[4])',
      '"sortScore")',
    );
    assert.notEqual(mutatedScript, SAVE_NEWS_DRAFT_SCRIPT);

    await assert.rejects(
      runRedisScript(redis, mutatedScript, input.keys, input.args),
      /HSET|wrong number of arguments/i,
    );
    assert.equal(await redis.get(input.keys[0]), null);
  });

  // Mutation caught: omitting any commit, index, latest-pointer, counter, date, or timeline write.
  it("executes the production confirmation snapshot Lua across all six key families", async () => {
    const redis = new FakeRedis();
    const input = confirmationSnapshotScriptInput("all-keys");

    assert.deepEqual(
      await runRedisScript(redis, SAVE_CONFIRMATION_SNAPSHOT_SCRIPT, input.keys, input.args),
      ["inserted", input.snapshotId, "1"],
    );
    assert.deepEqual(await redis.hgetall(input.keys[0]), {
      payload: JSON.stringify({ snapshotId: input.snapshotId, snapshotRevisionNumber: 1 }),
      snapshotRevisionNumber: "1",
      committed: "1",
    });
    assert.deepEqual(await redis.zrange(input.keys[1], 0, -1), [input.snapshotId]);
    assert.deepEqual(await redis.hgetall(input.keys[2]), {
      snapshotId: input.snapshotId,
      snapshotRevisionNumber: "1",
    });
    assert.equal(await redis.get(input.keys[3]), "1");
    assert.deepEqual(await redis.zrange(input.keys[4], 0, -1), [input.asOf]);
    assert.deepEqual(await redis.zrange(input.keys[5], 0, -1), [input.timelineMember]);
  });

  // Mutation caught: allowing a malformed production HSET field/value list to execute partially.
  it("rejects a confirmation snapshot Lua mutation with an unmatched HSET field", async () => {
    const redis = new FakeRedis();
    const input = confirmationSnapshotScriptInput("invalid-hset-pair");
    const mutatedScript = SAVE_CONFIRMATION_SNAPSHOT_SCRIPT.replace(
      '"committed", "0")',
      '"committed")',
    );
    assert.notEqual(mutatedScript, SAVE_CONFIRMATION_SNAPSHOT_SCRIPT);

    await assert.rejects(
      runRedisScript(redis, mutatedScript, input.keys, input.args),
      /HSET|wrong number of arguments/i,
    );
  });

  // Mutation caught: rolling back commands before a runtime error or continuing after the failed call.
  it("keeps successful commands before a Lua runtime error and skips later commands", async () => {
    const redis = new FakeRedis();
    const script = commandScript(`
redis.call('SET', 'before', 'kept')
redis.call('HSET', 'broken', 'field')
redis.call('SET', 'after', 'must-not-run')
return 'completed'`);

    await assert.rejects(runRedisScript(redis, script, [], []), /HSET|wrong number of arguments/i);
    assert.equal(await redis.get("before"), "kept");
    assert.equal(await redis.get("after"), null);
  });

  // Mutation caught: accepting too few or too many arguments for any supported Redis command.
  it("enforces supported Redis command arity", async () => {
    const invalidCalls = [
      "return redis.call('GET')",
      "return redis.call('GET', 'key', 'extra')",
      "return redis.call('SET', 'key')",
      "return redis.call('DEL')",
      "return redis.call('HGET', 'key')",
      "return redis.call('HGET', 'key', 'field', 'extra')",
      "return redis.call('HEXISTS', 'key')",
      "return redis.call('HEXISTS', 'key', 'field', 'extra')",
      "return redis.call('HSET', 'key', 'field')",
      "return redis.call('HDEL', 'key')",
      "return redis.call('ZADD', 'key', '1')",
      "return redis.call('ZCARD')",
      "return redis.call('ZCARD', 'key', 'extra')",
    ];

    for (const call of invalidCalls) {
      await assert.rejects(
        runCommandScript(new FakeRedis(), call),
        /wrong number of arguments/i,
      );
    }
  });

  // Mutation caught: coercing a Lua nil command argument to the JavaScript string "null".
  it("rejects nil arguments for every supported Redis command", async () => {
    const invalidCalls = [
      "return redis.call('GET', nil)",
      "return redis.call('SET', 'key', nil)",
      "return redis.call('DEL', nil)",
      "return redis.call('HGET', 'key', nil)",
      "return redis.call('HEXISTS', 'key', nil)",
      "return redis.call('HSET', 'key', 'field', nil)",
      "return redis.call('HDEL', 'key', nil)",
      "return redis.call('ZADD', 'key', nil, 'member')",
      "return redis.call('ZCARD', nil)",
    ];

    for (const call of invalidCalls) {
      await assert.rejects(
        runCommandScript(new FakeRedis(), call),
        /command arguments must be strings or integers/i,
      );
    }
  });

  // Mutation caught: accepting malformed SET options or a non-positive/non-integer PX duration.
  it("validates SET NX and PX contracts before changing storage", async () => {
    const invalidCalls = [
      "return redis.call('SET', 'key', 'value', 'PX')",
      "return redis.call('SET', 'key', 'value', 'PX', 'not-a-number')",
      "return redis.call('SET', 'key', 'value', 'PX', '1.5')",
      "return redis.call('SET', 'key', 'value', 'PX', '0')",
      "return redis.call('SET', 'key', 'value', 'BOGUS')",
      "return redis.call('SET', 'key', 'value', 'NX', 'extra')",
    ];
    for (const call of invalidCalls) {
      const redis = new FakeRedis();
      await assert.rejects(runCommandScript(redis, call), /syntax error|invalid expire time/i);
      assert.equal(await redis.get("key"), null);
    }

    const nxRedis = new FakeRedis();
    await nxRedis.hset("typed-key", { field: "original" });
    assert.equal(
      await runCommandScript(nxRedis, "return redis.call('SET', 'typed-key', 'replacement', 'NX')"),
      false,
    );
    assert.deepEqual(await nxRedis.hgetall("typed-key"), { field: "original" });

    const ttlRedis = new FakeRedis();
    assert.equal(
      await runCommandScript(ttlRedis, "return redis.call('SET', 'ttl-key', 'value', 'PX', '10', 'NX')"),
      "OK",
    );
    ttlRedis.advance(9);
    assert.equal(await ttlRedis.get("ttl-key"), "value");
    ttlRedis.advance(1);
    assert.equal(await ttlRedis.get("ttl-key"), null);
  });

  // Mutation caught: accepting Redis-invalid plus signs or leading zeroes in SET PX integers.
  it("rejects non-canonical SET PX integers without rejecting production-used forms", async () => {
    for (const ttl of ["+10", "01"]) {
      const redis = new FakeRedis();
      await assert.rejects(
        runCommandScript(redis, `return redis.call('SET', 'key', 'value', 'PX', '${ttl}')`),
        /invalid expire time/i,
      );
      assert.equal(await redis.get("key"), null);
    }

    const redis = new FakeRedis();
    assert.equal(
      await runCommandScript(redis, "return redis.call('SET', 'key', 'value', 'NX', 'PX', '120000')"),
      "OK",
    );
    assert.equal(await redis.get("key"), "value");
  });

  // Mutation caught: counting an expired SET PX string as an existing key during DEL.
  it("expires a PX string before DEL determines its removal count", async () => {
    const redis = new FakeRedis();
    assert.equal(
      await runCommandScript(redis, "return redis.call('SET', 'key', 'value', 'PX', '10')"),
      "OK",
    );
    redis.advance(10);

    assert.equal(await runCommandScript(redis, "return redis.call('DEL', 'key')"), 0);
  });

  // Mutation caught: coercing malformed ZADD scores/pairs and partially writing earlier pairs.
  it("validates every ZADD score/member pair before writing", async () => {
    const invalidCalls = [
      "return redis.call('ZADD', 'scores', '1', 'first', '2')",
      "return redis.call('ZADD', 'scores', 'not-a-number', 'first')",
      "return redis.call('ZADD', 'scores', '1', 'first', 'not-a-number', 'second')",
    ];
    for (const call of invalidCalls) {
      const redis = new FakeRedis();
      await assert.rejects(runCommandScript(redis, call), /wrong number of arguments|valid float/i);
      assert.equal(await runCommandScript(redis, "return redis.call('ZCARD', 'scores')"), 0);
    }

    const redis = new FakeRedis();
    assert.equal(
      await runCommandScript(redis, "return redis.call('ZADD', 'scores', '1', 'first', '2.5', 'second')"),
      2,
    );
    assert.equal(await runCommandScript(redis, "return redis.call('ZCARD', 'scores')"), 2);
  });

  // Mutation caught: silently rounding a non-zero underflowed ZADD score to JavaScript zero.
  it("rejects ZADD score underflow without rejecting production timestamp scores", async () => {
    const underflowRedis = new FakeRedis();
    await assert.rejects(
      runCommandScript(underflowRedis, "return redis.call('ZADD', 'scores', '1e-9999', 'underflow')"),
      /valid float|range/i,
    );
    assert.equal(await runCommandScript(underflowRedis, "return redis.call('ZCARD', 'scores')"), 0);

    const productionRedis = new FakeRedis();
    assert.equal(
      await runCommandScript(
        productionRedis,
        "return redis.call('ZADD', 'scores', '1785197400000', 'production-timestamp')",
      ),
      1,
    );
  });

  // Mutation caught: storing one Redis key in independent maps instead of raising WRONGTYPE.
  it("enforces one Redis type per key while preserving SET overwrite and DEL semantics", async () => {
    const wrongTypeCalls = [
      { seed: (redis) => redis.hset("key", { field: "value" }), call: "return redis.call('GET', 'key')" },
      { seed: (redis) => redis.set("key", "value"), call: "return redis.call('HGET', 'key', 'field')" },
      { seed: (redis) => redis.set("key", "value"), call: "return redis.call('HEXISTS', 'key', 'field')" },
      { seed: (redis) => redis.set("key", "value"), call: "return redis.call('HSET', 'key', 'field', 'value')" },
      { seed: (redis) => redis.set("key", "value"), call: "return redis.call('HDEL', 'key', 'field')" },
      { seed: (redis) => redis.set("key", "value"), call: "return redis.call('ZADD', 'key', '1', 'member')" },
      { seed: (redis) => redis.set("key", "value"), call: "return redis.call('ZCARD', 'key')" },
    ];
    for (const { seed, call } of wrongTypeCalls) {
      const redis = new FakeRedis();
      await seed(redis);
      await assert.rejects(runCommandScript(redis, call), /WRONGTYPE/);
    }

    const setRedis = new FakeRedis();
    await setRedis.hset("key", { field: "value" });
    assert.equal(
      await runCommandScript(setRedis, "return redis.call('SET', 'key', 'replacement')"),
      "OK",
    );
    assert.equal(await setRedis.get("key"), "replacement");
    assert.deepEqual(await setRedis.hgetall("key"), {});

    const delRedis = new FakeRedis();
    await delRedis.zadd("key", { score: 1, member: "member" });
    assert.equal(await runCommandScript(delRedis, "return redis.call('DEL', 'key')"), 1);
    assert.deepEqual(await delRedis.zrange("key", 0, -1), []);
  });

  // Mutation caught: public FakeRedis ZRANGE silently treating a non-zset key as empty.
  it("enforces Redis cross-type errors through public FakeRedis zrange", async () => {
    const stringRedis = new FakeRedis();
    await stringRedis.set("key", "value");
    await assert.rejects(stringRedis.zrange("key", 0, -1), /WRONGTYPE/);

    const hashRedis = new FakeRedis();
    await hashRedis.hset("key", { field: "value" });
    await assert.rejects(hashRedis.zrange("key", 0, -1), /WRONGTYPE/);
  });

  // Mutation caught: retaining an empty hash key after HDEL removes its final field.
  it("removes an empty HDEL hash so a later SET NX can acquire the key", async () => {
    const redis = new FakeRedis();
    const result = await runCommandScript(redis, `
local added = redis.call('HSET', 'key', 'field', 'value')
local removed = redis.call('HDEL', 'key', 'field')
local stored = redis.call('SET', 'key', 'replacement', 'NX')
return {added, removed, stored}`);

    assert.deepEqual(result, [1, 1, "OK"]);
    assert.equal(await redis.get("key"), "replacement");
  });

  // Mutation caught: allocating a brief with max(counter, ZCARD) when an existing counter is stale.
  it("executes production brief Lua with missing and stale counter semantics", async () => {
    const missingCounterRedis = new FakeRedis();
    const missingInput = briefScriptInput("missing-counter");
    await seedTwoMembers(missingCounterRedis, missingInput.keys[2]);
    const missingResult = await runRedisScript(
      missingCounterRedis,
      SAVE_NEWS_BRIEF_SCRIPT,
      missingInput.keys,
      missingInput.args,
    );
    assert.equal(missingResult[2], "3");

    const staleCounterRedis = new FakeRedis();
    const staleInput = briefScriptInput("stale-counter");
    await seedTwoMembers(staleCounterRedis, staleInput.keys[2]);
    await staleCounterRedis.set(staleInput.keys[4], "1");
    const staleResult = await runRedisScript(
      staleCounterRedis,
      SAVE_NEWS_BRIEF_SCRIPT,
      staleInput.keys,
      staleInput.args,
    );
    assert.equal(staleResult[2], "2");
  });

  // Mutation caught: allocating a draft with max(counter, ZCARD) when an existing counter is stale.
  it("executes production draft Lua with missing and stale counter semantics", async () => {
    const missingCounterRedis = new FakeRedis();
    const missingInput = draftScriptInput("missing-counter");
    await seedTwoMembers(missingCounterRedis, missingInput.keys[2]);
    const missingResult = await runRedisScript(
      missingCounterRedis,
      SAVE_NEWS_DRAFT_SCRIPT,
      missingInput.keys,
      missingInput.args,
    );
    assert.equal(missingResult[2], "3");

    const staleCounterRedis = new FakeRedis();
    const staleInput = draftScriptInput("stale-counter");
    await seedTwoMembers(staleCounterRedis, staleInput.keys[2]);
    await staleCounterRedis.set(staleInput.keys[3], "1");
    const staleResult = await runRedisScript(
      staleCounterRedis,
      SAVE_NEWS_DRAFT_SCRIPT,
      staleInput.keys,
      staleInput.args,
    );
    assert.equal(staleResult[2], "2");
  });

  // Mutation caught: swapping, omitting, or renaming a brief Lua key/argument at the repository boundary.
  it("passes the exact production brief script, keys, and arguments", async () => {
    const redis = new FakeRedis();
    const repository = createNewsRepository(redis);
    const payload = normalizedBrief();
    const saved = await repository.saveMorningBrief(payload);
    const call = redis.evalCalls.find((candidate) => candidate.id === "jj-news-brief-save-v1");

    assert.equal(call.script, SAVE_NEWS_BRIEF_SCRIPT);
    assert.deepEqual(call.keys, [
      `jj-invest-public:dynamic-beta:news:v1:brief:${BRIEF_DATE}:current`,
      `jj-invest-public:dynamic-beta:news:v1:brief:${BRIEF_DATE}:revision:${saved.revisionId}`,
      `jj-invest-public:dynamic-beta:news:v1:brief:${BRIEF_DATE}:revisions`,
      "jj-invest-public:dynamic-beta:news:v1:brief:timeline",
      `jj-invest-public:dynamic-beta:news:v1:brief:${BRIEF_DATE}:revision-count`,
    ]);
    assert.deepEqual(call.args, [
      saved.revisionId,
      BRIEF_DATE,
      String(Date.parse(payload.generatedAt)),
      JSON.stringify(payload),
      `${BRIEF_DATE}:${saved.revisionId}`,
    ]);
  });

  // Mutation caught: swapping, omitting, or renaming a draft Lua key/argument at the repository boundary.
  it("passes the exact production draft script, keys, and arguments", async () => {
    const redis = new FakeRedis();
    const repository = createNewsDraftRepository(redis);
    const payload = normalizedBrief();
    const saved = await repository.saveDraft({
      payload,
      warnings: ["review"],
      createdAt: CREATED_AT,
    });
    const call = redis.evalCalls.find((candidate) => candidate.id === "jj-news-draft-save-v1");
    const prefix = "jj-invest-public:dynamic-beta:news:v1:draft";
    const revisionKey = `${prefix}:${BRIEF_DATE}:revision:${saved.draft.draftRevisionId}`;

    assert.equal(call.script, SAVE_NEWS_DRAFT_SCRIPT);
    assert.deepEqual(call.keys, [
      `${prefix}:${BRIEF_DATE}:current`,
      revisionKey,
      `${prefix}:${BRIEF_DATE}:revisions`,
      `${prefix}:${BRIEF_DATE}:revision-count`,
      `${prefix}:${BRIEF_DATE}:semantic-index`,
      `${prefix}:timeline`,
      `${prefix}:${BRIEF_DATE}:semantic-index-ready`,
      revisionKey,
    ]);
    assert.deepEqual(call.args, [
      saved.draft.draftRevisionId,
      BRIEF_DATE,
      CREATED_AT,
      String(CREATED_SCORE),
      JSON.stringify(["review"]),
      JSON.stringify(payload),
      String(CREATED_SCORE),
    ]);
  });
});
