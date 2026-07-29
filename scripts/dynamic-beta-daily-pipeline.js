import { readFile as readFileFromDisk } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  createConfiguredConfirmationSnapshotService,
  createConfiguredMacroMicroIngestionService,
  createConfiguredSyncService,
  getDynamicBetaRepository,
} from "../app/api/dynamic-beta/_shared.js";
import { createDynamicBetaDailyPipeline } from "../src/lib/dynamic-beta/daily-pipeline.js";
import {
  getDynamicBetaDailyPipelineSubmissionErrorSummary,
  submitDynamicBetaDailyPipelineFile,
} from "../src/lib/dynamic-beta/daily-pipeline-submission.js";

function writeJsonLine(stream, value) {
  stream.write(`${JSON.stringify(value)}\n`);
}

const silentServiceLogger = Object.freeze({
  info() {},
  error() {},
});

export function createConfiguredDynamicBetaDailyPipeline() {
  const repository = getDynamicBetaRepository();
  const syncService = repository
    ? createConfiguredSyncService(repository, { logger: silentServiceLogger })
    : null;
  const macroMicroService = createConfiguredMacroMicroIngestionService(repository, {
    logger: silentServiceLogger,
  });
  const snapshotService = createConfiguredConfirmationSnapshotService();
  if (!syncService || !macroMicroService || !snapshotService) return null;
  return createDynamicBetaDailyPipeline({
    syncService,
    macroMicroService,
    snapshotService,
    logger: null,
  });
}

export async function runDynamicBetaDailyPipeline({
  argv = process.argv.slice(2),
  environment = process.env,
  readFile = readFileFromDisk,
  getPipeline = createConfiguredDynamicBetaDailyPipeline,
  now = () => new Date(),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  if (
    !Array.isArray(argv)
    || argv.length !== 1
    || typeof argv[0] !== "string"
    || !argv[0].trim()
  ) {
    writeJsonLine(stderr, {
      ok: false,
      code: "INPUT_REQUIRED",
      error: "請提供一個 Daily pipeline JSON 檔案路徑。",
    });
    return 1;
  }

  try {
    const result = await submitDynamicBetaDailyPipelineFile({
      inputPath: argv[0],
      readFile,
      environment,
      getPipeline,
      now,
    });
    writeJsonLine(stdout, { ok: true, ...result });
    return 0;
  } catch (error) {
    const known = getDynamicBetaDailyPipelineSubmissionErrorSummary(error);
    writeJsonLine(stderr, {
      ok: false,
      code: known ? known.code : "PIPELINE_FAILED",
      error: known ? known.message : "Daily pipeline 執行失敗。",
    });
    return 1;
  }
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  process.exitCode = await runDynamicBetaDailyPipeline();
}
