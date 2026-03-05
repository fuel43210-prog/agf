import { NextResponse } from "next/server";
const { convexQuery, convexMutation } = require("../../../lib/convexServer");

export async function GET() {
  try {
    const settings = await convexQuery("admin:getCodSettings", {});
    return NextResponse.json(settings);
  } catch (err) {
    console.error("COD settings fetch error:", err);
    return NextResponse.json({ error: "Failed to load COD settings" }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const cod_limit = Number(body.cod_limit);
    const trust_threshold = Number(body.trust_threshold);
    const max_failures = Number(body.max_failures);
    const disable_days = Number(body.disable_days);

    if ([cod_limit, trust_threshold, max_failures, disable_days].some((v) => Number.isNaN(v))) {
      return NextResponse.json({ error: "Invalid settings values" }, { status: 400 });
    }

    await convexMutation("admin:upsertCodSettings", {
      cod_limit,
      trust_threshold,
      max_failures,
      disable_days,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("COD settings update error:", err);
    return NextResponse.json({ error: "Failed to update COD settings" }, { status: 500 });
  }
}
