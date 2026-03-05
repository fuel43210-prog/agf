import { NextResponse } from "next/server";
const { convexQuery, convexMutation } = require("../../../lib/convexServer");

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const workerId = url.searchParams.get("worker_id");
    const fuelStationId = url.searchParams.get("fuel_station_id");
    const status = url.searchParams.get("status");
    const startDate = url.searchParams.get("start_date");
    const endDate = url.searchParams.get("end_date");
    const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 100);
    const offset = Number(url.searchParams.get("offset")) || 0;

    const result = await convexQuery("admin:listSettlements", {
      worker_id: workerId || undefined,
      fuel_station_id: fuelStationId || undefined,
      status: status || undefined,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
      limit,
      offset,
    });

    return NextResponse.json({
      success: true,
      settlements: result?.settlements || [],
      pagination: {
        limit,
        offset,
        total: Number(result?.total || 0),
        has_more: offset + limit < Number(result?.total || 0),
      },
    });
  } catch (err) {
    console.error("Get settlements error:", err);
    return NextResponse.json({ error: "Failed to retrieve settlements" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { settlement_id, notes } = body;
    if (!settlement_id) {
      return NextResponse.json({ error: "settlement_id is required" }, { status: 400 });
    }
    await convexMutation("admin:reconcileSettlement", { settlement_id, notes });
    return NextResponse.json({ success: true, message: "Settlement marked as reconciled" });
  } catch (err) {
    console.error("Reconcile settlement error:", err);
    return NextResponse.json({ error: "Failed to reconcile settlement" }, { status: 500 });
  }
}
