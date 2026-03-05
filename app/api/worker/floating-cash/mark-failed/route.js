import { NextResponse } from "next/server";
const { requireWorker } = require("../../../../../database/auth-middleware");
const { convexMutation } = require("../../../../lib/convexServer");

export async function POST(request) {
  try {
    const auth = requireWorker(request);
    if (!auth?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const workerId = auth.id;

    const { razorpay_order_id, reason } = (await request.json()) || {};
    if (!razorpay_order_id) {
      return NextResponse.json({ error: "razorpay_order_id is required." }, { status: 400 });
    }

    await convexMutation("admin:markFloatingPaymentFailed", {
      worker_id: workerId,
      razorpay_order_id,
      reason: reason || "payment_failed_or_cancelled",
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Worker floating-cash mark-failed error:", err);
    return NextResponse.json({ error: "Failed to update payment status." }, { status: 500 });
  }
}
