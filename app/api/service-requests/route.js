import { NextResponse } from "next/server";
const { convexQuery, convexMutation } = require("../../lib/convexServer");

const VALID_SERVICE_TYPES = ["petrol", "diesel", "crane", "mechanic_bike", "mechanic_car"];
const VALID_STATUSES = ["Pending", "Assigned", "In Progress", "Completed", "Cancelled"];

export async function POST(request) {
  try {
    const body = await request.json();
    const {
      user_id,
      vehicle_number,
      driving_licence,
      phone_number,
      service_type,
      amount,
      fuel_station_id,
      payment_method,
      payment_status,
      payment_id,
      payment_details,
      litres,
      fuel_price,
      user_lat,
      user_lon,
    } = body || {};

    if (!vehicle_number || !driving_licence || !phone_number) {
      return NextResponse.json({ error: "Vehicle number, licence and phone are required" }, { status: 400 });
    }
    if (!service_type || !VALID_SERVICE_TYPES.includes(service_type)) {
      return NextResponse.json({ error: "Invalid service type" }, { status: 400 });
    }
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return NextResponse.json({ error: "Amount is required" }, { status: 400 });
    }

    const result = await convexMutation("service_requests:create", {
      user_id: user_id || undefined,
      vehicle_number: String(vehicle_number).trim(),
      driving_licence: String(driving_licence).trim(),
      phone_number: String(phone_number).trim(),
      service_type,
      amount: parsedAmount,
      fuel_station_id: fuel_station_id || undefined,
      payment_method: payment_method || "ONLINE",
      payment_status: payment_status || "PAID",
      payment_id: payment_id || undefined,
      payment_details: payment_details ? JSON.stringify(payment_details) : undefined,
      litres: litres ?? undefined,
      fuel_price: fuel_price ?? undefined,
      user_lat: user_lat ?? undefined,
      user_lon: user_lon ?? undefined,
      status: "Pending",
    });

    return NextResponse.json({ success: true, id: result.id, amount: parsedAmount }, { status: 201 });
  } catch (err) {
    console.error("Service request create error details:", err);
    return NextResponse.json({
      error: err?.data || err?.message || "Internal server error",
      details: String(err),
      stack: err?.stack,
      data: err?.data
    }, { status: 500 });
  }
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const user_id = url.searchParams.get("user_id");
    const assigned_worker = url.searchParams.get("assigned_worker");

    const args = {};
    if (status) args.status = status;
    if (user_id) args.user_id = user_id;
    if (assigned_worker) args.assigned_worker = assigned_worker;

    const rows = await convexQuery("service_requests:list", args);
    console.log("Service requests fetched with filters:", args);
    console.log("Rows count:", rows?.length);
    return NextResponse.json(rows || []);
  } catch (err) {
    console.error("Service requests list error details:", err);
    return NextResponse.json({
      error: err?.message || "Internal server error",
      details: String(err),
      stack: err?.stack
    }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    const { id, status, assigned_worker, cod_failure_reason, payment_status, payment_method, fuel_station_id } =
      body || {};

    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    let normalizedStatus = undefined;
    if (status !== undefined) {
      if (typeof status !== "string") {
        return NextResponse.json({ error: "Invalid status value" }, { status: 400 });
      }
      const match = VALID_STATUSES.find((s) => s.toLowerCase() === status.trim().toLowerCase());
      if (!match) {
        return NextResponse.json({ error: `Status must be one of: ${VALID_STATUSES.join(", ")}` }, { status: 400 });
      }
      normalizedStatus = match;
    }

    try {
      await convexMutation("service_requests:updateStatus", {
        id,
        status: normalizedStatus,
        assigned_worker,
        cod_failure_reason,
        payment_status,
        payment_method,
        fuel_station_id,
      });
    } catch (err) {
      const errorString = String(err?.data || err?.message || "");
      if (/not found/i.test(errorString)) {
        return NextResponse.json({ error: "Service request not found" }, { status: 404 });
      }
      throw err;
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Service request update error details:", err);
    return NextResponse.json({
      error: err?.data || err?.message || "Internal server error",
      details: String(err),
      stack: err?.stack,
      data: err?.data
    }, { status: 500 });
  }
}

