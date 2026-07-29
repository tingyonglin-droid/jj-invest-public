export class AdminResponseError extends Error {
  constructor(message, {
    kind = "request",
    status = null,
    payload = null,
    cause,
  } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AdminResponseError";
    this.kind = kind;
    this.status = status;
    this.payload = payload;
  }
}

function payloadMessage(payload) {
  return typeof payload?.error === "string" && payload.error.trim()
    ? payload.error
    : "";
}

function fallbackErrorMessage(fallbackMessage, status) {
  return status
    ? `${fallbackMessage}（HTTP ${status}）。`
    : `${fallbackMessage}。`;
}

function responseErrorKind(response, payload) {
  if (response.status === 401 || response.status === 403) return "authorization";
  if (payload?.enabled === false) return "gate";
  if (response.status >= 500 || payload?.configured === false) return "transient";
  return "request";
}

/**
 * Decode an admin endpoint response exactly once and attach a stable error kind.
 * Callers supply the successful payload contract through `validate` so a 2xx
 * response cannot silently turn an invalid shape into an empty result.
 */
export async function readAdminJson(response, {
  fallbackMessage,
  label,
  validate = () => true,
} = {}) {
  const errorLabel = fallbackMessage || label || "管理 API 讀取失敗";
  let payload;
  try {
    payload = await response.json();
  } catch (cause) {
    const kind = responseErrorKind(response, null);
    throw new AdminResponseError(
      kind === "request" && response.ok
        ? `${errorLabel}：回應格式無效。`
        : fallbackErrorMessage(errorLabel, response.status),
      {
        kind: response.ok ? "malformed" : kind,
        status: response.status,
        cause,
      },
    );
  }

  if (!response.ok) {
    throw new AdminResponseError(
      payloadMessage(payload) || fallbackErrorMessage(errorLabel, response.status),
      {
        kind: responseErrorKind(response, payload),
        status: response.status,
        payload,
      },
    );
  }

  if (payload?.enabled === false) {
    throw new AdminResponseError(
      payloadMessage(payload) || fallbackErrorMessage(errorLabel, response.status),
      { kind: "gate", status: response.status, payload },
    );
  }

  if (payload?.configured === false) {
    throw new AdminResponseError(
      payloadMessage(payload) || fallbackErrorMessage(errorLabel, response.status),
      { kind: "transient", status: response.status, payload },
    );
  }

  if (!validate(payload)) {
    throw new AdminResponseError(`${errorLabel}：回應格式無效。`, {
      kind: "malformed",
      status: response.status,
      payload,
    });
  }

  return payload;
}

export function isAdminAccessDenied(error) {
  return error?.kind === "authorization" || error?.kind === "gate";
}
