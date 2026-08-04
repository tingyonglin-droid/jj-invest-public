const MIN_WIDTH = 760;
const VIEWBOX_HEIGHT = 430;
const POINT_GAP = 44;
const RIGHT_PADDING = 42;
const PLOT = Object.freeze({ left: 92, right: 718, top: 40, bottom: 340 });

const MARKET_LEVEL_LABELS = Object.freeze({
  normal: "正常區間",
  prepare: "觀察區間",
  deep: "股災區間",
});

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function drawdownY(ratio) {
  const clampedRatio = Math.max(-0.3, Math.min(0, Number(ratio) || 0));
  return round(PLOT.top + (Math.abs(clampedRatio) / 0.3) * (PLOT.bottom - PLOT.top));
}

export function createBenchmarkDrawdownChart(history, highPrice, options = {}) {
  const records = Array.isArray(history) ? history : [];
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
  const points = records.map((record, index) => {
    const x = round(
      records.length === 1 ? (plot.left + plot.right) / 2 : plot.left + step * index,
    );
    const isFirst = index === 0;
    const isLast = index === records.length - 1;
    return {
      ...record,
      x,
      y: drawdownY(record.drawdownRatio),
      tooltipX: round(x + (isFirst ? 12 : isLast ? -12 : 0)),
      tooltipAnchor: isFirst ? "start" : isLast ? "end" : "middle",
      showDateLabel: isFirst || isLast || index % labelEvery === 0,
      showPercentLabel: mode === "detail",
    };
  });

  return {
    mode,
    width,
    height: VIEWBOX_HEIGHT,
    scrollKey: `${records.length}:${records[0]?.date || ""}:${records.at(-1)?.date || ""}`,
    viewBox: `0 0 ${width} ${VIEWBOX_HEIGHT}`,
    plot,
    points,
    linePoints: points.map((point) => `${point.x},${point.y}`).join(" "),
    thresholds: [0, -0.1, -0.2].map((ratio) => ({
      ratio,
      y: drawdownY(ratio),
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
