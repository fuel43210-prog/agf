import { NextResponse } from "next/server";
const { convexQuery } = require("../../../../lib/convexServer");

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const days = Number(url.searchParams.get("days")) || 30;

    const data = await convexQuery("admin:paymentSummary", { days });
    return NextResponse.json({
      success: true,
      period: {
        days,
        start_date: data?.start_date,
        end_date: data?.end_date,
      },
      summary: data?.summary || {},
      provider_breakdown: data?.provider_breakdown || [],
      status_breakdown: data?.status_breakdown || [],
      daily_trend: data?.daily_trend || [],
    });
  } catch (err) {
    console.error("Get summary error:", err);
    return NextResponse.json(
      { error: "Failed to get summary", details: err.message },
      { status: 500 }
    );
  }
}
