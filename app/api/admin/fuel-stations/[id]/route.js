import { NextResponse } from "next/server";
const bcrypt = require("bcryptjs");
const { convexQuery, convexMutation } = require("../../../../lib/convexServer");

function normalizeText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  if (!text) return fallback;
  const lowered = text.toLowerCase();
  if (lowered === "null" || lowered === "undefined" || lowered === "n/a") return fallback;
  return text;
}

export async function GET(request, props) {
  const params = await props.params;
  const { id } = params;
  if (!id) return NextResponse.json({ success: false, error: "Station ID is required" }, { status: 400 });

  try {
    const details = await convexQuery("admin:getFuelStationAdminDetails", { id });
    if (!details?.station) {
      return NextResponse.json({ success: false, error: "Fuel station not found" }, { status: 404 });
    }
    const station = details.station;
    const normalizedStation = {
      ...station,
      email: normalizeText(station.email, normalizeText(station.linked_user_email, "Not provided")),
      phone_number: normalizeText(station.phone_number, normalizeText(station.linked_user_phone, "Not provided")),
      address: normalizeText(station.address, "Not provided"),
    };
    return NextResponse.json(
      { success: true, station: normalizedStation, recent_ledger: details.recent_ledger || [] },
      { status: 200 }
    );
  } catch (error) {
    console.error("Get station details error:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request, props) {
  const params = await props.params;
  const { id } = params;
  const body = await request.json();
  if (!id) return NextResponse.json({ success: false, error: "Station ID is required" }, { status: 400 });

  try {
    const details = await convexQuery("admin:getFuelStationAdminDetails", { id });
    if (!details?.station) {
      return NextResponse.json({ success: false, error: "Fuel station not found" }, { status: 404 });
    }

    const { new_password, ...rest } = body || {};
    await convexMutation("admin:updateFuelStationAdmin", {
      id: details.station.id,
      ...rest,
      sync_linked_user: true,
    });

    if (new_password && details.station.user_id) {
      const hashedPassword = await bcrypt.hash(String(new_password), 10);
      await convexMutation("admin:setUserPassword", {
        user_id: details.station.user_id,
        password: hashedPassword,
      });
    }

    return NextResponse.json({ success: true, message: "Station updated successfully" }, { status: 200 });
  } catch (error) {
    console.error("Update station error:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request, props) {
  const params = await props.params;
  const { id } = params;
  if (!id) return NextResponse.json({ success: false, error: "Station ID is required" }, { status: 400 });

  try {
    const details = await convexQuery("admin:getFuelStationAdminDetails", { id });
    if (!details?.station) {
      return NextResponse.json({ success: false, error: "Fuel station not found" }, { status: 404 });
    }

    if (details.station.user_id) {
      const randomPassword = `deleted_${details.station.user_id}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const hashedPassword = await bcrypt.hash(randomPassword, 10);
      const tombstoneEmail = `deleted_station_${details.station.user_id}_${Date.now()}@deleted.local`;
      await convexMutation("admin:setUserPassword", {
        user_id: details.station.user_id,
        password: hashedPassword,
        email: tombstoneEmail,
      });
    }

    await convexMutation("admin:deleteFuelStationDeep", { id: details.station.id });
    return NextResponse.json({ success: true, message: "Station deleted successfully" }, { status: 200 });
  } catch (error) {
    console.error("Delete station error:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
