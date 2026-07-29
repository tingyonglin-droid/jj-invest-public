const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isDateText(value) {
  const text = String(value || "");
  if (!DATE_PATTERN.test(text)) {
    return false;
  }
  return new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text;
}

function normalizeObservation(seriesId, observationDate, value, retrievedAt, source = {}) {
  const numericValue = Number(value);
  if (
    !seriesId ||
    !isDateText(observationDate) ||
    !Number.isFinite(numericValue) ||
    !retrievedAt
  ) {
    return null;
  }

  return {
    seriesId,
    observationDate,
    value: numericValue,
    releasedAt: null,
    retrievedAt,
    sourceRealtimeStart: isDateText(source.realtimeStart) ? source.realtimeStart : null,
    sourceRealtimeEnd: isDateText(source.realtimeEnd) ? source.realtimeEnd : null,
  };
}

export function normalizeFredObservation(seriesId, observation, retrievedAt) {
  if (String(observation?.value || "").trim() === ".") {
    return null;
  }
  return normalizeObservation(
    seriesId,
    observation?.date,
    observation?.value,
    retrievedAt,
    {
      realtimeStart: observation?.realtime_start,
      realtimeEnd: observation?.realtime_end,
    },
  );
}

export function normalizeMarketObservation(seriesId, observation, retrievedAt) {
  return normalizeObservation(
    seriesId,
    observation?.date,
    observation?.price,
    retrievedAt,
  );
}
