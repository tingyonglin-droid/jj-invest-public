export const SAVE_NEWS_BRIEF_SCRIPT = `-- jj-news-brief-save-v1
local current = redis.call("GET", KEYS[1])
local existingPayload = redis.call("HGET", KEYS[2], "payload")
local revisionNumber

if existingPayload then
  local existing = cjson.decode(existingPayload)
  revisionNumber = tonumber(existing["revisionNumber"]) or 1
else
  local count = tonumber(redis.call("GET", KEYS[5]))
  if not count then
    count = redis.call("ZCARD", KEYS[3])
  end
  revisionNumber = count + 1
  local snapshot = cjson.decode(ARGV[4])
  snapshot["revisionId"] = ARGV[1]
  snapshot["revisionNumber"] = revisionNumber
  redis.call("HSET", KEYS[2], "payload", cjson.encode(snapshot))
end

local recordedCount = tonumber(redis.call("GET", KEYS[5])) or 0
if revisionNumber > recordedCount then
  redis.call("SET", KEYS[5], tostring(revisionNumber))
end
redis.call("ZADD", KEYS[3], ARGV[3], ARGV[1])
redis.call("ZADD", KEYS[4], ARGV[3], ARGV[5])
redis.call("SET", KEYS[1], ARGV[1])

local status = "inserted"
if current then
  if current == ARGV[1] then
    status = "unchanged"
  else
    status = "revised"
  end
end
return {status, ARGV[1], tostring(revisionNumber)}`;

export const SAVE_CONFIRMATION_SNAPSHOT_SCRIPT = `-- jj-news-confirmation-snapshot-save-v1
local payload = redis.call("HGET", KEYS[1], "payload")
local revisionNumber
if payload then
  revisionNumber = tonumber(redis.call("HGET", KEYS[1], "snapshotRevisionNumber"))
else
  local count = tonumber(redis.call("GET", KEYS[4]))
  if not count then count = redis.call("ZCARD", KEYS[2]) end
  revisionNumber = count + 1
  local snapshot = cjson.decode(ARGV[4])
  snapshot["snapshotRevisionNumber"] = revisionNumber
  redis.call("HSET", KEYS[1],
    "payload", cjson.encode(snapshot),
    "snapshotRevisionNumber", tostring(revisionNumber),
    "committed", "0")
  redis.call("SET", KEYS[4], tostring(revisionNumber))
end
redis.call("ZADD", KEYS[2], revisionNumber, ARGV[1])
redis.call("ZADD", KEYS[5], ARGV[2], ARGV[3])
redis.call("HSET", KEYS[1], "committed", "1")
local latestNumber = tonumber(redis.call("HGET", KEYS[3], "snapshotRevisionNumber")) or 0
if revisionNumber >= latestNumber then
  redis.call("HSET", KEYS[3],
    "snapshotId", ARGV[1],
    "snapshotRevisionNumber", tostring(revisionNumber))
end
redis.call("ZADD", KEYS[6], ARGV[2], ARGV[5])
local status = "inserted"
if payload then status = "unchanged"
elseif revisionNumber > 1 then status = "revised" end
return {status, ARGV[1], tostring(revisionNumber)}`;

export const INITIALIZE_DRAFT_INDEX_SCRIPT = `-- jj-news-draft-index-init-v1
if redis.call("GET", KEYS[4]) then
  return 0
end

local mappings = cjson.decode(ARGV[1])
for semanticId, revisionId in pairs(mappings) do
  redis.call("HSET", KEYS[3], semanticId, revisionId)
end

local count = tonumber(redis.call("GET", KEYS[2])) or 0
local indexedCount = redis.call("ZCARD", KEYS[1])
local suppliedCount = tonumber(ARGV[2]) or 0
if indexedCount > count then count = indexedCount end
if suppliedCount > count then count = suppliedCount end
redis.call("SET", KEYS[2], tostring(count))
redis.call("SET", KEYS[4], "1")
return 1`;

export const SAVE_NEWS_DRAFT_SCRIPT = `-- jj-news-draft-save-v1
local mappedRevisionId = redis.call("HGET", KEYS[5], ARGV[1])
if mappedRevisionId then
  local storedMappedId = redis.call("HGET", KEYS[8], "draftRevisionId")
  if storedMappedId == mappedRevisionId then
    local mappedNumber = tonumber(redis.call("HGET", KEYS[8], "draftRevisionNumber")) or 1
    local mappedScore = tonumber(redis.call("HGET", KEYS[8], "sortScore")) or tonumber(ARGV[7]) or tonumber(ARGV[4])
    redis.call("ZADD", KEYS[3], mappedScore, mappedRevisionId)
    redis.call("ZADD", KEYS[6], mappedScore, ARGV[2] .. ":" .. mappedRevisionId)
    if not redis.call("GET", KEYS[1]) then
      redis.call("SET", KEYS[1], mappedRevisionId)
    end
    local mappedCount = tonumber(redis.call("GET", KEYS[4])) or 0
    local mappedIndexedCount = redis.call("ZCARD", KEYS[3])
    if mappedIndexedCount > mappedCount then mappedCount = mappedIndexedCount end
    if mappedNumber > mappedCount then mappedCount = mappedNumber end
    redis.call("SET", KEYS[4], tostring(mappedCount))
    return {"unchanged", mappedRevisionId, tostring(mappedNumber)}
  end
  redis.call("HDEL", KEYS[5], ARGV[1])
end

local existingId = redis.call("HGET", KEYS[2], "draftRevisionId")
if existingId then
  local existingNumber = tonumber(redis.call("HGET", KEYS[2], "draftRevisionNumber")) or 1
  local existingScore = tonumber(redis.call("HGET", KEYS[2], "sortScore")) or tonumber(ARGV[4])
  redis.call("HSET", KEYS[5], ARGV[1], existingId)
  redis.call("ZADD", KEYS[3], existingScore, existingId)
  redis.call("ZADD", KEYS[6], existingScore, ARGV[2] .. ":" .. existingId)
  if not redis.call("GET", KEYS[1]) then
    redis.call("SET", KEYS[1], existingId)
  end
  local recordedCount = tonumber(redis.call("GET", KEYS[4])) or 0
  local indexedCount = redis.call("ZCARD", KEYS[3])
  if indexedCount > recordedCount then recordedCount = indexedCount end
  if existingNumber > recordedCount then recordedCount = existingNumber end
  redis.call("SET", KEYS[4], tostring(recordedCount))
  return {"unchanged", existingId, tostring(existingNumber)}
end

local count = tonumber(redis.call("GET", KEYS[4]))
if not count then
  count = redis.call("ZCARD", KEYS[3])
end
local revisionNumber = count + 1
local current = redis.call("GET", KEYS[1])
redis.call("HSET", KEYS[2],
  "draftId", ARGV[2],
  "draftRevisionId", ARGV[1],
  "draftRevisionNumber", tostring(revisionNumber),
  "briefDate", ARGV[2],
  "status", "pending",
  "createdAt", ARGV[3],
  "updatedAt", ARGV[3],
  "approvedAt", "",
  "rejectedAt", "",
  "rejectionReason", "",
  "approvedBriefRevisionId", "",
  "approvedBriefRevisionNumber", "",
  "validationWarnings", ARGV[5],
  "dedupeWarnings", "[]",
  "payload", ARGV[6],
  "sortScore", ARGV[4])
redis.call("SET", KEYS[1], ARGV[1])
redis.call("SET", KEYS[4], tostring(revisionNumber))
redis.call("HSET", KEYS[5], ARGV[1], ARGV[1])
redis.call("ZADD", KEYS[3], ARGV[4], ARGV[1])
redis.call("ZADD", KEYS[6], ARGV[4], ARGV[2] .. ":" .. ARGV[1])

if current then
  return {"revised", ARGV[1], tostring(revisionNumber)}
end
return {"inserted", ARGV[1], tostring(revisionNumber)}`;

export const CLAIM_DRAFT_REVIEW_SCRIPT = `-- jj-news-draft-review-claim-v1
if redis.call("HEXISTS", KEYS[1], "draftRevisionId") == 0 then
  return {"missing", ""}
end
local status = redis.call("HGET", KEYS[1], "status")
if status ~= "pending" then
  return {"terminal", status}
end
local intent = redis.call("HGET", KEYS[1], "reviewIntent") or ""
local approvalPhase = redis.call("HGET", KEYS[1], "approvalPhase") or ""
if intent == "approve" and approvalPhase == "" then
  approvalPhase = "publishing"
end
local publishedRevisionId = redis.call("HGET", KEYS[1], "publicationBriefRevisionId") or ""
local publishedRevisionNumber = redis.call("HGET", KEYS[1], "publicationBriefRevisionNumber") or ""
local publicationWarnings = redis.call("HGET", KEYS[1], "publicationDedupeWarnings") or "[]"
if redis.call("GET", KEYS[2]) then
  return {"busy", intent, approvalPhase, publishedRevisionId, publishedRevisionNumber, publicationWarnings}
end
if intent ~= "" and intent ~= ARGV[1] then
  if intent == "approve" and approvalPhase == "claimed" and ARGV[1] == "reject" then
    redis.call("HDEL", KEYS[1],
      "reviewIntent",
      "reviewStartedAt",
      "approvalPhase",
      "publicationStartedAt",
      "publicationRecordedAt",
      "publicationBriefRevisionId",
      "publicationBriefRevisionNumber",
      "publicationDedupeWarnings")
    intent = ""
    approvalPhase = ""
    publishedRevisionId = ""
    publishedRevisionNumber = ""
    publicationWarnings = "[]"
  else
    return {"conflict", intent, approvalPhase, publishedRevisionId, publishedRevisionNumber, publicationWarnings}
  end
end
local acquired = redis.call("SET", KEYS[2], ARGV[2], "NX", "PX", ARGV[3])
if not acquired then
  return {"busy", intent, approvalPhase, publishedRevisionId, publishedRevisionNumber, publicationWarnings}
end
if intent == "" then
  redis.call("HSET", KEYS[1], "reviewIntent", ARGV[1], "reviewStartedAt", ARGV[4])
  intent = ARGV[1]
  if ARGV[1] == "approve" then
    redis.call("HSET", KEYS[1], "approvalPhase", "claimed")
    approvalPhase = "claimed"
  end
end
return {"acquired", ARGV[1], approvalPhase, publishedRevisionId, publishedRevisionNumber, publicationWarnings}`;

export const RELEASE_DRAFT_REVIEW_SCRIPT = `-- jj-news-draft-review-release-v1
if redis.call("GET", KEYS[2]) ~= ARGV[2] then
  return "not_owner"
end
local status = redis.call("HGET", KEYS[1], "status")
local intent = redis.call("HGET", KEYS[1], "reviewIntent")
if ARGV[3] == "1" and status == "pending" and intent == ARGV[1] then
  local approvalPhase = redis.call("HGET", KEYS[1], "approvalPhase") or ""
  if ARGV[1] ~= "approve" or approvalPhase == "claimed" then
    redis.call("HDEL", KEYS[1],
      "reviewIntent",
      "reviewStartedAt",
      "approvalPhase",
      "publicationStartedAt",
      "publicationRecordedAt",
      "publicationBriefRevisionId",
      "publicationBriefRevisionNumber",
      "publicationDedupeWarnings")
  end
end
redis.call("DEL", KEYS[2])
return "released"`;

export const BEGIN_DRAFT_PUBLICATION_SCRIPT = `-- jj-news-draft-publication-begin-v1
if redis.call("HEXISTS", KEYS[1], "draftRevisionId") == 0 then
  return "missing"
end
if redis.call("GET", KEYS[2]) ~= ARGV[1] then
  return "claim_lost"
end
local status = redis.call("HGET", KEYS[1], "status")
if status ~= "pending" then
  return status
end
if redis.call("HGET", KEYS[1], "reviewIntent") ~= "approve" then
  return "intent_conflict"
end
local approvalPhase = redis.call("HGET", KEYS[1], "approvalPhase") or ""
if approvalPhase == "published" then
  return "published"
end
if approvalPhase ~= "" and approvalPhase ~= "claimed" and approvalPhase ~= "publishing" then
  return "phase_conflict"
end
if approvalPhase ~= "publishing" then
  redis.call("HSET", KEYS[1],
    "approvalPhase", "publishing",
    "publicationStartedAt", ARGV[2])
end
return "publishing"`;

export const RECORD_DRAFT_PUBLICATION_SCRIPT = `-- jj-news-draft-publication-record-v1
if redis.call("HEXISTS", KEYS[1], "draftRevisionId") == 0 then
  return "missing"
end
if redis.call("GET", KEYS[2]) ~= ARGV[1] then
  return "claim_lost"
end
local status = redis.call("HGET", KEYS[1], "status")
if status ~= "pending" then
  return status
end
if redis.call("HGET", KEYS[1], "reviewIntent") ~= "approve" then
  return "intent_conflict"
end
local approvalPhase = redis.call("HGET", KEYS[1], "approvalPhase") or "publishing"
if approvalPhase == "published" then
  local existingId = redis.call("HGET", KEYS[1], "publicationBriefRevisionId") or ""
  local existingNumber = redis.call("HGET", KEYS[1], "publicationBriefRevisionNumber") or ""
  if existingId == ARGV[2] and existingNumber == ARGV[3] then
    return "published"
  end
  return "identity_conflict"
end
if approvalPhase ~= "publishing" then
  return "phase_conflict"
end
redis.call("HSET", KEYS[1],
  "approvalPhase", "published",
  "publicationRecordedAt", ARGV[5],
  "publicationBriefRevisionId", ARGV[2],
  "publicationBriefRevisionNumber", ARGV[3],
  "publicationDedupeWarnings", ARGV[4])
return "published"`;

export const MARK_DRAFT_APPROVED_SCRIPT = `-- jj-news-draft-mark-approved-v1
if redis.call("HEXISTS", KEYS[1], "draftRevisionId") == 0 then
  return "missing"
end
if redis.call("GET", KEYS[2]) ~= ARGV[1] then
  return "claim_lost"
end
local status = redis.call("HGET", KEYS[1], "status")
if status ~= "pending" then
  return status
end
if redis.call("HGET", KEYS[1], "reviewIntent") ~= "approve" then
  return "intent_conflict"
end
if redis.call("HGET", KEYS[1], "approvalPhase") ~= "published" then
  return "publication_pending"
end
local publishedRevisionId = redis.call("HGET", KEYS[1], "publicationBriefRevisionId") or ""
local publishedRevisionNumber = redis.call("HGET", KEYS[1], "publicationBriefRevisionNumber") or ""
if publishedRevisionId == "" or publishedRevisionNumber == "" then
  return "publication_identity_missing"
end
local publicationWarnings = redis.call("HGET", KEYS[1], "publicationDedupeWarnings") or "[]"
redis.call("HSET", KEYS[1],
  "status", "approved",
  "updatedAt", ARGV[2],
  "approvedAt", ARGV[2],
  "approvedBriefRevisionId", publishedRevisionId,
  "approvedBriefRevisionNumber", publishedRevisionNumber,
  "dedupeWarnings", publicationWarnings)
redis.call("HDEL", KEYS[1],
  "reviewIntent",
  "reviewStartedAt",
  "approvalPhase",
  "publicationStartedAt",
  "publicationRecordedAt",
  "publicationBriefRevisionId",
  "publicationBriefRevisionNumber",
  "publicationDedupeWarnings")
redis.call("DEL", KEYS[2])
return "approved"`;

export const MARK_DRAFT_REJECTED_SCRIPT = `-- jj-news-draft-mark-rejected-v1
if redis.call("HEXISTS", KEYS[1], "draftRevisionId") == 0 then
  return "missing"
end
if redis.call("GET", KEYS[2]) ~= ARGV[1] then
  return "claim_lost"
end
local status = redis.call("HGET", KEYS[1], "status")
if status ~= "pending" then
  return status
end
if redis.call("HGET", KEYS[1], "reviewIntent") ~= "reject" then
  return "intent_conflict"
end
redis.call("HSET", KEYS[1],
  "status", "rejected",
  "updatedAt", ARGV[2],
  "rejectedAt", ARGV[2],
  "rejectionReason", ARGV[3])
redis.call("HDEL", KEYS[1], "reviewIntent", "reviewStartedAt")
redis.call("DEL", KEYS[2])
return "rejected"`;

export async function runRedisScript(redis, script, keys, args) {
  if (typeof redis?.eval !== "function") {
    throw new Error("此 Redis client 不支援必要的原子 Lua 操作。");
  }
  return redis.eval(script, keys, args.map((value) => String(value)));
}

export function scriptTuple(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}
