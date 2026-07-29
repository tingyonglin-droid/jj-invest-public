const DEFAULT_BASE_URL = "https://api.stlouisfed.org";

function redact(text, secret) {
  return String(text || "Unknown error").split(secret).join("[redacted]");
}
export function createFredClient({
  apiKey,
  fetchImpl = fetch,
  baseUrl = DEFAULT_BASE_URL,
} = {}) {
  const secret = String(apiKey || "").trim();
  if (!secret) {
    throw new Error("缺少 server-side FRED_API_KEY。");
  }

  async function request(path, params) {
    const url = new URL(path, baseUrl);
    url.search = new URLSearchParams({
      ...params,
      api_key: secret,
      file_type: "json",
    }).toString();

    let response;
    try {
      response = await fetchImpl(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
    } catch (error) {
      throw new Error(`FRED API 連線失敗：${redact(error?.message, secret)}`);
    }

    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    if (!response.ok) {
      throw new Error(
        `FRED API 回應 ${response.status}：${redact(
          payload.error_message || response.statusText,
          secret,
        )}`,
      );
    }
    return payload;
  }

  return {
    async fetchSeriesMetadata(seriesId) {
      const payload = await request("/fred/series", { series_id: seriesId });
      const series = payload.seriess?.[0];
      if (!series) {
        throw new Error(`FRED 找不到 series metadata：${seriesId}`);
      }
      return {
        frequency: series.frequency || null,
        unit: series.units || null,
      };
    },

    async fetchObservations(seriesId, { observationStart } = {}) {
      const params = {
        series_id: seriesId,
        sort_order: "asc",
      };
      if (observationStart) {
        params.observation_start = observationStart;
      }
      const payload = await request("/fred/series/observations", params);
      if (!Array.isArray(payload.observations)) {
        throw new Error(`FRED observations 格式不正確：${seriesId}`);
      }
      return payload.observations;
    },
  };
}
