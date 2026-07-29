import { readFile as readFileFromDisk } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { createConfiguredMacroMicroIngestionService } from "../app/api/dynamic-beta/_shared.js";
import { getDynamicBetaFlags } from "../src/lib/dynamic-beta/config.js";
import {
  getMacroMicroSubmissionErrorSummary,
  submitMacroMicroFile,
} from "../src/lib/dynamic-beta/macromicro-submission.js";

function writeJsonLine(stream, value) {
  stream.write(`${JSON.stringify(value)}\n`);
}

export async function runMacroMicroSubmit({
  argv = process.argv.slice(2),
  environment = process.env,
  readFile = readFileFromDisk,
  getService = () => createConfiguredMacroMicroIngestionService(),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  if (!Array.isArray(argv) || argv.length !== 1 || !String(argv[0] || "").trim()) {
    writeJsonLine(stderr, {
      ok: false,
      code: "INVALID_ARGUMENTS",
      error: "請提供一個 M 平方 JSON 檔案路徑。",
    });
    return 1;
  }

  try {
    const result = await submitMacroMicroFile({
      inputPath: String(argv[0]),
      readFile,
      dataEnabled: getDynamicBetaFlags(environment).dataEnabled,
      getService,
    });
    writeJsonLine(stdout, { ok: true, ...result });
    return 0;
  } catch (error) {
    const known = getMacroMicroSubmissionErrorSummary(error);
    writeJsonLine(stderr, {
      ok: false,
      code: known ? known.code : "SUBMISSION_FAILED",
      error: known
        ? known.message
        : "M 平方提交失敗，既有 observation 未受影響。",
    });
    return 1;
  }
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  process.exitCode = await runMacroMicroSubmit();
}
