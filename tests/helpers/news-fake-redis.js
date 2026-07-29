import { executeRedisLua } from "./lua-redis-runtime.js";

function scriptId(script) {
  return String(script).match(/^-- ([a-z0-9-]+)/)?.[1] || "unknown";
}

const WRONG_TYPE = "WRONGTYPE Operation against a key holding the wrong kind of value";

function wrongArity(command) {
  throw new Error(`ERR wrong number of arguments for '${command.toLowerCase()}' command`);
}

function requireExactArity(command, args, expected) {
  if (args.length !== expected) wrongArity(command);
}

function requireMinimumArity(command, args, minimum) {
  if (args.length < minimum) wrongArity(command);
}

function parsePositiveRedisInteger(value, command) {
  const text = String(value);
  if (!/^-?(?:0|[1-9]\d*)$/.test(text)) {
    throw new Error(`ERR invalid expire time in '${command.toLowerCase()}' command`);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`ERR invalid expire time in '${command.toLowerCase()}' command`);
  }
  return parsed;
}

function parseRedisScore(value) {
  const text = String(value);
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) {
    throw new Error("ERR value is not a valid float");
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) throw new Error("ERR value is not a valid float");
  const mantissa = text.split(/[eE]/, 1)[0];
  if (parsed === 0 && /[1-9]/.test(mantissa)) {
    throw new Error("ERR value is not a valid float");
  }
  return parsed;
}

function parseSetOptions(options) {
  let onlyIfMissing = false;
  let ttl = null;
  for (let index = 0; index < options.length; index += 1) {
    const option = String(options[index]).toUpperCase();
    if (option === "NX" && !onlyIfMissing) {
      onlyIfMissing = true;
      continue;
    }
    if (option === "PX" && ttl === null && index + 1 < options.length) {
      ttl = parsePositiveRedisInteger(options[index + 1], "SET");
      index += 1;
      continue;
    }
    throw new Error("ERR syntax error");
  }
  return { onlyIfMissing, ttl };
}

export class FakeRedis {
  constructor({ now = 0 } = {}) {
    this.hashes = new Map();
    this.sortedSets = new Map();
    this.strings = new Map();
    this.expirations = new Map();
    this.now = now;
    this.evalCalls = [];
    this.evalFailures = new Map();
  }

  advance(milliseconds) {
    this.now += milliseconds;
  }

  failNextEval(id, error = new Error(`forced ${id} failure`)) {
    this.evalFailures.set(id, { remaining: 1, error });
  }

  async hgetall(key) {
    return { ...(this.hashes.get(key) || {}) };
  }

  async hget(key, field) {
    return this.hashes.get(key)?.[field] ?? null;
  }

  async hset(key, values) {
    this.hashes.set(key, { ...(this.hashes.get(key) || {}), ...values });
    return 1;
  }

  async hdel(key, ...fields) {
    const row = this.hashes.get(key);
    if (!row) return 0;
    let removed = 0;
    for (const field of fields.flat()) {
      if (Object.hasOwn(row, field)) {
        delete row[field];
        removed += 1;
      }
    }
    return removed;
  }

  async get(key) {
    this.#expireString(key);
    return this.strings.get(key) ?? null;
  }

  async set(key, value, options = {}) {
    this.#expireString(key);
    if (options.nx && this.strings.has(key)) return null;
    this.strings.set(key, value);
    if (options.px !== undefined) {
      this.expirations.set(key, this.now + Number(options.px));
    } else {
      this.expirations.delete(key);
    }
    return "OK";
  }

  async del(...keys) {
    let removed = 0;
    for (const key of keys.flat()) {
      removed += this.strings.delete(key) ? 1 : 0;
      removed += this.hashes.delete(key) ? 1 : 0;
      removed += this.sortedSets.delete(key) ? 1 : 0;
      this.expirations.delete(key);
    }
    return removed;
  }

  async zadd(key, entry) {
    const values = this.sortedSets.get(key) || new Map();
    values.set(entry.member, Number(entry.score));
    this.sortedSets.set(key, values);
    return 1;
  }

  async zrange(key, min, max, options = {}) {
    const normalizedKey = String(key);
    this.#assertType(normalizedKey, "zset");
    let values = [...(this.sortedSets.get(normalizedKey) || new Map()).entries()]
      .sort((left, right) => left[1] - right[1]);
    if (options.rev) values.reverse();
    if (options.byScore) {
      values = values.filter(([, score]) => score >= min && score <= max);
    } else {
      const end = max < 0 ? values.length + max + 1 : max + 1;
      values = values.slice(min, end);
    }
    return values.map(([member]) => member);
  }

  async eval(script, keys, args) {
    const id = scriptId(script);
    this.evalCalls.push({ id, script, keys: [...keys], args: [...args] });
    const failure = this.evalFailures.get(id);
    if (failure?.remaining > 0) {
      failure.remaining -= 1;
      throw failure.error;
    }

    return executeRedisLua({
      script,
      keys,
      args,
      callRedis: (command, commandArgs) => this.#callRedis(command, commandArgs),
    });
  }

  #callRedis(command, args) {
    switch (command) {
      case "GET": {
        requireExactArity(command, args, 1);
        const key = String(args[0]);
        this.#assertType(key, "string");
        return this.#string(key) ?? false;
      }
      case "SET": {
        requireMinimumArity(command, args, 2);
        const [rawKey, rawValue, ...options] = args;
        const key = String(rawKey);
        const { onlyIfMissing, ttl } = parseSetOptions(options);
        if (onlyIfMissing && this.#keyType(key)) return false;
        this.hashes.delete(key);
        this.sortedSets.delete(key);
        this.#writeString(key, String(rawValue), ttl);
        return "OK";
      }
      case "DEL": {
        requireMinimumArity(command, args, 1);
        let removed = 0;
        for (const rawKey of args) {
          const key = String(rawKey);
          this.#expireString(key);
          const existed = this.strings.has(key)
            || this.hashes.has(key)
            || this.sortedSets.has(key);
          this.strings.delete(key);
          this.hashes.delete(key);
          this.sortedSets.delete(key);
          this.expirations.delete(key);
          if (existed) removed += 1;
        }
        return removed;
      }
      case "HGET": {
        requireExactArity(command, args, 2);
        const key = String(args[0]);
        this.#assertType(key, "hash");
        return this.hashes.get(key)?.[String(args[1])] ?? false;
      }
      case "HEXISTS": {
        requireExactArity(command, args, 2);
        const key = String(args[0]);
        this.#assertType(key, "hash");
        return Object.hasOwn(this.hashes.get(key) || {}, String(args[1])) ? 1 : 0;
      }
      case "HSET": {
        requireMinimumArity(command, args, 3);
        if (args.length % 2 === 0) wrongArity(command);
        const key = String(args[0]);
        this.#assertType(key, "hash");
        const row = this.#hash(key);
        let added = 0;
        for (let index = 1; index < args.length; index += 2) {
          const field = String(args[index]);
          if (!Object.hasOwn(row, field)) added += 1;
          row[field] = String(args[index + 1]);
        }
        return added;
      }
      case "HDEL": {
        requireMinimumArity(command, args, 2);
        const key = String(args[0]);
        this.#assertType(key, "hash");
        const row = this.hashes.get(key);
        if (!row) return 0;
        let removed = 0;
        for (const rawField of args.slice(1)) {
          const field = String(rawField);
          if (Object.hasOwn(row, field)) {
            delete row[field];
            removed += 1;
          }
        }
        if (Object.keys(row).length === 0) this.hashes.delete(key);
        return removed;
      }
      case "ZADD": {
        requireMinimumArity(command, args, 3);
        if (args.length % 2 === 0) wrongArity(command);
        const entries = [];
        for (let index = 1; index < args.length; index += 2) {
          entries.push({
            score: parseRedisScore(args[index]),
            member: String(args[index + 1]),
          });
        }
        const key = String(args[0]);
        this.#assertType(key, "zset");
        const values = this.#zset(key);
        let added = 0;
        for (const { score, member } of entries) {
          if (!values.has(member)) added += 1;
          values.set(member, score);
        }
        return added;
      }
      case "ZCARD": {
        requireExactArity(command, args, 1);
        const key = String(args[0]);
        const type = this.#assertType(key, "zset");
        return type ? this.sortedSets.get(key).size : 0;
      }
      default:
        throw new Error(`FakeRedis Lua boundary 不支援 Redis command：${command}`);
    }
  }

  #expireString(key) {
    const expiresAt = this.expirations.get(key);
    if (expiresAt !== undefined && expiresAt <= this.now) {
      this.strings.delete(key);
      this.expirations.delete(key);
    }
  }

  #string(key) {
    this.#expireString(key);
    return this.strings.get(key) ?? null;
  }

  #keyType(key) {
    this.#expireString(key);
    if (this.strings.has(key)) return "string";
    if (this.hashes.has(key)) return "hash";
    if (this.sortedSets.has(key)) return "zset";
    return null;
  }

  #assertType(key, expected) {
    const actual = this.#keyType(key);
    if (actual && actual !== expected) throw new Error(WRONG_TYPE);
    return actual;
  }

  #writeString(key, value, ttl = null) {
    this.strings.set(key, value);
    if (ttl === null) this.expirations.delete(key);
    else this.expirations.set(key, this.now + ttl);
  }

  #hash(key) {
    const value = this.hashes.get(key) || {};
    this.hashes.set(key, value);
    return value;
  }

  #zset(key) {
    const value = this.sortedSets.get(key) || new Map();
    this.sortedSets.set(key, value);
    return value;
  }
}

export class InstrumentedRedis extends FakeRedis {
  constructor(options) {
    super(options);
    this.zrangeCalls = [];
  }

  async zrange(key, ...args) {
    this.zrangeCalls.push({ key, args });
    return super.zrange(key, ...args);
  }

  revisionScanCount(briefDate) {
    const key = `jj-invest-public:dynamic-beta:news:v1:draft:${briefDate}:revisions`;
    return this.zrangeCalls.filter((candidate) => candidate.key === key).length;
  }
}
