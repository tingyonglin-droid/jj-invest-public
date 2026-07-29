import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MorningBriefDraftSubmissionError,
  submitMorningBriefDraftFile,
} from "../src/lib/dynamic-beta/news/draft-submission.js";

function successfulService(overrides = {}) {
  return {
    async create() {
      return {
        saved: true,
        valid: true,
        warnings: [],
        status: "inserted",
        draft: {
          briefDate: "2026-07-29",
          draftRevisionId: "ndrv_example",
          draftRevisionNumber: 1,
          status: "pending",
        },
        ...overrides,
      };
    },
  };
}

async function captureSubmissionError(task) {
  try {
    await task();
  } catch (error) {
    assert.ok(error instanceof MorningBriefDraftSubmissionError);
    return error;
  }
  assert.fail("Expected morning brief draft submission to fail.");
}

describe("morning brief draft submission", () => {
  it("rejects a missing input path before touching storage", async () => {
    let serviceRequested = false;
    const error = await captureSubmissionError(() => submitMorningBriefDraftFile({
      inputPath: " ",
      readFile: async () => "{}",
      newsDataEnabled: true,
      getService: () => {
        serviceRequested = true;
        return successfulService();
      },
    }));

    assert.equal(error.code, "INPUT_REQUIRED");
    assert.equal(serviceRequested, false);
  });

  it("fails closed when the news data feature flag is disabled", async () => {
    let fileRead = false;
    const error = await captureSubmissionError(() => submitMorningBriefDraftFile({
      inputPath: "/private/tmp/brief.json",
      readFile: async () => {
        fileRead = true;
        return "{}";
      },
      newsDataEnabled: false,
      getService: () => successfulService(),
    }));

    assert.equal(error.code, "NEWS_DATA_DISABLED");
    assert.equal(fileRead, false);
  });

  it("reports file read failures without exposing the source error", async () => {
    const secret = "UPSTASH_REDIS_REST_TOKEN=do-not-print";
    const error = await captureSubmissionError(() => submitMorningBriefDraftFile({
      inputPath: "/private/tmp/brief.json",
      readFile: async () => {
        throw new Error(secret);
      },
      newsDataEnabled: true,
      getService: () => successfulService(),
    }));

    assert.equal(error.code, "INPUT_READ_FAILED");
    assert.doesNotMatch(error.message, /do-not-print/);
  });

  it("reports invalid JSON without echoing its contents", async () => {
    const secret = "FRED_API_KEY=do-not-print";
    const error = await captureSubmissionError(() => submitMorningBriefDraftFile({
      inputPath: "/private/tmp/brief.json",
      readFile: async () => `{${secret}`,
      newsDataEnabled: true,
      getService: () => successfulService(),
    }));

    assert.equal(error.code, "INVALID_JSON");
    assert.doesNotMatch(error.message, /do-not-print/);
  });

  it("fails closed when the configured draft service is unavailable", async () => {
    const error = await captureSubmissionError(() => submitMorningBriefDraftFile({
      inputPath: "/private/tmp/brief.json",
      readFile: async () => "{}",
      newsDataEnabled: true,
      getService: () => null,
    }));

    assert.equal(error.code, "SERVICE_UNCONFIGURED");
  });

  it("preserves safe schema validation errors without claiming a save", async () => {
    const error = await captureSubmissionError(() => submitMorningBriefDraftFile({
      inputPath: "/private/tmp/brief.json",
      readFile: async () => JSON.stringify({ briefDate: "2026-07-29" }),
      newsDataEnabled: true,
      getService: () => ({
        async create() {
          return {
            saved: false,
            valid: false,
            errors: ["events 必須剛好包含 5 個事件。"],
            warnings: [],
          };
        },
      }),
    }));

    assert.equal(error.code, "PAYLOAD_INVALID");
    assert.match(error.message, /events 必須剛好包含 5 個事件/);
  });

  it("rejects any terminal draft status returned by storage", async () => {
    const error = await captureSubmissionError(() => submitMorningBriefDraftFile({
      inputPath: "/private/tmp/brief.json",
      readFile: async () => "{}",
      newsDataEnabled: true,
      getService: () => successfulService({
        draft: {
          briefDate: "2026-07-29",
          draftRevisionId: "ndrv_approved",
          draftRevisionNumber: 1,
          status: "approved",
        },
      }),
    }));

    assert.equal(error.code, "UNSAFE_DRAFT_STATUS");
  });

  it("returns only a safe pending-draft summary", async () => {
    const payload = { briefDate: "2026-07-29", marker: "not-returned" };
    let receivedPayload = null;
    const result = await submitMorningBriefDraftFile({
      inputPath: "/private/tmp/brief.json",
      readFile: async () => JSON.stringify(payload),
      newsDataEnabled: true,
      getService: () => ({
        async create(value) {
          receivedPayload = value;
          return successfulService({ warnings: ["one warning"] }).create();
        },
      }),
    });

    assert.deepEqual(receivedPayload, payload);
    assert.deepEqual(result, {
      saved: true,
      valid: true,
      created: true,
      warningCount: 1,
      briefDate: "2026-07-29",
      draftRevisionId: "ndrv_example",
      draftRevisionNumber: 1,
      status: "pending",
    });
    assert.equal("payload" in result, false);
  });

  it("marks content-addressed repeated submissions as unchanged", async () => {
    const result = await submitMorningBriefDraftFile({
      inputPath: "/private/tmp/brief.json",
      readFile: async () => "{}",
      newsDataEnabled: true,
      getService: () => successfulService({ status: "unchanged" }),
    });

    assert.equal(result.created, false);
    assert.equal(result.status, "pending");
  });
});
