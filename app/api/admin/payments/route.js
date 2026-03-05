import { NextResponse } from "next/server";
const { convexQuery, convexMutation } = require("../../../lib/convexServer");

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const provider = url.searchParams.get("provider");
    const status = url.searchParams.get("status");
    const userId = url.searchParams.get("user_id");
    const serviceRequestId = url.searchParams.get("service_request_id");
    const startDate = url.searchParams.get("start_date");
    const endDate = url.searchParams.get("end_date");
    const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 100);
    const offset = Number(url.searchParams.get("offset")) || 0;

    const result = await convexQuery("admin:listPayments", {
      provider: provider || undefined,
      status: status || undefined,
      user_id: userId || undefined,
      service_request_id: serviceRequestId || undefined,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
      limit,
      offset,
    });

    return NextResponse.json({
      success: true,
      payments: result?.payments || [],
      pagination: {
        limit,
        offset,
        total: Number(result?.total || 0),
        has_more: offset + limit < Number(result?.total || 0),
      },
    });
  } catch (err) {
    console.error("Get payments error:", err);
    return NextResponse.json({ error: "Failed to retrieve payments" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { payment_id, status } = body;
    if (!payment_id) {
      return NextResponse.json({ error: "payment_id is required" }, { status: 400 });
    }
    if (!status || !["captured", "failed", "refunded", "reconciled"].includes(status)) {
      return NextResponse.json(
        { error: "Invalid status. Must be one of: captured, failed, refunded, reconciled" },
        { status: 400 }
      );
    }

    await convexMutation("admin:reconcilePayment", { payment_id, status });
    return NextResponse.json({ success: true, message: `Payment marked as ${status}` });
  } catch (err) {
    console.error("Reconcile payment error:", err);
    return NextResponse.json({ error: "Failed to reconcile payment" }, { status: 500 });
  }
}
