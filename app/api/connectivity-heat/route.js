const { convexQuery } = require("../../lib/convexServer");

const WINDOW_DAYS = 3;
const MAX_POINTS = 1000;

export async function GET() {
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  try {
    const rows = (await convexQuery("connectivity:listSince", { since: cutoff, limit: MAX_POINTS })) || [];
    const points = rows.map((row) => ({
      lat: row.lat,
      lng: row.lng,
      intensity: row.severity === "none" ? 1.0 : 0.6,
    }));
    return new Response(JSON.stringify({ points }), { status: 200 });
  } catch (err) {
    console.error("Connectivity heat error details:", err);
    return new Response(JSON.stringify({
      error: err?.message || "DB query failed",
      details: String(err),
      stack: err?.stack
    }), { status: 500 });
  }
}
