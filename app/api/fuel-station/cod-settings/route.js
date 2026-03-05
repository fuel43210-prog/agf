import { NextResponse } from "next/server";
const { requireAuth } = require("../../../../database/auth-middleware");
const { convexQuery, convexMutation } = require("../../../lib/convexServer");

function flagEnabled(value, defaultWhenNull = false) {
  if (value === null || value === undefined) return defaultWhenNull;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "t" || normalized === "yes";
}

async function resolveStation(request, fuel_station_id) {
  const auth = requireAuth(request);
  const stationFromParam =
    fuel_station_id != null && fuel_station_id !== ""
      ? await convexQuery("fuel_station_ops:resolveStation", {
          fuel_station_id,
          user_id: fuel_station_id,
        })
      : null;
  if (stationFromParam) return stationFromParam;

  if (auth && (auth.role === "Station" || auth.role === "Fuel_Station")) {
    const byToken = await convexQuery("fuel_station_ops:resolveStation", {
      fuel_station_id: auth.id,
      user_id: auth.id,
      email: auth.email,
    });
    if (byToken) return byToken;
  }
  return null;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const fuel_station_id = searchParams.get("fuel_station_id");
    const station = await resolveStation(request, fuel_station_id);

    if (!station) {
      return NextResponse.json(
        {
          success: true,
          cod_settings: {
            station_id: Number(fuel_station_id || 0),
            station_name: "Station",
            cod_enabled: false,
            is_verified: false,
            cod_current_balance: 0,
            cod_balance_limit: 50000,
            platform_trust_flag: false,
            can_accept_cod: false,
          },
          pending_cod: { count: 0, total_pending: 0 },
          warning: "Fuel station not found for this account",
        },
        { status: 200 }
      );
    }

    const pending_cod =
      (await convexQuery("fuel_station_ops:getPendingCodSummary", { fuel_station_id: station.id })) || {
        count: 0,
        total_pending: 0,
      };
    const computedCurrentBalance = Number(pending_cod.total_pending || 0);

    await convexMutation("fuel_stations:update", {
      id: station.id,
      cod_current_balance: computedCurrentBalance,
    });

    return NextResponse.json(
      {
        success: true,
        cod_settings: {
          station_id: station.id,
          station_name: station.station_name || `Station ${station.id}`,
          cod_enabled: flagEnabled(station.cod_enabled, false),
          is_verified: flagEnabled(station.is_verified, false),
          cod_current_balance: computedCurrentBalance,
          cod_balance_limit: Number(station.cod_balance_limit || 0),
          platform_trust_flag: flagEnabled(station.platform_trust_flag, false),
          can_accept_cod:
            flagEnabled(station.cod_enabled, false) &&
            flagEnabled(station.platform_trust_flag, false) &&
            computedCurrentBalance < Number(station.cod_balance_limit || 0),
        },
        pending_cod: {
          count: Number(pending_cod.count || 0),
          total_pending: computedCurrentBalance,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Get COD settings error:", err);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    const { fuel_station_id, cod_enabled, cod_balance_limit } = body || {};
    const station = await resolveStation(request, fuel_station_id);

    if (!station) {
      return NextResponse.json(
        { success: false, error: "Fuel station not found for this account" },
        { status: 404 }
      );
    }

    const patch = { id: station.id };
    if (cod_enabled !== undefined) {
      patch.cod_enabled = !!cod_enabled;
      patch.cod_supported = !!cod_enabled;
    }
    if (cod_balance_limit !== undefined) {
      if (typeof cod_balance_limit !== "number" || cod_balance_limit < 0) {
        return NextResponse.json(
          { success: false, error: "cod_balance_limit must be a non-negative number" },
          { status: 400 }
        );
      }
      patch.cod_balance_limit = cod_balance_limit;
    }

    if (Object.keys(patch).length === 1) {
      return NextResponse.json({ success: false, error: "No fields to update" }, { status: 400 });
    }

    await convexMutation("fuel_stations:update", patch);
    return NextResponse.json(
      { success: true, message: "COD settings updated successfully", updated_at: new Date().toISOString() },
      { status: 200 }
    );
  } catch (err) {
    console.error("Update COD settings error:", err);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
