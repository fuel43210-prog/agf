const { convexMutation } = require("../../lib/convexServer");

function readJson(req) {
  return req.json().catch(() => null);
}

export async function POST(req) {
  const body = await readJson(req);
  if (!body) {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const {
    lat,
    lng,
    severity,
    effectiveType = null,
    downlink = null,
    rtt = null,
    failures = 0,
    offline = 0,
  } = body;

  if (typeof lat !== "number" || typeof lng !== "number") {
    return new Response(JSON.stringify({ error: "lat/lng required" }), { status: 400 });
  }

  if (severity !== "weak" && severity !== "none") {
    return new Response(JSON.stringify({ error: "invalid severity" }), { status: 400 });
  }

  const reportedAt = new Date().toISOString();
  try {
    const result = await convexMutation("connectivity:addReport", {
      lat,
      lng,
      severity,
      effectiveType,
      downlink,
      rtt,
      failures,
      offline,
      reportedAt,
    });
    return new Response(JSON.stringify({ ok: true, id: result?.id }), { status: 201 });
  } catch {
    return new Response(JSON.stringify({ error: "DB insert failed" }), { status: 500 });
  }
}
