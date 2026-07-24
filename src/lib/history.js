export const MAX_HISTORY_RECORDS = 365;

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundNumber(value, digits = 6) {
  const number = toFiniteNumber(value);
  if (number === null) {
    return 0;
  }

  const scale = 10 ** digits;
  return Math.round(number * scale) / scale;
}

function isValidDateText(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

export function getTaipeiDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

export function createHistorySnapshot({ date, calculation, benchmark0050Price }) {
  const totalAssetsTwd = toFiniteNumber(calculation?.totalAssetsTwd);
  const benchmarkPrice = toFiniteNumber(benchmark0050Price);

  if (
    !isValidDateText(date) ||
    !calculation?.isValid ||
    totalAssetsTwd === null ||
    totalAssetsTwd <= 0 ||
    benchmarkPrice === null ||
    benchmarkPrice <= 0
  ) {
    return null;
  }

  return {
    date,
    totalAssetsTwd: roundNumber(totalAssetsTwd, 0),
    currentBeta: roundNumber(calculation.currentBeta),
    targetBeta: roundNumber(calculation.targetBeta),
    betaLower: roundNumber(calculation.betaLower),
    betaUpper: roundNumber(calculation.betaUpper),
    leveragedValueTwd: roundNumber(calculation.leveragedValueTwd, 0),
    originalValueTwd: roundNumber(calculation.originalValueTwd, 0),
    cashTwd: roundNumber(calculation.cashTwd, 0),
    benchmark0050Price: roundNumber(benchmarkPrice),
    performanceAdjustmentTwd: roundNumber(calculation.performanceAdjustmentTwd, 0),
  };
}

export function selectBenchmark0050SnapshotPrice({
  snapshotDate,
  currentDate = getTaipeiDateKey(),
  liveQuote,
  historicalPrice,
}) {
  const livePrice = toFiniteNumber(liveQuote?.price ?? liveQuote);
  if (snapshotDate === currentDate && livePrice !== null && livePrice > 0) {
    return roundNumber(livePrice);
  }

  const fallbackPrice = toFiniteNumber(historicalPrice);
  return fallbackPrice !== null && fallbackPrice > 0 ? roundNumber(fallbackPrice) : null;
}

export function normalizeHistoryRecords(records, limit = MAX_HISTORY_RECORDS) {
  return (Array.isArray(records) ? records : [])
    .filter((record) => isValidDateText(record?.date))
    .map((record) => ({
      date: record.date,
      totalAssetsTwd: roundNumber(record.totalAssetsTwd, 0),
      currentBeta: roundNumber(record.currentBeta),
      targetBeta: roundNumber(record.targetBeta),
      betaLower: roundNumber(record.betaLower),
      betaUpper: roundNumber(record.betaUpper),
      leveragedValueTwd: roundNumber(record.leveragedValueTwd, 0),
      originalValueTwd: roundNumber(record.originalValueTwd, 0),
      cashTwd: roundNumber(record.cashTwd, 0),
      benchmark0050Price: roundNumber(record.benchmark0050Price),
      performanceAdjustmentTwd: roundNumber(record.performanceAdjustmentTwd, 0),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-limit);
}

export function upsertDailyHistorySnapshot(records, snapshot, limit = MAX_HISTORY_RECORDS) {
  const normalized = normalizeHistoryRecords(records, limit);
  if (!snapshot) {
    return normalized;
  }

  const existing = normalized.find((record) => record.date === snapshot.date);
  const nextSnapshot = {
    ...snapshot,
    performanceAdjustmentTwd: roundNumber(
      snapshot.performanceAdjustmentTwd || existing?.performanceAdjustmentTwd || 0,
      0,
    ),
  };
  const next = normalized.filter((record) => record.date !== snapshot.date);
  next.push(nextSnapshot);
  return normalizeHistoryRecords(next, limit);
}

export function addHistoryPerformanceAdjustment(records, date, amountTwd, limit = MAX_HISTORY_RECORDS) {
  const amount = roundNumber(amountTwd, 0);
  if (!isValidDateText(date) || Math.abs(amount) <= 0.5) {
    return normalizeHistoryRecords(records, limit);
  }

  const normalized = normalizeHistoryRecords(records, limit);
  const existing = normalized.find((record) => record.date === date);
  if (!existing) {
    return normalized;
  }

  return normalizeHistoryRecords(
    normalized.map((record) =>
      record.date === date
        ? {
            ...record,
            performanceAdjustmentTwd: roundNumber(
              (record.performanceAdjustmentTwd || 0) + amount,
              0,
            ),
          }
        : record,
    ),
    limit,
  );
}

export function createPerformanceSeries(records) {
  const normalized = normalizeHistoryRecords(records);
  const firstBenchmark = normalized.find((record) => record.benchmark0050Price > 0)?.benchmark0050Price;
  let cumulativePerformanceAdjustment = 0;
  const adjustedRecords = normalized.map((record) => {
    cumulativePerformanceAdjustment += record.performanceAdjustmentTwd || 0;
    return {
      ...record,
      adjustedTotalAssetsTwd: roundNumber(
        record.totalAssetsTwd - cumulativePerformanceAdjustment,
        0,
      ),
    };
  });
  const firstPortfolio = adjustedRecords.find(
    (record) => record.adjustedTotalAssetsTwd > 0,
  )?.adjustedTotalAssetsTwd;
  let lastBenchmarkReturn = null;

  return adjustedRecords.map((record) => {
    const portfolioReturn = firstPortfolio
      ? roundNumber(record.adjustedTotalAssetsTwd / firstPortfolio - 1)
      : null;
    let benchmarkReturn = record.benchmark0050Price > 0 && firstBenchmark
      ? roundNumber(record.benchmark0050Price / firstBenchmark - 1)
      : null;

    if (benchmarkReturn === null) {
      benchmarkReturn = lastBenchmarkReturn;
    } else {
      lastBenchmarkReturn = benchmarkReturn;
    }

    return {
      ...record,
      portfolioReturn,
      benchmarkReturn,
    };
  });
}

export function createHistorySummary(records) {
  const series = createPerformanceSeries(records);
  const latest = series.at(-1) || null;

  return {
    latestDate: latest?.date || null,
    latestTotalAssetsTwd: latest?.totalAssetsTwd || 0,
    latestBeta: latest?.currentBeta || 0,
    portfolioReturn: latest?.portfolioReturn ?? 0,
    benchmarkReturn: latest?.benchmarkReturn ?? 0,
  };
}

const CHART_PLOT = {
  left: 44,
  right: 8,
  top: 12,
  bottom: 34,
};

function createPoints(values, plot, minValue, maxValue) {
  if (!values.length) {
    return "";
  }

  const span = maxValue - minValue || 1;
  const denominator = Math.max(values.length - 1, 1);
  return values
    .map((value, index) => {
      const x = plot.left + (index / denominator) * plot.width;
      const y = plot.top + plot.height - ((value - minValue) / span) * plot.height;
      return `${roundNumber(x, 2)},${roundNumber(y, 2)}`;
    })
    .join(" ");
}

function getPointCoordinate(index, count, value, plot, minValue, maxValue) {
  const span = maxValue - minValue || 1;
  const denominator = Math.max(count - 1, 1);

  return {
    x: roundNumber(plot.left + (index / denominator) * plot.width, 2),
    y: roundNumber(plot.top + plot.height - ((value - minValue) / span) * plot.height, 2),
  };
}

function createTicks(minValue, maxValue, mode, width, plot, labels, betaReference = null) {
  const span = maxValue - minValue || 1;
  const formatValue = (value) =>
    mode === "beta" ? roundNumber(value, 2).toFixed(2) : `${roundNumber(value * 100, 1)}%`;
  const betaTicks =
    betaReference && mode === "beta"
      ? [
          { label: `上限 ${formatValue(betaReference.upper)}`, value: betaReference.upper },
          { label: `目標 ${formatValue(betaReference.target)}`, value: betaReference.target },
          { label: `下限 ${formatValue(betaReference.lower)}`, value: betaReference.lower },
        ]
      : null;
  const yTicks = (betaTicks || [maxValue, minValue + span / 2, minValue].map((value) => ({
    value,
    label: formatValue(value),
  }))).map((tick) => ({
    ...tick,
    y: plot.top + ((maxValue - tick.value) / span) * plot.height,
  }));
  const xTicks = [
    { label: labels[0] || "", x: plot.left, anchor: "start" },
    {
      label: labels.at(-1) || "",
      x: width - plot.right,
      anchor: "end",
    },
  ];

  return { xTicks, yTicks };
}

function createPaddedRange(values, fallbackMin, fallbackMax, paddingRatio = 0.18) {
  const finiteValues = values.filter(Number.isFinite);
  const rawMin = finiteValues.length ? Math.min(...finiteValues) : fallbackMin;
  const rawMax = finiteValues.length ? Math.max(...finiteValues) : fallbackMax;
  const span = rawMax - rawMin || Math.max(Math.abs(rawMax), 1) * 0.1;
  const padding = span * paddingRatio;

  return {
    minValue: rawMin - padding,
    maxValue: rawMax + padding,
  };
}

export function createHistoryChartModel(records, mode = "performance") {
  const width = 360;
  const height = 160;
  const plot = {
    ...CHART_PLOT,
    width: width - CHART_PLOT.left - CHART_PLOT.right,
    height: height - CHART_PLOT.top - CHART_PLOT.bottom,
  };
  const normalized = normalizeHistoryRecords(records);
  const labels = normalized.map((record) => record.date.slice(5));

  if (mode === "beta") {
    const betaValues = normalized.map((record) => record.currentBeta);
    const targetValues = normalized.map((record) => record.targetBeta);
    const lowerValues = normalized.map((record) => record.betaLower);
    const upperValues = normalized.map((record) => record.betaUpper);
    const allValues = [...betaValues, ...targetValues, ...lowerValues, ...upperValues].filter(Number.isFinite);
    const { minValue, maxValue } = createPaddedRange(allValues, 1, 1.4, 0.35);
    const latest = normalized.at(-1) || {};
    const ticks = createTicks(minValue, maxValue, "beta", width, plot, labels, {
      upper: latest.betaUpper || upperValues.at(-1) || maxValue,
      target: latest.targetBeta || targetValues.at(-1) || (minValue + maxValue) / 2,
      lower: latest.betaLower || lowerValues.at(-1) || minValue,
    });

    return {
      mode: "beta",
      width,
      height,
      labels,
      minValue,
      maxValue,
      plot,
      ...ticks,
      betaPoints: createPoints(betaValues, plot, minValue, maxValue),
      targetPoints: createPoints(targetValues, plot, minValue, maxValue),
      lowerPoints: createPoints(lowerValues, plot, minValue, maxValue),
      upperPoints: createPoints(upperValues, plot, minValue, maxValue),
      dataPoints: normalized.map((record, index) => ({
        date: record.date,
        currentBeta: record.currentBeta,
        targetBeta: record.targetBeta,
        betaLower: record.betaLower,
        betaUpper: record.betaUpper,
        ...getPointCoordinate(index, normalized.length, record.currentBeta, plot, minValue, maxValue),
      })),
    };
  }

  const series = createPerformanceSeries(normalized);
  const portfolioValues = series.map((record) => record.portfolioReturn ?? 0);
  const benchmarkValues = series.map((record) => record.benchmarkReturn ?? 0);
  const allValues = [...portfolioValues, ...benchmarkValues].filter(Number.isFinite);
  const { minValue, maxValue } = createPaddedRange([...allValues, 0], -0.05, 0.05, 0.16);
  const ticks = createTicks(minValue, maxValue, "performance", width, plot, labels);

  return {
    mode: "performance",
    width,
    height,
    labels,
    minValue,
    maxValue,
    plot,
    ...ticks,
    portfolioPoints: createPoints(portfolioValues, plot, minValue, maxValue),
    benchmarkPoints: createPoints(benchmarkValues, plot, minValue, maxValue),
    dataPoints: series.map((record, index) => ({
      date: record.date,
      portfolioReturn: record.portfolioReturn,
      benchmarkReturn: record.benchmarkReturn,
      totalAssetsTwd: record.totalAssetsTwd,
      ...getPointCoordinate(
        index,
        series.length,
        record.portfolioReturn ?? 0,
        plot,
        minValue,
        maxValue,
      ),
    })),
  };
}

export function createDemoHistoryRecords(baseDate = new Date(), days = 30, anchor = {}) {
  const latestDate = getTaipeiDateKey(baseDate);
  const latestTime = new Date(`${latestDate}T00:00:00+08:00`).getTime();
  const count = Math.max(2, Math.round(toFiniteNumber(days) || 30));
  const anchorTotalAssetsTwd = toFiniteNumber(anchor.anchorTotalAssetsTwd) || 1078000;
  const anchorBenchmark0050Price = toFiniteNumber(anchor.anchorBenchmark0050Price) || 253;
  const anchorBeta = toFiniteNumber(anchor.anchorBeta) || 1.21;
  const curves = Array.from({ length: count }, (_, index) => {
    const progress = count === 1 ? 1 : index / (count - 1);
    const wave = Math.sin(index * 0.72) * 0.012 + Math.cos(index * 0.33) * 0.008;

    return {
      progress,
      portfolioReturn: progress * 0.078 + wave,
      benchmarkReturn: progress * 0.045 + Math.sin(index * 0.58) * 0.01,
    };
  });
  const terminalCurve = curves.at(-1) || { portfolioReturn: 0, benchmarkReturn: 0 };

  return normalizeHistoryRecords(
    Array.from({ length: count }, (_, index) => {
      const curve = curves[index];
      const totalAssetsTwd = Math.round(
        anchorTotalAssetsTwd * (1 + curve.portfolioReturn - terminalCurve.portfolioReturn),
      );
      const date = getTaipeiDateKey(new Date(latestTime - (count - 1 - index) * 86400000));
      const currentBeta = anchorBeta - 0.05 + Math.sin(index * 0.62) * 0.08 + curve.progress * 0.05;
      const benchmark0050Price =
        anchorBenchmark0050Price *
        (1 + curve.benchmarkReturn - terminalCurve.benchmarkReturn);

      return {
        date,
        totalAssetsTwd,
        currentBeta: roundNumber(currentBeta),
        targetBeta: 1.2,
        betaLower: 1.08,
        betaUpper: 1.32,
        leveragedValueTwd: Math.round(totalAssetsTwd * 0.6),
        originalValueTwd: Math.round(totalAssetsTwd * 0.1),
        cashTwd: Math.round(totalAssetsTwd * 0.3),
        benchmark0050Price: roundNumber(benchmark0050Price),
      };
    }),
  );
}

export function mergeDemoHistoryRecords(records, baseDate = new Date()) {
  const officialRecords = normalizeHistoryRecords(records);
  const latestOfficialRecord = officialRecords.at(-1) || null;
  const demoRecords = createDemoHistoryRecords(baseDate, 30, {
    anchorTotalAssetsTwd: latestOfficialRecord?.totalAssetsTwd,
    anchorBenchmark0050Price: latestOfficialRecord?.benchmark0050Price,
    anchorBeta: latestOfficialRecord?.currentBeta,
  });
  const demoDates = new Set(demoRecords.map((record) => record.date));
  const anchorBenchmark0050Price = toFiniteNumber(latestOfficialRecord?.benchmark0050Price);
  const preservedRecords = officialRecords.filter((record) => {
    if (record.date === latestOfficialRecord?.date || !demoDates.has(record.date)) {
      return true;
    }

    const benchmark0050Price = toFiniteNumber(record.benchmark0050Price);
    if (!anchorBenchmark0050Price || !benchmark0050Price) {
      return true;
    }

    const priceScale = benchmark0050Price / anchorBenchmark0050Price;
    return priceScale >= 0.67 && priceScale <= 1.5;
  });
  const officialDates = new Set(preservedRecords.map((record) => record.date));
  const fillDemoRecords = demoRecords.filter((record) => !officialDates.has(record.date));

  return normalizeHistoryRecords([...fillDemoRecords, ...preservedRecords]);
}
