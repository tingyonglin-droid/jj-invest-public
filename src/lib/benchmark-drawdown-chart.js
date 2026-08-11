const MIN_WIDTH = 760;
const VIEWBOX_HEIGHT = 400;
const POINT_GAP = 44;
const RIGHT_PADDING = 42;
const PLOT = Object.freeze({ left: 92, right: 718, top: 40, bottom: 340 });

const MARKET_LEVEL_LABELS = Object.freeze({
  normal: "正常區間",
  prepare: "觀察區間",
  deep: "股災區間",
});

const MARKET_RANGE_MONTHS = Object.freeze({
  "1M": 1,
  "3M": 3,
  "6M": 6,
  "1Y": 12,
});

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function drawdownY(ratio, scaleMin = -0.3) {
  const clampedRatio = Math.max(scaleMin, Math.min(0, Number(ratio) || 0));
  return round(PLOT.top + (Math.abs(clampedRatio) / Math.abs(scaleMin)) * (PLOT.bottom - PLOT.top));
}

export function filterBenchmarkHistoryByRange(history, currentDate, range = "1M") {
  const records = Array.isArray(history) ? history : [];
  const end = new Date(`${currentDate}T00:00:00Z`);
  const months = MARKET_RANGE_MONTHS[range] || MARKET_RANGE_MONTHS["1M"];
  if (!Number.isFinite(end.getTime())) {
    return [];
  }

  const targetMonthStart = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months, 1));
  const targetMonthEnd = new Date(Date.UTC(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth() + 1, 0));
  const start = new Date(Date.UTC(
    targetMonthStart.getUTCFullYear(),
    targetMonthStart.getUTCMonth(),
    Math.min(end.getUTCDate(), targetMonthEnd.getUTCDate()),
  ));
  const startDate = start.toISOString().slice(0, 10);

  return records.filter((record) => record?.date >= startDate && record.date <= currentDate);
}

export function createBenchmarkDrawdownChart(history, highPrice, options = {}) {
  const records = Array.isArray(history) ? history : [];
  const lowestRatio = records.reduce(
    (lowest, record) => Math.min(lowest, Number(record?.drawdownRatio) || 0),
    0,
  );
  const scaleMin = Math.min(-0.3, Math.floor(lowestRatio * 10) / 10);
  const mode = options.mode === "overview" ? "overview" : "detail";
  const width =
    mode === "overview"
      ? MIN_WIDTH
      : Math.max(
          MIN_WIDTH,
          PLOT.left + RIGHT_PADDING + Math.max(0, records.length - 1) * POINT_GAP,
        );
  const plot = { ...PLOT, right: width - RIGHT_PADDING };
  const step = records.length > 1 ? (plot.right - plot.left) / (records.length - 1) : 0;
  const labelEvery =
    mode === "overview"
      ? Math.max(1, Math.ceil(Math.max(0, records.length - 1) / 4))
      : Math.max(1, Math.ceil(records.length / 12));
  const positionedPoints = records.map((record, index) => {
    const x = round(
      records.length === 1 ? (plot.left + plot.right) / 2 : plot.left + step * index,
    );
    const isFirst = index === 0;
    const isLast = index === records.length - 1;
    const y = drawdownY(record.drawdownRatio, scaleMin);
    return {
      ...record,
      x,
      y,
      tooltipX: round(x + (isFirst ? 12 : isLast ? -12 : 0)),
      tooltipAnchor: isFirst ? "start" : isLast ? "end" : "middle",
      showDateLabel: isFirst || isLast || index % labelEvery === 0,
      showPercentLabel: mode === "detail",
    };
  });
  const points = positionedPoints.map((point, index) => {
    const neighbors = [positionedPoints[index - 1], positionedPoints[index + 1]].filter(Boolean);
    const lineDropNearLabel = neighbors.reduce((largestDrop, neighbor) => {
      const horizontalDistance = Math.max(1, Math.abs(neighbor.x - point.x));
      const verticalDrop = Math.max(0, neighbor.y - point.y);
      return Math.max(largestDrop, verticalDrop * Math.min(1, 28 / horizontalDistance));
    }, 0);
    const hasCrowdedNeighbor = neighbors.some((neighbor) => Math.abs(neighbor.y - point.y) < 16);
    const stagger = hasCrowdedNeighbor && index % 2 === 1 ? 8 : 0;
    const lineClearance = Math.min(14, lineDropNearLabel);
    const bandBottom = point.level === "normal"
      ? drawdownY(-0.1, scaleMin)
      : point.level === "prepare"
        ? drawdownY(-0.2, scaleMin)
        : PLOT.bottom;

    return {
      ...point,
      percentLabelY: round(Math.min(point.y + 18 + lineClearance + stagger, bandBottom - 4)),
    };
  });

  const normalBottom = drawdownY(-0.1, scaleMin);
  const prepareBottom = drawdownY(-0.2, scaleMin);

  return {
    mode,
    scaleMin,
    edgeLabelInset: 40,
    bandInset: 32,
    dateLabelY: 362,
    width,
    height: VIEWBOX_HEIGHT,
    scrollKey: `${records.length}:${records[0]?.date || ""}:${records.at(-1)?.date || ""}`,
    viewBox: `0 0 ${width} ${VIEWBOX_HEIGHT}`,
    plot,
    points,
    linePoints: points.map((point) => `${point.x},${point.y}`).join(" "),
    scaleFloor: { ratio: scaleMin, y: PLOT.bottom },
    bands: [
      { level: "normal", top: PLOT.top, bottom: normalBottom },
      { level: "prepare", top: normalBottom, bottom: prepareBottom },
      { level: "deep", top: prepareBottom, bottom: PLOT.bottom },
    ],
    thresholds: [0, -0.1, -0.2].map((ratio) => ({
      ratio,
      y: drawdownY(ratio, scaleMin),
      price: round(Number(highPrice) * (1 + ratio)),
    })),
  };
}

export function toggleActiveMarketPoint(currentIndex, clickedIndex) {
  return currentIndex === clickedIndex ? null : clickedIndex;
}

export function getNearestMarketPointIndex(points, chartX) {
  const records = Array.isArray(points) ? points : [];
  const x = Number(chartX);
  if (records.length === 0 || !Number.isFinite(x)) {
    return null;
  }
  return records.reduce((nearestIndex, point, index) =>
    Math.abs(point.x - x) < Math.abs(records[nearestIndex].x - x) ? index : nearestIndex, 0);
}

export function getMarketChartScrollLeft(scrollWidth, mode = "detail") {
  if (mode === "overview") {
    return 0;
  }
  const width = Number(scrollWidth);
  return Number.isFinite(width) && width > 0 ? width : 0;
}

export function getMarketLevelLabel(level) {
  return MARKET_LEVEL_LABELS[level] || "市場水位";
}
