import { NextResponse } from "next/server";
const { requireAdmin, errorResponse } = require("../../../../database/auth-middleware");
const { convexQuery, convexMutation } = require("../../../lib/convexServer");

export async function GET(request) {
  try {
    const auth = requireAdmin(request);
    if (!auth) return errorResponse("Unauthorized", 401);

    const { searchParams } = new URL(request.url);
    const fuel_station_id = searchParams.get("fuel_station_id");
    const status = searchParams.get("status") || "pending";
    const limit = parseInt(searchParams.get("limit")) || 50;
    const offset = parseInt(searchParams.get("offset")) || 0;

    const payouts =
      (await convexQuery("fuel_station_ops:listPendingPayoutLedger", {
        fuel_station_id: fuel_station_id || undefined,
        status,
        limit,
        offset,
      })) || [];

    return NextResponse.json({ success: true, payouts }, { status: 200 });
  } catch (err) {
    console.error("Get payouts error:", err);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const auth = requireAdmin(request);
    if (!auth) return errorResponse("Unauthorized", 401);

    const body = await request.json();
    const { fuel_station_id, ledger_ids } = body || {};
    if (!fuel_station_id || !Array.isArray(ledger_ids) || ledger_ids.length === 0) {
      return NextResponse.json(
        { success: false, error: "fuel_station_id and ledger_ids array required" },
        { status: 400 }
      );
    }

    const result = await convexMutation("fuel_station_ops:settleStationPayoutByLedgerIds", {
      fuel_station_id,
      ledger_ids,
    });

    if (!result?.ok) {
      return NextResponse.json(
        { success: false, error: "No pending valid earnings found for these IDs" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "Payout settled successfully",
        settled_amount: Number(result.amount || 0),
        count: Number(result.count || 0),
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Settle payouts error:", err);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
