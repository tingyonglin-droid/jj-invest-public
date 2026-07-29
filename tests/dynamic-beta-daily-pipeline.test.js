import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createDynamicBetaDailyPipeline,
} from "../src/lib/dynamic-beta/daily-pipeline.js";
import {
  DynamicBetaDailyPipelineSubmissionError,
  submitDynamicBetaDailyPipelineFile,
} from "../src/lib/dynamic-beta/daily-pipeline-submission.js";
import {
  runDynamicBetaDailyPipeline,
} from "../scripts/dynamic-beta-daily-pipeline.js";
import {
  createConfiguredMacroMicroIngestionService,
  createConfiguredSyncService,
} from "../app/api/dynamic-beta/_shared.js";

describe("Dynamic Beta daily pipeline", () => {
  it("runs automatic sync, MacroMicro ingestion, and confirmation snapshots in order", async () => {
    const calls = [];
    const macroMicroPayload = {
      observationDate: "2026-07-29",
      value: 166.5,
    };
    let receivedMacroMicroPayload = null;
    let receivedSnapshotOptions = null;
    const pipeline = createDynamicBetaDailyPipeline({
      syncService: {
        async sync(options) {
          calls.push("automatic-sync");
          assert.deepEqual(options, {});
          return {
            status: "success",
            results: [
              { seriesId: "VIXCLS", status: "success", inserted: 1 },
              { seriesId: "YAHOO:SPY", status: "success", unchanged: 2 },
            ],
          };
        },
      },
      macroMicroService: {
        async ingest(payload) {
          calls.push("macromicro-ingest");
          receivedMacroMicroPayload = payload;
          return {
            seriesId: "MACROMICRO:TAIEX_MARGIN_MAINTENANCE",
            status: "success",
            inserted: 1,
            revised: 0,
            unchanged: 0,
          };
        },
      },
      snapshotService: {
        async run(options) {
          calls.push("confirmation-snapshots");
          receivedSnapshotOptions = options;
          return {
            status: "success",
            selected: 1,
            skippedComplete: 0,
            inserted: 1,
            revised: 0,
            unchanged: 0,
            failed: 0,
          };
        },
      },
      logger: null,
    });

    const result = await pipeline.run({
      macroMicroPayload,
      asOf: "2026-07-29",
    });

    assert.deepEqual(calls, [
      "automatic-sync",
      "macromicro-ingest",
      "confirmation-snapshots",
    ]);
    assert.equal(receivedMacroMicroPayload, macroMicroPayload);
    assert.deepEqual(receivedSnapshotOptions, { asOf: "2026-07-29" });
    assert.deepEqual(result, {
      status: "success",
      stages: [
        {
          name: "automatic-sync",
          status: "success",
          code: null,
          counts: { total: 2, succeeded: 2, failed: 0 },
        },
        {
          name: "macromicro-ingest",
          status: "success",
          code: null,
          counts: { inserted: 1, revised: 0, unchanged: 0 },
        },
        {
          name: "confirmation-snapshots",
          status: "success",
          code: null,
          counts: {
            selected: 1,
            skippedComplete: 0,
            inserted: 1,
            revised: 0,
            unchanged: 0,
            failed: 0,
          },
        },
      ],
    });
    assert.equal(
      result.stages[0].counts.total,
      2,
      "external MacroMicro data must not be part of automatic sync results",
    );
  });

  it("keeps running after an automatic-sync partial result", async () => {
    const calls = [];
    const pipeline = createDynamicBetaDailyPipeline({
      syncService: {
        async sync() {
          calls.push("automatic-sync");
          return {
            status: "partial",
            results: [
              { seriesId: "VIXCLS", status: "error", error: "not-returned" },
              { seriesId: "YAHOO:SPY", status: "success", inserted: 2 },
            ],
          };
        },
      },
      macroMicroService: {
        async ingest() {
          calls.push("macromicro-ingest");
          return { status: "success", inserted: 0, revised: 0, unchanged: 1 };
        },
      },
      snapshotService: {
        async run() {
          calls.push("confirmation-snapshots");
          return {
            status: "success",
            selected: 0,
            skippedComplete: 0,
            inserted: 0,
            revised: 0,
            unchanged: 0,
            failed: 0,
          };
        },
      },
    });

    const result = await pipeline.run({ macroMicroPayload: {}, asOf: "2026-07-29" });

    assert.deepEqual(calls, [
      "automatic-sync",
      "macromicro-ingest",
      "confirmation-snapshots",
    ]);
    assert.deepEqual(result.stages[0], {
      name: "automatic-sync",
      status: "partial",
      code: "AUTOMATIC_SYNC_PARTIAL",
      counts: { total: 2, succeeded: 1, failed: 1 },
    });
    assert.equal(result.status, "partial");
  });

  it("maps automatic-sync lock contention to skipped_locked and continues", async () => {
    const calls = [];
    const pipeline = createDynamicBetaDailyPipeline({
      syncService: {
        async sync() {
          calls.push("automatic-sync");
          throw new Error("Dynamic Beta 資料同步已在執行中。");
        },
      },
      macroMicroService: {
        async ingest() {
          calls.push("macromicro-ingest");
          return { status: "success", inserted: 1, revised: 0, unchanged: 0 };
        },
      },
      snapshotService: {
        async run() {
          calls.push("confirmation-snapshots");
          return {
            status: "success",
            selected: 0,
            skippedComplete: 0,
            inserted: 0,
            revised: 0,
            unchanged: 0,
            failed: 0,
          };
        },
      },
    });

    const result = await pipeline.run({ macroMicroPayload: {}, asOf: "2026-07-29" });

    assert.deepEqual(calls, [
      "automatic-sync",
      "macromicro-ingest",
      "confirmation-snapshots",
    ]);
    assert.deepEqual(result.stages[0], {
      name: "automatic-sync",
      status: "skipped_locked",
      code: "SYNC_LOCKED",
      counts: { total: 0, succeeded: 0, failed: 0 },
    });
  });

  it("maps a MacroMicro source failure to a fixed error and snapshots stored data", async () => {
    let snapshotsRan = false;
    const pipeline = createDynamicBetaDailyPipeline({
      syncService: {
        async sync() {
          return { status: "success", results: [] };
        },
      },
      macroMicroService: {
        async ingest() {
          return {
            seriesId: "MACROMICRO:TAIEX_MARGIN_MAINTENANCE",
            status: "error",
            errorCode: "PAGE_UNAVAILABLE",
          };
        },
      },
      snapshotService: {
        async run() {
          snapshotsRan = true;
          return {
            status: "success",
            selected: 1,
            skippedComplete: 1,
            inserted: 0,
            revised: 0,
            unchanged: 0,
            failed: 0,
          };
        },
      },
    });

    const result = await pipeline.run({ macroMicroPayload: {}, asOf: "2026-07-29" });

    assert.equal(snapshotsRan, true);
    assert.deepEqual(result.stages[1], {
      name: "macromicro-ingest",
      status: "error",
      code: "MACROMICRO_SOURCE_FAILED",
      counts: { inserted: 0, revised: 0, unchanged: 0 },
    });
    assert.equal(result.stages[2].status, "success");
  });

  it("maps MacroMicro lock contention to skipped_locked and continues", async () => {
    let snapshotsRan = false;
    const pipeline = createDynamicBetaDailyPipeline({
      syncService: { async sync() { return { status: "success", results: [] }; } },
      macroMicroService: {
        async ingest() {
          throw new Error("prefix Dynamic Beta 資料同步已在執行中。 suffix");
        },
      },
      snapshotService: {
        async run() {
          snapshotsRan = true;
          return {
            status: "success",
            selected: 0,
            skippedComplete: 0,
            inserted: 0,
            revised: 0,
            unchanged: 0,
            failed: 0,
          };
        },
      },
    });

    const result = await pipeline.run({ macroMicroPayload: {}, asOf: "2026-07-29" });

    assert.equal(snapshotsRan, true);
    assert.deepEqual(result.stages[1], {
      name: "macromicro-ingest",
      status: "skipped_locked",
      code: "SYNC_LOCKED",
      counts: { inserted: 0, revised: 0, unchanged: 0 },
    });
  });

  it("keeps earlier summaries when the snapshot service throws", async () => {
    const pipeline = createDynamicBetaDailyPipeline({
      syncService: {
        async sync() {
          return { status: "success", results: [{ status: "success" }] };
        },
      },
      macroMicroService: {
        async ingest() {
          return { status: "success", inserted: 0, revised: 1, unchanged: 0 };
        },
      },
      snapshotService: {
        async run() {
          throw new Error("snapshot internals");
        },
      },
    });

    const result = await pipeline.run({ macroMicroPayload: {}, asOf: "2026-07-29" });

    assert.equal(result.stages.length, 3);
    assert.equal(result.stages[0].status, "success");
    assert.equal(result.stages[1].status, "success");
    assert.deepEqual(result.stages[2], {
      name: "confirmation-snapshots",
      status: "error",
      code: "SNAPSHOT_RUN_FAILED",
      counts: {
        selected: 0,
        skippedComplete: 0,
        inserted: 0,
        revised: 0,
        unchanged: 0,
        failed: 0,
      },
    });
  });

  it("never returns or logs exception messages and emits only non-negative integer counts", async () => {
    const secret = [
      "FRED_API_KEY=fred-secret",
      "UPSTASH_REDIS_REST_TOKEN=redis-secret",
      "payload={source-secret}",
      "<html>source html</html>",
    ].join(" ");
    const logged = [];
    const pipeline = createDynamicBetaDailyPipeline({
      syncService: {
        async sync() {
          throw new Error(secret);
        },
      },
      macroMicroService: {
        async ingest() {
          return { status: "success", inserted: -1, revised: 1.5, unchanged: "2" };
        },
      },
      snapshotService: {
        async run() {
          return {
            status: "partial",
            selected: -3,
            skippedComplete: 2,
            inserted: null,
            revised: 0,
            unchanged: 0,
            failed: 1,
          };
        },
      },
      logger: {
        error(...args) {
          logged.push(args);
        },
      },
    });

    const result = await pipeline.run({ macroMicroPayload: {}, asOf: "2026-07-29" });
    const serialized = JSON.stringify({ result, logged });

    assert.doesNotMatch(serialized, /fred-secret|redis-secret|source-secret|source html/);
    assert.deepEqual(result.stages[1].counts, {
      inserted: 0,
      revised: 0,
      unchanged: 0,
    });
    assert.deepEqual(result.stages[2], {
      name: "confirmation-snapshots",
      status: "partial",
      code: "SNAPSHOT_RUN_PARTIAL",
      counts: {
        selected: 0,
        skippedComplete: 2,
        inserted: 0,
        revised: 0,
        unchanged: 0,
        failed: 1,
      },
    });
    for (const stage of result.stages) {
      assert.deepEqual(Object.keys(stage), ["name", "status", "code", "counts"]);
      assert.ok(Object.values(stage.counts).every(
        (count) => Number.isInteger(count) && count >= 0,
      ));
    }
  });
});

const enabledEnvironment = Object.freeze({
  DYNAMIC_BETA_DATA_ENABLED: "true",
  DYNAMIC_BETA_NEWS_DATA_ENABLED: "true",
});

function safePipelineResult(status = "success") {
  return {
    status,
    stages: [
      {
        name: "automatic-sync",
        status: status === "success" ? "success" : "error",
        code: status === "success" ? null : "AUTOMATIC_SYNC_FAILED",
        counts: { total: 1, succeeded: status === "success" ? 1 : 0, failed: status === "success" ? 0 : 1 },
      },
      {
        name: "macromicro-ingest",
        status: "success",
        code: null,
        counts: { inserted: 1, revised: 0, unchanged: 0 },
      },
      {
        name: "confirmation-snapshots",
        status: "success",
        code: null,
        counts: {
          selected: 0,
          skippedComplete: 0,
          inserted: 0,
          revised: 0,
          unchanged: 0,
          failed: 0,
        },
      },
    ],
  };
}

async function captureSubmissionError(task) {
  try {
    await task();
  } catch (error) {
    assert.ok(error instanceof DynamicBetaDailyPipelineSubmissionError);
    return error;
  }
  assert.fail("Expected daily pipeline submission to fail.");
}

describe("Dynamic Beta daily pipeline file submission", () => {
  it("rejects a missing path before reading a file or constructing services", async () => {
    let fileRead = false;
    let pipelineRequested = false;
    const error = await captureSubmissionError(() => submitDynamicBetaDailyPipelineFile({
      inputPath: " ",
      readFile: async () => {
        fileRead = true;
        return "{}";
      },
      environment: enabledEnvironment,
      getPipeline: () => {
        pipelineRequested = true;
        return { run: async () => safePipelineResult() };
      },
      now: () => new Date("2026-07-29T00:00:00.000Z"),
    }));

    assert.equal(error.code, "INPUT_REQUIRED");
    assert.equal(fileRead, false);
    assert.equal(pipelineRequested, false);
  });

  it("checks both strict data flags before reading or constructing services", async () => {
    const cases = [
      {
        environment: {
          DYNAMIC_BETA_DATA_ENABLED: "TRUE",
          DYNAMIC_BETA_NEWS_DATA_ENABLED: "true",
        },
        code: "DATA_DISABLED",
      },
      {
        environment: {
          DYNAMIC_BETA_DATA_ENABLED: "true",
          DYNAMIC_BETA_NEWS_DATA_ENABLED: "TRUE",
        },
        code: "NEWS_DATA_DISABLED",
      },
    ];

    for (const testCase of cases) {
      let fileRead = false;
      let pipelineRequested = false;
      const error = await captureSubmissionError(() => submitDynamicBetaDailyPipelineFile({
        inputPath: "/private/tmp/macromicro.json",
        readFile: async () => {
          fileRead = true;
          return "{}";
        },
        environment: testCase.environment,
        getPipeline: () => {
          pipelineRequested = true;
          return { run: async () => safePipelineResult() };
        },
        now: () => new Date("2026-07-29T00:00:00.000Z"),
      }));

      assert.equal(error.code, testCase.code);
      assert.equal(fileRead, false);
      assert.equal(pipelineRequested, false);
    }
  });

  it("sanitizes file and JSON failures", async () => {
    const readSecret = "UPSTASH_REDIS_REST_TOKEN=read-secret";
    const readError = await captureSubmissionError(() => submitDynamicBetaDailyPipelineFile({
      inputPath: "/private/tmp/macromicro.json",
      readFile: async () => { throw new Error(readSecret); },
      environment: enabledEnvironment,
      getPipeline: () => ({ run: async () => safePipelineResult() }),
      now: () => new Date("2026-07-29T00:00:00.000Z"),
    }));
    const jsonSecret = "FRED_API_KEY=json-secret";
    const jsonError = await captureSubmissionError(() => submitDynamicBetaDailyPipelineFile({
      inputPath: "/private/tmp/macromicro.json",
      readFile: async () => `{${jsonSecret}`,
      environment: enabledEnvironment,
      getPipeline: () => ({ run: async () => safePipelineResult() }),
      now: () => new Date("2026-07-29T00:00:00.000Z"),
    }));

    assert.equal(readError.code, "INPUT_READ_FAILED");
    assert.equal(jsonError.code, "INVALID_JSON");
    assert.doesNotMatch(`${readError.message}${jsonError.message}`, /read-secret|json-secret/);
  });

  it("derives the exact Asia/Taipei date and does not require a FRED key", async () => {
    const payload = { observationDate: "2026-07-29", value: 166.5 };
    let received = null;
    const result = await submitDynamicBetaDailyPipelineFile({
      inputPath: " /private/tmp/macromicro.json ",
      readFile: async (path, encoding) => {
        assert.equal(path, "/private/tmp/macromicro.json");
        assert.equal(encoding, "utf8");
        return JSON.stringify(payload);
      },
      environment: enabledEnvironment,
      getPipeline: () => ({
        async run(options) {
          received = options;
          return safePipelineResult();
        },
      }),
      now: () => new Date("2026-07-28T16:30:00.000Z"),
    });

    assert.deepEqual(received, { macroMicroPayload: payload, asOf: "2026-07-29" });
    assert.deepEqual(result, safePipelineResult());
  });

  it("rejects an invalid clock before constructing services", async () => {
    let pipelineRequested = false;
    const error = await captureSubmissionError(() => submitDynamicBetaDailyPipelineFile({
      inputPath: "/private/tmp/macromicro.json",
      readFile: async () => "{}",
      environment: enabledEnvironment,
      getPipeline: () => {
        pipelineRequested = true;
        return { run: async () => safePipelineResult() };
      },
      now: () => new Date("invalid"),
    }));

    assert.equal(error.code, "INVALID_DATE");
    assert.equal(pipelineRequested, false);
  });

  it("maps missing or failed lazy service construction to SERVICE_UNCONFIGURED", async () => {
    for (const getPipeline of [
      () => null,
      () => { throw new Error("KV_REST_API_TOKEN=constructor-secret"); },
    ]) {
      const error = await captureSubmissionError(() => submitDynamicBetaDailyPipelineFile({
        inputPath: "/private/tmp/macromicro.json",
        readFile: async () => "{}",
        environment: enabledEnvironment,
        getPipeline,
        now: () => new Date("2026-07-29T00:00:00.000Z"),
      }));

      assert.equal(error.code, "SERVICE_UNCONFIGURED");
      assert.doesNotMatch(error.message, /constructor-secret/);
    }
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

async function runCli(overrides = {}) {
  const stdout = outputBuffer();
  const stderr = outputBuffer();
  const invocation = {
    argv: ["/private/tmp/macromicro.json"],
    environment: enabledEnvironment,
    readFile: async () => "{}",
    getPipeline: () => ({ run: async () => safePipelineResult() }),
    now: () => new Date("2026-07-29T00:00:00.000Z"),
    stdout: stdout.stream,
    stderr: stderr.stream,
    ...overrides,
  };
  const exitCode = await runDynamicBetaDailyPipeline(invocation);
  return { exitCode, stdout: stdout.read(), stderr: stderr.read() };
}

describe("Dynamic Beta daily pipeline CLI", () => {
  it("requires exactly one path before reading a file", async () => {
    for (const argv of [[], ["one.json", "two.json"]]) {
      let fileRead = false;
      const result = await runCli({
        argv,
        readFile: async () => {
          fileRead = true;
          return "{}";
        },
      });

      assert.equal(result.exitCode, 1);
      assert.equal(fileRead, false);
      assert.equal(result.stdout, "");
      assert.deepEqual(JSON.parse(result.stderr), {
        ok: false,
        code: "INPUT_REQUIRED",
        error: "請提供一個 Daily pipeline JSON 檔案路徑。",
      });
      assert.equal(result.stderr.split("\n").length, 2);
    }
  });

  it("writes one success or partial JSON line only to stdout and exits zero", async () => {
    for (const status of ["success", "partial"]) {
      const safeResult = safePipelineResult(status);
      const result = await runCli({
        getPipeline: () => ({ run: async () => safeResult }),
      });

      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout.split("\n").length, 2);
      assert.deepEqual(JSON.parse(result.stdout), { ok: true, ...safeResult });
    }
  });

  it("writes each known fatal error as one fixed JSON line only to stderr", async () => {
    const cases = [
      {
        code: "INPUT_READ_FAILED",
        error: "無法讀取 Daily pipeline JSON 檔案。",
        overrides: { readFile: async () => { throw new Error("read-secret"); } },
      },
      {
        code: "INVALID_JSON",
        error: "Daily pipeline JSON 格式無效。",
        overrides: { readFile: async () => "{invalid-json-secret" },
      },
      {
        code: "DATA_DISABLED",
        error: "Dynamic Beta 資料同步功能未啟用。",
        overrides: {
          environment: {
            DYNAMIC_BETA_DATA_ENABLED: "false",
            DYNAMIC_BETA_NEWS_DATA_ENABLED: "true",
          },
        },
      },
      {
        code: "NEWS_DATA_DISABLED",
        error: "Dynamic Beta News data module 尚未啟用。",
        overrides: {
          environment: {
            DYNAMIC_BETA_DATA_ENABLED: "true",
            DYNAMIC_BETA_NEWS_DATA_ENABLED: "false",
          },
        },
      },
      {
        code: "SERVICE_UNCONFIGURED",
        error: "Daily pipeline 服務尚未設定。",
        overrides: { getPipeline: () => null },
      },
      {
        code: "INVALID_DATE",
        error: "Daily pipeline 日期無效。",
        overrides: { now: () => new Date("invalid") },
      },
    ];

    for (const testCase of cases) {
      const result = await runCli(testCase.overrides);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr.split("\n").length, 2);
      assert.deepEqual(JSON.parse(result.stderr), {
        ok: false,
        code: testCase.code,
        error: testCase.error,
      });
    }
  });

  it("sanitizes unknown failures as PIPELINE_FAILED", async () => {
    const secret = "FRED_API_KEY=fred-secret payload=<html>source-secret</html>";
    const result = await runCli({
      getPipeline: () => ({ run: async () => { throw new Error(secret); } }),
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.deepEqual(JSON.parse(result.stderr), {
      ok: false,
      code: "PIPELINE_FAILED",
      error: "Daily pipeline 執行失敗。",
    });
    assert.doesNotMatch(`${result.exitCode}${result.stdout}${result.stderr}`, /fred-secret|source-secret/);
  });

  it("constructs automatic sync without a FRED key and suppresses per-series service logs", async () => {
    const secret = "UPSTASH_REDIS_REST_TOKEN=service-log-secret";
    const consoleOutput = [];
    const originalInfo = console.info;
    const originalError = console.error;
    const hadFredKey = Object.hasOwn(process.env, "FRED_API_KEY");
    const originalFredKey = process.env.FRED_API_KEY;
    process.env.FRED_API_KEY = "";
    console.info = (...args) => { consoleOutput.push(args); };
    console.error = (...args) => { consoleOutput.push(args); };

    try {
      const service = createConfiguredSyncService({
        async acquireSyncLock() { return true; },
        async releaseSyncLock() {},
        async writeSeriesStatus() {},
        async readSeriesStatus() { throw new Error(secret); },
      }, {
        logger: { info() {}, error() {} },
      });
      const result = await service.sync({ seriesIds: ["YAHOO:SPY"] });

      assert.equal(result.status, "error");
      assert.equal(result.results.length, 1);
      assert.deepEqual(consoleOutput, []);
    } finally {
      console.info = originalInfo;
      console.error = originalError;
      if (hadFredKey) process.env.FRED_API_KEY = originalFredKey;
      else delete process.env.FRED_API_KEY;
    }
  });

  it("emits only one CLI JSON line when configured MacroMicro storage fails", async () => {
    const secret = "UPSTASH_REDIS_REST_TOKEN=macromicro-storage-secret";
    const consoleOutput = [];
    const originalError = console.error;
    console.error = (...args) => { consoleOutput.push(args); };

    try {
      const macroMicroService = createConfiguredMacroMicroIngestionService({
        async acquireSyncLock() { return true; },
        async releaseSyncLock() {},
        async writeSeriesStatus() {},
        async upsertSeriesMetadata() { throw new Error(secret); },
      }, {
        logger: { info() {}, error() {} },
      });
      const result = await runCli({
        readFile: async () => JSON.stringify({
          errorCode: "PAGE_UNAVAILABLE",
          sourceUrl: "https://www.macromicro.me/charts/53117/taiwan-taiex-maintenance-margin",
        }),
        getPipeline: () => createDynamicBetaDailyPipeline({
          syncService: { async sync() { return { status: "success", results: [] }; } },
          macroMicroService,
          snapshotService: {
            async run() {
              return {
                status: "success",
                selected: 0,
                skippedComplete: 0,
                inserted: 0,
                revised: 0,
                unchanged: 0,
                failed: 0,
              };
            },
          },
          logger: null,
        }),
      });

      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout.split("\n").length, 2);
      assert.equal(JSON.parse(result.stdout).status, "partial");
      assert.deepEqual(consoleOutput, []);
      assert.doesNotMatch(`${result.stdout}${result.stderr}`, /macromicro-storage-secret/);
    } finally {
      console.error = originalError;
    }
  });
});
