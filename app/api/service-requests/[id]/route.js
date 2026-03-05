import { NextResponse } from "next/server";
const { convexQuery, convexMutation } = require("../../../lib/convexServer");

const VALID_STATUSES = ["Pending", "Assigned", "In Progress", "Completed", "Cancelled"];

export async function GET(_request, context) {
  try {
    const params = context?.params ? await context.params : null;
    const id = params?.id;
    if (!id) return NextResponse.json({ error: "Invalid request ID" }, { status: 400 });

    const row = await convexQuery("service_requests:getById", { id });
    if (!row) return NextResponse.json({ error: "Service request not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    console.error("Service request fetch error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request, context) {
  try {
    const params = context?.params ? await context.params : null;
    const id = params?.id;
    if (!id) return NextResponse.json({ error: "Invalid request ID" }, { status: 400 });

    const body = await request.json();
    const statusRaw = body?.status;
    if (!statusRaw || typeof statusRaw !== "string") {
      return NextResponse.json({ error: "Status is required" }, { status: 400 });
    }
    const normalizedStatus = VALID_STATUSES.find(
      (s) => s.toLowerCase() === String(statusRaw).trim().toLowerCase()
    );
    if (!normalizedStatus) {
      return NextResponse.json({ error: `Status must be one of: ${VALID_STATUSES.join(", ")}` }, { status: 400 });
    }

    try {
      await convexMutation("service_requests:updateStatus", { id, status: normalizedStatus });
    } catch (err) {
      if (/not found/i.test(String(err?.message || ""))) {
        return NextResponse.json({ error: "Service request not found" }, { status: 404 });
      }
      throw err;
    }

    return NextResponse.json({ success: true, message: `Service request status updated to ${normalizedStatus}` });
  } catch (err) {
    console.error("Service request update error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

