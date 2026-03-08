const { convexQuery } = require("../../lib/convexServer");

const CELL_SIZE_DEG = 0.03;
const MIN_REPORTS = 3;
const NONE_RATIO = 0.6;
const WINDOW_DAYS = 3;

function buildCellPolygon(cellX, cellY) {
  const minLat = cellX * CELL_SIZE_DEG;
  const maxLat = minLat + CELL_SIZE_DEG;
  const minLng = cellY * CELL_SIZE_DEG;
  const maxLng = minLng + CELL_SIZE_DEG;
  return [
    [
      [minLng, minLat],
      [maxLng, minLat],
      [maxLng, maxLat],
      [minLng, maxLat],
      [minLng, minLat],
    ],
  ];
}

export async function GET() {
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  try {
    const rows = (await convexQuery("connectivity:listSince", { since: cutoff, limit: 10000 })) || [];
    const buckets = new Map();
    for (const row of rows || []) {
      const cellX = Math.floor(row.lat / CELL_SIZE_DEG);
      const cellY = Math.floor(row.lng / CELL_SIZE_DEG);
      const key = `${cellX}:${cellY}`;
      const entry = buckets.get(key) || { cellX, cellY, total: 0, none: 0 };
      entry.total += 1;
      if (row.severity === "none") entry.none += 1;
      buckets.set(key, entry);
    }

    const features = [];
    for (const entry of buckets.values()) {
      if (entry.total < MIN_REPORTS) continue;
      const severity = entry.none / entry.total >= NONE_RATIO ? "none" : "weak";
      features.push({
        type: "Feature",
        properties: {
          severity,
          count: entry.total,
          window_days: WINDOW_DAYS,
        },
        geometry: {
          type: "Polygon",
          coordinates: buildCellPolygon(entry.cellX, entry.cellY),
        },
      });
    }

    return new Response(JSON.stringify({ type: "FeatureCollection", features }), { status: 200 });
  } catch (err) {
    console.error("Connectivity zones error details:", err);
    return new Response(JSON.stringify({
      error: err?.message || "DB query failed",
      details: String(err),
      stack: err?.stack
    }), { status: 500 });
  }
}
