import { NextResponse } from "next/server";
const { convexQuery, convexMutation } = require("../../../lib/convexServer");

async function resolveStationId(rawId) {
  const station = await convexQuery("fuel_station_ops:resolveStation", {
    fuel_station_id: rawId,
    user_id: rawId,
  });
  return station?.id || null;
}

async function ensureDefaultStocks(fuel_station_id) {
  const existing = await convexQuery("fuel_station_ops:getStocks", { fuel_station_id });
  const known = new Set((existing || []).map((s) => String(s.fuel_type || "").toLowerCase()));
  if (!known.has("petrol")) {
    await convexMutation("fuel_station_ops:upsertStock", { fuel_station_id, fuel_type: "petrol", stock_litres: 0 });
  }
  if (!known.has("diesel")) {
    await convexMutation("fuel_station_ops:upsertStock", { fuel_station_id, fuel_type: "diesel", stock_litres: 0 });
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const fuel_station_id = searchParams.get("fuel_station_id");

    if (!fuel_station_id) {
      return NextResponse.json(
        { success: false, error: "fuel_station_id is required" },
        { status: 400 }
      );
    }

    const resolvedStationId = await resolveStationId(fuel_station_id);
    if (!resolvedStationId) {
      return NextResponse.json({ success: true, stocks: [] }, { status: 200 });
    }

    await ensureDefaultStocks(resolvedStationId);
    const stocks = (await convexQuery("fuel_station_ops:getStocks", { fuel_station_id: resolvedStationId })) || [];

    return NextResponse.json({ success: true, stocks }, { status: 200 });
  } catch (err) {
    console.error("Get stock error:", err);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    const { fuel_station_id, fuel_type, stock_litres } = body || {};

    if (!fuel_station_id || !fuel_type || stock_litres === undefined) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: fuel_station_id, fuel_type, stock_litres" },
        { status: 400 }
      );
    }

    if (typeof stock_litres !== "number" || stock_litres < 0) {
      return NextResponse.json(
        { success: false, error: "stock_litres must be a non-negative number" },
        { status: 400 }
      );
    }

    const resolvedStationId = await resolveStationId(fuel_station_id);
    if (!resolvedStationId) {
      return NextResponse.json({ success: false, error: "Fuel station not found" }, { status: 404 });
    }

    const result = await convexMutation("fuel_station_ops:upsertStock", {
      fuel_station_id: resolvedStationId,
      fuel_type,
      stock_litres,
    });

    await convexMutation("fuel_station_ops:addLedgerEntry", {
      fuel_station_id: resolvedStationId,
      transaction_type: "stock_update",
      amount: 0,
      description: `Stock updated for ${fuel_type}: ${stock_litres} litres`,
      status: "completed",
    });

    return NextResponse.json(
      {
        success: true,
        message: "Stock updated successfully",
        fuel_type,
        stock_litres,
        updated_at: result.updated_at,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Update stock error:", err);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { fuel_station_id, fuel_type, litres_picked_up } = body || {};

    if (!fuel_station_id || !fuel_type || !litres_picked_up) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: fuel_station_id, fuel_type, litres_picked_up" },
        { status: 400 }
      );
    }

    if (typeof litres_picked_up !== "number" || litres_picked_up <= 0) {
      return NextResponse.json(
        { success: false, error: "litres_picked_up must be a positive number" },
        { status: 400 }
      );
    }

    const resolvedStationId = await resolveStationId(fuel_station_id);
    if (!resolvedStationId) {
      return NextResponse.json({ success: false, error: "Fuel station not found" }, { status: 404 });
    }

    const result = await convexMutation("fuel_station_ops:decreaseStock", {
      fuel_station_id: resolvedStationId,
      fuel_type,
      litres_picked_up,
    });

    return NextResponse.json(
      {
        success: true,
        message: "Stock decreased successfully",
        fuel_type,
        litres_picked_up,
        remaining_stock: result.remaining_stock,
      },
      { status: 200 }
    );
  } catch (err) {
    const msg = String(err?.message || "");
    if (/not found/i.test(msg)) {
      return NextResponse.json({ success: false, error: msg }, { status: 404 });
    }
    if (/insufficient/i.test(msg)) {
      return NextResponse.json({ success: false, error: msg }, { status: 400 });
    }
    console.error("Decrease stock error:", err);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
