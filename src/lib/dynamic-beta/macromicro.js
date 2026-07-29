export const MACROMICRO_MARGIN_SERIES_ID =
  "MACROMICRO:TAIEX_MARGIN_MAINTENANCE";
export const MACROMICRO_MARGIN_SOURCE_URL =
  "https://www.macromicro.me/charts/53117/taiwan-taiex-maintenance-margin";
export const MACROMICRO_SOURCE_ERROR_MESSAGES = Object.freeze({
  PAGE_UNAVAILABLE: "M 平方頁面無法讀取。",
  LATEST_DATA_MISSING: "M 平方頁面沒有可確認的最新數據。",
  INVALID_PAGE_VALUE: "M 平方頁面回傳的最新數值無效。",
});

export class MacroMicroPayloadError extends Error {
  constructor() {
    super("MacroMicro payload 無效。");
    this.name = "MacroMicroPayloadError";
    this.code = "INVALID_MACROMICRO_PAYLOAD";
  }
}

function hasExactKeys(payload, expectedKeys) {
  const keys = Reflect.ownKeys(payload);
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(payload, key))
  );
}

function isIsoDate(text) {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false;
  }

  const date = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function isIsoInstant(text) {
  if (typeof text !== "string") return false;
  const date = new Date(text);
  return !Number.isNaN(date.getTime()) && date.toISOString() === text;
}

function invalidPayload() {
  throw new MacroMicroPayloadError();
}

export function normalizeMacroMicroPayload(payload, context = {}) {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    invalidPayload();
  }
  const { retrievedAt, today } = context;
  if (!isIsoInstant(retrievedAt) || !isIsoDate(today)) {
    invalidPayload();
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    invalidPayload();
  }

  if (Object.hasOwn(payload, "errorCode")) {
    if (!hasExactKeys(payload, ["errorCode", "sourceUrl"])) {
      invalidPayload();
    }
    if (
      !Object.hasOwn(MACROMICRO_SOURCE_ERROR_MESSAGES, payload.errorCode) ||
      payload.sourceUrl !== MACROMICRO_MARGIN_SOURCE_URL
    ) {
      invalidPayload();
    }
    const errorMessage = MACROMICRO_SOURCE_ERROR_MESSAGES[payload.errorCode];
    return {
      kind: "source-error",
      errorCode: payload.errorCode,
      errorMessage,
    };
  }

  if (!hasExactKeys(payload, ["observationDate", "value", "sourceUrl"])) {
    invalidPayload();
  }

  if (
    !isIsoDate(payload.observationDate) ||
    payload.observationDate > today ||
    payload.sourceUrl !== MACROMICRO_MARGIN_SOURCE_URL ||
    typeof payload.value !== "number" ||
    !Number.isFinite(payload.value) ||
    payload.value < 100 ||
    payload.value > 500
  ) {
    invalidPayload();
  }

  return {
    kind: "observation",
    observation: {
      seriesId: MACROMICRO_MARGIN_SERIES_ID,
      observationDate: payload.observationDate,
      value: payload.value,
      releasedAt: null,
      retrievedAt,
      sourceRealtimeStart: null,
      sourceRealtimeEnd: null,
    },
  };
}
