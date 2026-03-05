import { NextResponse } from "next/server";
const { convexQuery } = require("../../../lib/convexServer");

async function resolveStation(rawId) {
  return await convexQuery("fuel_station_ops:resolveStation", {
    fuel_station_id: rawId,
    user_id: rawId,
  });
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const fuel_station_id = searchParams.get("fuel_station_id");
    const limit = parseInt(searchParams.get("limit")) || 50;
    const offset = parseInt(searchParams.get("offset")) || 0;

    if (!fuel_station_id) {
      return NextResponse.json(
        { success: false, error: "fuel_station_id is required" },
        { status: 400 }
      );
    }

    const station = await resolveStation(fuel_station_id);
    if (!station) {
      return NextResponse.json(
        {
          success: true,
          station_earnings: { total_earnings: 0, pending_payout: 0, is_verified: 0, cod_enabled: 0 },
          summary: { total_transactions: 0, completed_earnings: 0, settled_earnings: 0, pending_earnings: 0 },
          transactions: [],
          cod_settlements: [],
          pagination: { limit, offset, total: 0 },
        },
        { status: 200 }
      );
    }

    const summary = (await convexQuery("fuel_station_ops:getEarningsSummary", { fuel_station_id: station.id })) || {
      total_transactions: 0,
      completed_earnings: 0,
      settled_earnings: 0,
      pending_earnings: 0,
    };
    const transactions =
      (await convexQuery("fuel_station_ops:listLedger", { fuel_station_id: station.id, limit, offset })) || [];
    const cod_settlements =
      (await convexQuery("fuel_station_ops:listCodSettlements", { fuel_station_id: station.id, limit: 20 })) || [];

    return NextResponse.json(
      {
        success: true,
        station_earnings: {
          total_earnings: Number(station.total_earnings || 0),
          pending_payout: Number(station.pending_payout || 0),
          is_verified: station.is_verified ? 1 : 0,
          cod_enabled: station.cod_enabled ? 1 : 0,
        },
        summary: {
          total_transactions: Number(summary.total_transactions || 0),
          completed_earnings: Number(summary.completed_earnings || 0),
          settled_earnings: Number(summary.settled_earnings || 0),
          pending_earnings: Number(summary.pending_earnings || 0),
        },
        transactions,
        cod_settlements,
        pagination: {
          limit,
          offset,
          total: Number(summary.total_transactions || 0),
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Get earnings error:", err);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
