import { NextResponse } from "next/server";
const bcrypt = require("bcryptjs");
const { convexQuery, convexMutation } = require("../../lib/convexServer");

function normalizeText(value, fallback = "Not provided") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  if (!text) return fallback;
  const lowered = text.toLowerCase();
  if (lowered === "null" || lowered === "undefined" || lowered === "n/a") return fallback;
  return text;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search");
  const verifiedOnly = searchParams.get("verified_only") === "true";
  const id = searchParams.get("id");

  try {
    const stations = await convexQuery("fuel_stations:list", {
      search: search || undefined,
      verified_only: verifiedOnly || undefined,
      id: id || undefined,
    });
    const normalized = (stations || []).map((station) => ({
      ...station,
      id: station.id || station._id,
      station_name: station.station_name || station.name || "Unnamed Station",
      email: normalizeText(station.email),
      phone_number: normalizeText(station.phone_number),
      address: normalizeText(station.address),
      cod_enabled: station.cod_enabled !== false,
      petrol_stock: Number(station.petrol_stock || 0),
      diesel_stock: Number(station.diesel_stock || 0),
      total_earnings: Number(station.total_earnings || 0),
      pending_payout: Number(station.pending_payout || 0),
      latitude: Number(station.latitude || 0),
      longitude: Number(station.longitude || 0),
    }));

    if (id) {
      if (normalized.length === 0) {
        return NextResponse.json({ error: "Station not found" }, { status: 404 });
      }
      return NextResponse.json(normalized[0]);
    }

    return NextResponse.json(normalized);
  } catch (error) {
    console.error("GET /api/fuel-stations Error details:", error);
    return NextResponse.json({
      error: error?.message || "Internal Server Error",
      details: String(error),
      stack: error?.stack
    }, { status: 500 });
  }
}

export async function POST(request) {
  const body = await request.json();
  const station_name = body.station_name || body.name || "Unnamed Station";
  const { latitude, longitude, cod_enabled, email, phone_number, address } = body;
  const parsedLatitude = Number(latitude);
  const parsedLongitude = Number(longitude);

  if (
    latitude === undefined || latitude === null || latitude === "" ||
    longitude === undefined || longitude === null || longitude === "" ||
    !Number.isFinite(parsedLatitude) || !Number.isFinite(parsedLongitude)
  ) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  try {
    let user_id = undefined;
    if (email && body.password) {
      const existingUser = await convexQuery("users:getByEmail", { email });
      if (existingUser) {
        user_id = existingUser._id;
      } else {
        const hashedPassword = await bcrypt.hash(body.password, 10);
        const created = await convexMutation("users:signup", {
          email,
          password: hashedPassword,
          first_name: station_name,
          last_name: "Station",
          phone_number: String(phone_number ?? "").trim(),
          role: "Fuel_Station",
        });
        user_id = created.id;
      }
    }

    const result = await convexMutation("fuel_stations:create", {
      user_id,
      station_name,
      email: email || "",
      phone_number: phone_number || "",
      address: address || "",
      latitude: parsedLatitude,
      longitude: parsedLongitude,
      cod_supported: cod_enabled !== false,
      cod_enabled: cod_enabled !== false,
      is_open: true,
      is_verified: true,
    });

    return NextResponse.json({ success: true, id: result.id });
  } catch (error) {
    console.error("Create station error details:", error);
    if (/email already exists/i.test(String(error?.message || ""))) {
      return NextResponse.json({ error: "Email already exists" }, { status: 409 });
    }
    return NextResponse.json({
      error: error?.message || "Failed to create station",
      details: String(error),
      stack: error?.stack
    }, { status: 500 });
  }
}

export async function PATCH(request) {
  const body = await request.json();
  const { id, cod_enabled, cod_supported } = body;
  const isEnabled = cod_enabled !== undefined ? cod_enabled : cod_supported;

  if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });
  try {
    await convexMutation("fuel_stations:update", {
      id,
      cod_supported: Boolean(isEnabled),
      cod_enabled: Boolean(isEnabled),
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (/not found/i.test(String(error?.message || ""))) {
      return NextResponse.json({ error: "Station not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });
  try {
    await convexMutation("fuel_stations:remove", { id });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (/not found/i.test(String(error?.message || ""))) {
      return NextResponse.json({ error: "Station not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
