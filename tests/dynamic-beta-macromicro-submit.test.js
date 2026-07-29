import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MacroMicroSubmissionError,
  submitMacroMicroFile,
} from "../src/lib/dynamic-beta/macromicro-submission.js";
import {
  runMacroMicroSubmit,
} from "../scripts/dynamic-beta-macromicro-submit.js";

function successfulService(overrides = {}) {
  return {
    async ingest() {
      return {
        seriesId: "MACROMICRO:TAIEX_MARGIN_MAINTENANCE",
        status: "success",
        inserted: 1,
        revised: 0,
        unchanged: 0,
        latestObservationDate: "2026-07-28",
        ...overrides,
      };
    },
  };
}

async function captureSubmissionError(task) {
  try {
    await task();
  } catch (error) {
    assert.ok(error instanceof MacroMicroSubmissionError);
    return error;
  }
  assert.fail("Expected MacroMicro submission to fail.");
}

describe("MacroMicro submission", () => {
  it("rejects a missing input path before touching storage", async () => {
    let serviceRequested = false;
    const error = await captureSubmissionError(() => submitMacroMicroFile({
      inputPath: " ",
      readFile: async () => "{}",
      dataEnabled: true,
      getService: () => {
        serviceRequested = true;
        return successfulService();
      },
    }));

    assert.equal(error.code, "INPUT_REQUIRED");
    assert.equal(serviceRequested, false);
  });

  it("fails closed when the data feature flag is disabled", async () => {
    let fileRead = false;
    const error = await captureSubmissionError(() => submitMacroMicroFile({
      inputPath: "/private/tmp/macromicro.json",
      readFile: async () => {
        fileRead = true;
        return "{}";
      },
      dataEnabled: false,
      getService: () => successfulService(),
    }));

    assert.equal(error.code, "DATA_DISABLED");
    assert.equal(fileRead, false);
  });

  it("reports file read failures without exposing the source error", async () => {
    const secret = "UPSTASH_REDIS_REST_TOKEN=do-not-print";
    const error = await captureSubmissionError(() => submitMacroMicroFile({
      inputPath: "/private/tmp/macromicro.json",
      readFile: async () => {
        throw new Error(secret);
      },
      dataEnabled: true,
      getService: () => successfulService(),
    }));

    assert.equal(error.code, "INPUT_READ_FAILED");
    assert.doesNotMatch(error.message, /do-not-print/);
  });

  it("reports invalid JSON without echoing its contents", async () => {
    const secret = "FRED_API_KEY=do-not-print";
    const error = await captureSubmissionError(() => submitMacroMicroFile({
      inputPath: "/private/tmp/macromicro.json",
      readFile: async () => `{${secret}`,
      dataEnabled: true,
      getService: () => successfulService(),
    }));

    assert.equal(error.code, "INVALID_JSON");
    assert.doesNotMatch(error.message, /do-not-print/);
  });

  it("fails closed when the configured ingestion service is unavailable", async () => {
    const error = await captureSubmissionError(() => submitMacroMicroFile({
      inputPath: "/private/tmp/macromicro.json",
      readFile: async () => "{}",
      dataEnabled: true,
      getService: () => null,
    }));

    assert.equal(error.code, "SERVICE_UNCONFIGURED");
  });

  it("returns only the safe stored-observation summary", async () => {
    const payload = { observationDate: "2026-07-28", value: 166.5, sourceUrl: "not-returned" };
    let receivedPayload = null;
    const result = await submitMacroMicroFile({
      inputPath: "/private/tmp/macromicro.json",
      readFile: async () => JSON.stringify(payload),
      dataEnabled: true,
      getService: () => ({
        async ingest(value) {
          receivedPayload = value;
          return successfulService().ingest();
        },
      }),
    });

    assert.deepEqual(receivedPayload, payload);
    assert.deepEqual(result, {
      seriesId: "MACROMICRO:TAIEX_MARGIN_MAINTENANCE",
      status: "success",
      inserted: 1,
      revised: 0,
      unchanged: 0,
      latestObservationDate: "2026-07-28",
    });
    assert.equal("payload" in result, false);
  });

  it("rejects a success result with invalid observation counts", async () => {
    const error = await captureSubmissionError(() => submitMacroMicroFile({
      inputPath: "/private/tmp/macromicro.json",
      readFile: async () => "{}",
      dataEnabled: true,
      getService: () => successfulService({ inserted: -1 }),
    }));

    assert.equal(error.code, "INVALID_RESULT");
    assert.equal(error.message, "M 平方同步結果無效，既有 observation 未受影響。");
  });

  it("converts a reported MacroMicro source error into a safe submission error", async () => {
    const error = await captureSubmissionError(() => submitMacroMicroFile({
      inputPath: "/private/tmp/macromicro.json",
      readFile: async () => JSON.stringify({
        errorCode: "PAGE_UNAVAILABLE",
        sourceUrl:
          "https://www.macromicro.me/charts/53117/taiwan-taiex-maintenance-margin",
      }),
      dataEnabled: true,
      getService: () => successfulService({
        status: "error",
        errorCode: "PAGE_UNAVAILABLE",
      }),
    }));

    assert.equal(error.code, "PAGE_UNAVAILABLE");
    assert.equal(error.message, "M 平方來源同步失敗，已保留既有 observation。");
  });
});

function outputBuffer() {
  let value = "";
  return {
    stream: {
      write(chunk) {
        value += String(chunk);
      },
    },
    read() {
      return value;
    },
  };
}

async function runWithServiceResult(result) {
  const stdout = outputBuffer();
  const stderr = outputBuffer();
  const exitCode = await runMacroMicroSubmit({
    argv: ["/private/tmp/macromicro.json"],
    environment: { DYNAMIC_BETA_DATA_ENABLED: "true" },
    readFile: async () => "{}",
    getService: () => ({ async ingest() { return result; } }),
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  return { exitCode, stdout: stdout.read(), stderr: stderr.read() };
}

async function captureCliWithServiceResult(result) {
  try {
    return { rejected: false, ...(await runWithServiceResult(result)) };
  } catch {
    return { rejected: true, exitCode: null, stdout: "", stderr: "" };
  }
}

describe("MacroMicro submission CLI", () => {
  it("requires exactly one JSON file path", async () => {
    const stdout = outputBuffer();
    const stderr = outputBuffer();
    const exitCode = await runMacroMicroSubmit({
      argv: [],
      environment: { DYNAMIC_BETA_DATA_ENABLED: "true" },
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    assert.equal(exitCode, 1);
    assert.equal(stdout.read(), "");
    assert.deepEqual(JSON.parse(stderr.read()), {
      ok: false,
      code: "INVALID_ARGUMENTS",
      error: "請提供一個 M 平方 JSON 檔案路徑。",
    });
  });

  it("uses the strict server-side data flag", async () => {
    const stderr = outputBuffer();
    let fileRead = false;
    const exitCode = await runMacroMicroSubmit({
      argv: ["/private/tmp/macromicro.json"],
      environment: { DYNAMIC_BETA_DATA_ENABLED: "TRUE" },
      readFile: async () => {
        fileRead = true;
        return "{}";
      },
      getService: () => successfulService(),
      stdout: outputBuffer().stream,
      stderr: stderr.stream,
    });

    assert.equal(exitCode, 1);
    assert.equal(fileRead, false);
    assert.equal(JSON.parse(stderr.read()).code, "DATA_DISABLED");
  });

  it("prints one safe JSON line after storing an observation", async () => {
    const stdout = outputBuffer();
    const stderr = outputBuffer();
    const exitCode = await runMacroMicroSubmit({
      argv: ["/private/tmp/macromicro.json"],
      environment: { DYNAMIC_BETA_DATA_ENABLED: "true" },
      readFile: async () => "{}",
      getService: () => successfulService(),
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    assert.equal(exitCode, 0);
    assert.equal(stderr.read(), "");
    assert.equal(stdout.read().split("\n").length, 2);
    assert.deepEqual(JSON.parse(stdout.read()), {
      ok: true,
      seriesId: "MACROMICRO:TAIEX_MARGIN_MAINTENANCE",
      status: "success",
      inserted: 1,
      revised: 0,
      unchanged: 0,
      latestObservationDate: "2026-07-28",
    });
  });

  it("rejects a non-success ingestion result instead of reporting a stored observation", async () => {
    const stdout = outputBuffer();
    const stderr = outputBuffer();
    const exitCode = await runMacroMicroSubmit({
      argv: ["/private/tmp/macromicro.json"],
      environment: { DYNAMIC_BETA_DATA_ENABLED: "true" },
      readFile: async () => "{}",
      getService: () => successfulService({ status: "pending" }),
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    assert.equal(exitCode, 1);
    assert.equal(stdout.read(), "");
    assert.deepEqual(JSON.parse(stderr.read()), {
      ok: false,
      code: "INVALID_RESULT",
      error: "M 平方同步結果無效，既有 observation 未受影響。",
    });
  });

  it("maps every malformed source-error summary to sanitized INVALID_RESULT", async () => {
    const inherited = Object.create({ errorCode: "PAGE_UNAVAILABLE" });
    inherited.seriesId = "MACROMICRO:TAIEX_MARGIN_MAINTENANCE";
    inherited.status = "error";
    const cases = [
      {
        result: { status: "error", errorCode: "PAGE_UNAVAILABLE" },
        untrusted: "PAGE_UNAVAILABLE",
      },
      {
        result: {
          seriesId: "WRONG_SERIES_SECRET",
          status: "error",
          errorCode: "PAGE_UNAVAILABLE",
        },
        untrusted: "WRONG_SERIES_SECRET",
      },
      {
        result: {
          seriesId: "MACROMICRO:TAIEX_MARGIN_MAINTENANCE",
          status: "error",
        },
      },
      {
        result: {
          seriesId: "MACROMICRO:TAIEX_MARGIN_MAINTENANCE",
          status: "error",
          errorCode: { secret: "OBJECT_CODE_SECRET" },
        },
        untrusted: "OBJECT_CODE_SECRET",
      },
      {
        result: {
          seriesId: "MACROMICRO:TAIEX_MARGIN_MAINTENANCE",
          status: "error",
          errorCode: {
            [Symbol.toPrimitive]() {
              throw new Error("COERCION_SECRET");
            },
          },
        },
        untrusted: "COERCION_SECRET",
      },
      {
        result: {
          seriesId: "MACROMICRO:TAIEX_MARGIN_MAINTENANCE",
          status: "error",
          errorCode: "UNSUPPORTED_CODE_SECRET",
        },
        untrusted: "UNSUPPORTED_CODE_SECRET",
      },
      {
        result: {
          seriesId: "MACROMICRO:TAIEX_MARGIN_MAINTENANCE",
          status: "error",
          errorCode: "UPSTASH_REDIS_REST_TOKEN=leak-me",
        },
        untrusted: "leak-me",
      },
      { result: inherited },
    ];

    for (const { result, untrusted } of cases) {
      const stdout = outputBuffer();
      const stderr = outputBuffer();
      const exitCode = await runMacroMicroSubmit({
        argv: ["/private/tmp/macromicro.json"],
        environment: { DYNAMIC_BETA_DATA_ENABLED: "true" },
        readFile: async () => "{}",
        getService: () => ({ async ingest() { return result; } }),
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      assert.equal(exitCode, 1);
      assert.equal(stdout.read(), "");
      assert.deepEqual(JSON.parse(stderr.read()), {
        ok: false,
        code: "INVALID_RESULT",
        error: "M 平方同步結果無效，既有 observation 未受影響。",
      });
      if (untrusted) assert.equal(stderr.read().includes(untrusted), false);
    }
  });

  it("uses one captured allowlisted code from a changing source-error getter", async () => {
    let reads = 0;
    const result = {
      seriesId: "MACROMICRO:TAIEX_MARGIN_MAINTENANCE",
      status: "error",
      get errorCode() {
        reads += 1;
        return reads < 3
          ? "PAGE_UNAVAILABLE"
          : "UPSTASH_REDIS_REST_TOKEN=leak-me";
      },
    };

    const output = await runWithServiceResult(result);

    assert.equal(output.exitCode, 1);
    assert.equal(output.stdout, "");
    assert.deepEqual(JSON.parse(output.stderr), {
      ok: false,
      code: "PAGE_UNAVAILABLE",
      error: "M 平方來源同步失敗，已保留既有 observation。",
    });
    assert.equal(reads, 1);
    assert.equal(output.stderr.includes("leak-me"), false);
  });

  it("maps throwing source-error accessors and proxies to fixed INVALID_RESULT", async () => {
    let accessorReads = 0;
    const throwingAccessor = {
      seriesId: "MACROMICRO:TAIEX_MARGIN_MAINTENANCE",
      status: "error",
      get errorCode() {
        accessorReads += 1;
        throw new Error("ACCESSOR_SECRET");
      },
    };
    const throwingProxy = new Proxy({
      seriesId: "MACROMICRO:TAIEX_MARGIN_MAINTENANCE",
      status: "error",
      errorCode: "PAGE_UNAVAILABLE",
    }, {
      getOwnPropertyDescriptor() {
        throw new Error("PROXY_SECRET");
      },
    });

    for (const result of [throwingAccessor, throwingProxy]) {
      const output = await runWithServiceResult(result);

      assert.equal(output.exitCode, 1);
      assert.equal(output.stdout, "");
      assert.deepEqual(JSON.parse(output.stderr), {
        ok: false,
        code: "INVALID_RESULT",
        error: "M 平方同步結果無效，既有 observation 未受影響。",
      });
      assert.doesNotMatch(output.stderr, /ACCESSOR_SECRET|PROXY_SECRET/);
    }
    assert.equal(accessorReads, 1);
  });

  it("maps a result proxy revoked during promise assimilation to INVALID_RESULT", async () => {
    let revoke;
    const revocable = Proxy.revocable({}, {
      get(target, property, receiver) {
        if (property === "then") {
          revoke();
          return undefined;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    revoke = revocable.revoke;

    const output = await runWithServiceResult(revocable.proxy);

    assert.equal(output.exitCode, 1);
    assert.equal(output.stdout, "");
    assert.deepEqual(JSON.parse(output.stderr), {
      ok: false,
      code: "INVALID_RESULT",
      error: "M 平方同步結果無效，既有 observation 未受影響。",
    });
  });

  it("maps hostile thenable rejection values and throwing then getters to INVALID_RESULT", async () => {
    const secretObjectThenable = {
      then(_resolve, reject) {
        reject({
          code: "UPSTASH_REDIS_REST_TOKEN=REJECTION_SECRET",
          message: "REJECTION_MESSAGE_SECRET",
        });
      },
    };
    const throwingThenGetter = Object.defineProperty({}, "then", {
      get() {
        throw new Error("THEN_GETTER_SECRET");
      },
    });

    for (const result of [secretObjectThenable, throwingThenGetter]) {
      const output = await captureCliWithServiceResult(result);

      assert.equal(output.rejected, false);
      assert.equal(output.exitCode, 1);
      assert.equal(output.stdout, "");
      assert.deepEqual(JSON.parse(output.stderr), {
        ok: false,
        code: "INVALID_RESULT",
        error: "M 平方同步結果無效，既有 observation 未受影響。",
      });
      assert.doesNotMatch(
        output.stderr,
        /REJECTION_SECRET|REJECTION_MESSAGE_SECRET|THEN_GETTER_SECRET/,
      );
    }
  });

  it("settles with INVALID_RESULT when a thenable revokes and rejects with itself", async () => {
    let proxy;
    let revoke;
    const revocable = Proxy.revocable({
      then(_resolve, reject) {
        revoke();
        reject(proxy);
      },
    }, {});
    proxy = revocable.proxy;
    revoke = revocable.revoke;

    const output = await captureCliWithServiceResult(proxy);

    assert.equal(output.rejected, false);
    assert.equal(output.exitCode, 1);
    assert.equal(output.stdout, "");
    assert.deepEqual(JSON.parse(output.stderr), {
      ok: false,
      code: "INVALID_RESULT",
      error: "M 平方同步結果無效，既有 observation 未受影響。",
    });
  });

  it("does not trust a thenable proxy impersonating a submission error", async () => {
    let proxy;
    const target = new MacroMicroSubmissionError(
      "PAGE_UNAVAILABLE",
      "M 平方來源同步失敗，已保留既有 observation。",
    );
    proxy = new Proxy(target, {
      get(value, property, receiver) {
        if (property === "then") {
          return (_resolve, reject) => reject(proxy);
        }
        if (property === "code") {
          return "UPSTASH_REDIS_REST_TOKEN=REFLECTED_SECRET";
        }
        if (property === "message") {
          return "REFLECTED_MESSAGE_SECRET";
        }
        return Reflect.get(value, property, receiver);
      },
    });

    const output = await captureCliWithServiceResult(proxy);

    assert.equal(output.rejected, false);
    assert.equal(output.exitCode, 1);
    assert.equal(output.stdout, "");
    assert.deepEqual(JSON.parse(output.stderr), {
      ok: false,
      code: "INVALID_RESULT",
      error: "M 平方同步結果無效，既有 observation 未受影響。",
    });
    assert.doesNotMatch(output.stderr, /REFLECTED_SECRET|REFLECTED_MESSAGE_SECRET/);
  });

  it("never reads code or message accessors from an arbitrary caught error", async () => {
    let codeReads = 0;
    let messageReads = 0;
    const thrown = new MacroMicroSubmissionError(
      "PAGE_UNAVAILABLE",
      "M 平方來源同步失敗，已保留既有 observation。",
    );
    Object.defineProperties(thrown, {
      code: {
        configurable: true,
        get() {
          codeReads += 1;
          throw new Error("CODE_GETTER_SECRET");
        },
      },
      message: {
        configurable: true,
        get() {
          messageReads += 1;
          throw new Error("MESSAGE_GETTER_SECRET");
        },
      },
    });
    const stdout = outputBuffer();
    const stderr = outputBuffer();
    let rejected = false;
    let exitCode = null;
    try {
      exitCode = await runMacroMicroSubmit({
        argv: ["/private/tmp/macromicro.json"],
        environment: { DYNAMIC_BETA_DATA_ENABLED: "true" },
        readFile: async () => "{}",
        getService() { throw thrown; },
        stdout: stdout.stream,
        stderr: stderr.stream,
      });
    } catch {
      rejected = true;
    }

    assert.equal(rejected, false);
    assert.equal(exitCode, 1);
    assert.equal(stdout.read(), "");
    assert.deepEqual(JSON.parse(stderr.read()), {
      ok: false,
      code: "SUBMISSION_FAILED",
      error: "M 平方提交失敗，既有 observation 未受影響。",
    });
    assert.equal(codeReads, 0);
    assert.equal(messageReads, 0);
    assert.doesNotMatch(stderr.read(), /CODE_GETTER_SECRET|MESSAGE_GETTER_SECRET/);
  });

  it("snapshots each successful result field once before validation and output", async () => {
    const reads = new Map();
    const expected = {
      seriesId: "MACROMICRO:TAIEX_MARGIN_MAINTENANCE",
      status: "success",
      inserted: 1,
      revised: 0,
      unchanged: 0,
      latestObservationDate: "2026-07-28",
    };
    const result = {};
    for (const [key, value] of Object.entries(expected)) {
      Object.defineProperty(result, key, {
        enumerable: true,
        get() {
          const count = (reads.get(key) || 0) + 1;
          reads.set(key, count);
          return count === 1 ? value : `${key.toUpperCase()}_SECRET`;
        },
      });
    }

    const output = await runWithServiceResult(result);

    assert.equal(output.exitCode, 0);
    assert.equal(output.stderr, "");
    assert.deepEqual(JSON.parse(output.stdout), { ok: true, ...expected });
    assert.deepEqual(Object.fromEntries(reads), {
      seriesId: 1,
      status: 1,
      inserted: 1,
      revised: 1,
      unchanged: 1,
      latestObservationDate: 1,
    });
    assert.equal(output.stdout.includes("_SECRET"), false);
  });

  it("maps unexpected ingestion rejections to INVALID_RESULT without exposing them", async () => {
    const stderr = outputBuffer();
    const secret = "KV_REST_API_TOKEN=do-not-print";
    const exitCode = await runMacroMicroSubmit({
      argv: ["/private/tmp/macromicro.json"],
      environment: { DYNAMIC_BETA_DATA_ENABLED: "true" },
      readFile: async () => "{}",
      getService: () => ({
        async ingest() {
          throw new Error(secret);
        },
      }),
      stdout: outputBuffer().stream,
      stderr: stderr.stream,
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(JSON.parse(stderr.read()), {
      ok: false,
      code: "INVALID_RESULT",
      error: "M 平方同步結果無效，既有 observation 未受影響。",
    });
    assert.doesNotMatch(stderr.read(), /do-not-print|stack/);
  });
});
