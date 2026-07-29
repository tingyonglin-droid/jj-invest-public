import { readFile as readFileFromDisk } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { createConfiguredNewsDraftService } from "../app/api/dynamic-beta/_shared.js";
import { getDynamicBetaNewsFlags } from "../src/lib/dynamic-beta/config.js";
import {
  MorningBriefDraftSubmissionError,
  submitMorningBriefDraftFile,
} from "../src/lib/dynamic-beta/news/draft-submission.js";

function writeJsonLine(stream, value) {
  stream.write(`${JSON.stringify(value)}\n`);
}

export async function runMorningBriefDraftSubmit({
  argv = process.argv.slice(2),
  environment = process.env,
  readFile = readFileFromDisk,
  getService = () => createConfiguredNewsDraftService(),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  if (!Array.isArray(argv) || argv.length !== 1 || !String(argv[0] || "").trim()) {
    writeJsonLine(stderr, {
      ok: false,
      code: "INVALID_ARGUMENTS",
      error: "請提供一個晨報草稿 JSON 檔案路徑。",
    });
    return 1;
  }

  try {
    const result = await submitMorningBriefDraftFile({
      inputPath: String(argv[0]),
      readFile,
      newsDataEnabled: getDynamicBetaNewsFlags(environment).dataEnabled,
      getService,
    });
    writeJsonLine(stdout, { ok: true, ...result });
    return 0;
  } catch (error) {
    const known = error instanceof MorningBriefDraftSubmissionError;
    writeJsonLine(stderr, {
      ok: false,
      code: known ? error.code : "SUBMISSION_FAILED",
      error: known
        ? error.message
        : "晨報草稿提交失敗，既有正式資料未受影響。",
    });
    return 1;
  }
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  process.exitCode = await runMorningBriefDraftSubmit();
}
