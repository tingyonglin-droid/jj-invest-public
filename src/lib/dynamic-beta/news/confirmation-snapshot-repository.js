import { parseStoredConfirmationSnapshot } from "./confirmation-snapshot.js";
import {
  runRedisScript,
  SAVE_CONFIRMATION_SNAPSHOT_SCRIPT,
  scriptTuple,
} from "./redis-atomic.js";

const PREFIX = "jj-invest-public:dynamic-beta:news:v1:confirmation-snapshot";
const SAVE_STATUSES = new Set(["inserted", "revised", "unchanged"]);

function validDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validBriefIdentity({ briefDate, revisionId } = {}) {
  return validDateKey(briefDate) && typeof revisionId === "string" && revisionId.length > 0;
}

function dateScore(value) {
  return Date.parse(`${value}T00:00:00.000Z`);
}

function keys({ briefDate, revisionId, asOf, snapshotId } = {}) {
  return {
    revision: `${PREFIX}:revision:${briefDate}:${revisionId}:${asOf}:${snapshotId}`,
    revisions: `${PREFIX}:revisions:${briefDate}:${revisionId}:${asOf}`,
    latest: `${PREFIX}:latest:${briefDate}:${revisionId}:${asOf}`,
    revisionCount: `${PREFIX}:revision-count:${briefDate}:${revisionId}:${asOf}`,
    dates: `${PREFIX}:dates:${briefDate}:${revisionId}`,
    timeline: `${PREFIX}:timeline`,
  };
}

function parseTimelineMember(member) {
  const match = String(member).match(/^(\d{4}-\d{2}-\d{2}):(.+):(\d{4}-\d{2}-\d{2})$/);
  if (!match) return null;
  const [, briefDate, revisionId, asOf] = match;
  return validBriefIdentity({ briefDate, revisionId }) && validDateKey(asOf)
    ? { briefDate, revisionId, asOf }
    : null;
}

function parseSnapshot(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  let payload = record.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    try {
      payload = JSON.stringify(payload);
    } catch {
      return null;
    }
  }
  return parseStoredConfirmationSnapshot({
    ...record,
    committed: record.committed === 1 ? "1" : record.committed,
    payload,
    snapshotRevisionNumber: typeof record.snapshotRevisionNumber === "number"
      ? String(record.snapshotRevisionNumber)
      : record.snapshotRevisionNumber,
  });
}

function matchesScope(snapshot, { briefDate, revisionId, asOf, snapshotId } = {}) {
  return snapshot?.briefDate === briefDate
    && snapshot.revisionId === revisionId
    && snapshot.asOf === asOf
    && (snapshotId === undefined || snapshot.snapshotId === snapshotId);
}

export function createConfirmationSnapshotRepository(redis) {
  if (!redis) throw new Error("Confirmation Snapshot repository 需要 Redis。");

  async function readExactLatest({ briefDate, revisionId, asOf }) {
    const scope = keys({ briefDate, revisionId, asOf });
    const latest = await redis.hgetall(scope.latest);
    if (!latest?.snapshotId) return null;
    const snapshot = parseSnapshot(await redis.hgetall(keys({
      briefDate,
      revisionId,
      asOf,
      snapshotId: latest.snapshotId,
    }).revision));
    const latestNumber = Number(latest.snapshotRevisionNumber);
    return matchesScope(snapshot, {
      briefDate,
      revisionId,
      asOf,
      snapshotId: latest.snapshotId,
    })
      && Number.isInteger(latestNumber)
      && snapshot.snapshotRevisionNumber === latestNumber
      ? snapshot
      : null;
  }

  return {
    async saveSnapshot(snapshot) {
      const validated = parseSnapshot({
        payload: JSON.stringify(snapshot),
        committed: "1",
      });
      if (!validated || !validDateKey(validated.asOf)) {
        throw new Error("Confirmation Snapshot 格式無效。");
      }
      const scope = keys(validated);
      const asOfScore = dateScore(validated.asOf);
      const timelineMember = `${validated.briefDate}:${validated.revisionId}:${validated.asOf}`;
      const result = scriptTuple(await runRedisScript(
        redis,
        SAVE_CONFIRMATION_SNAPSHOT_SCRIPT,
        [
          scope.revision,
          scope.revisions,
          scope.latest,
          scope.revisionCount,
          scope.dates,
          scope.timeline,
        ],
        [
          validated.snapshotId,
          asOfScore,
          validated.asOf,
          JSON.stringify(validated),
          timelineMember,
        ],
      ));
      const [status, snapshotId, rawRevisionNumber] = result;
      const snapshotRevisionNumber = Number(rawRevisionNumber);
      if (result.length !== 3
        || !SAVE_STATUSES.has(status)
        || snapshotId !== validated.snapshotId
        || !Number.isInteger(snapshotRevisionNumber)
        || snapshotRevisionNumber < 1) {
        throw new Error("Confirmation Snapshot atomic insertion 回傳無效結果。");
      }
      return { status, snapshotId, snapshotRevisionNumber };
    },

    async readLatestSnapshot({ briefDate, revisionId, asOf } = {}) {
      if (!validBriefIdentity({ briefDate, revisionId })) return null;
      if (asOf !== undefined) {
        if (!validDateKey(asOf)) return null;
        return readExactLatest({ briefDate, revisionId, asOf });
      }
      const dates = await redis.zrange(
        keys({ briefDate, revisionId }).dates,
        0,
        -1,
        { rev: true },
      );
      for (const candidateAsOf of dates) {
        if (!validDateKey(candidateAsOf)) continue;
        const snapshot = await readExactLatest({
          briefDate,
          revisionId,
          asOf: candidateAsOf,
        });
        if (snapshot) return snapshot;
      }
      return null;
    },

    async readSnapshotRevisions({ briefDate, revisionId, asOf } = {}) {
      if (!validBriefIdentity({ briefDate, revisionId }) || !validDateKey(asOf)) return [];
      const snapshotIds = await redis.zrange(
        keys({ briefDate, revisionId, asOf }).revisions,
        0,
        -1,
      );
      const snapshots = await Promise.all(snapshotIds.map(async (snapshotId) => {
        const snapshot = parseSnapshot(
          await redis.hgetall(keys({ briefDate, revisionId, asOf, snapshotId }).revision),
        );
        return matchesScope(snapshot, { briefDate, revisionId, asOf, snapshotId })
          ? snapshot
          : null;
      }));
      return snapshots
        .filter(Boolean)
        .sort((left, right) => left.snapshotRevisionNumber - right.snapshotRevisionNumber);
    },

    async readRecentLatestSnapshots({ since, until, limit = 20 } = {}) {
      if (!validDateKey(since) || !validDateKey(until) || dateScore(since) > dateScore(until)) {
        return [];
      }
      const parsedLimit = Math.floor(Number(limit));
      const boundedLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20;
      const members = await redis.zrange(
        keys().timeline,
        dateScore(since),
        dateScore(until),
        { byScore: true },
      );
      const snapshots = [];
      for (const member of members.reverse()) {
        const identity = parseTimelineMember(member);
        if (!identity) continue;
        const snapshot = await readExactLatest(identity);
        if (!snapshot) continue;
        snapshots.push(snapshot);
        if (snapshots.length >= boundedLimit) break;
      }
      return snapshots;
    },
  };
}
