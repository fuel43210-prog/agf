import { NextResponse } from "next/server";
import crypto from "crypto";
const { requireWorker } = require("../../../../../database/auth-middleware");
const { convexQuery, convexMutation } = require("../../../../lib/convexServer");

export async function POST(request) {
  try {
    const auth = requireWorker(request);
    if (!auth?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const workerId = auth.id;
    if (!workerId) {
      return NextResponse.json({ error: "Invalid worker identity" }, { status: 401 });
    }

    const body = await request.json();
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json({ error: "Missing payment verification fields." }, { status: 400 });
    }

    const secret = process.env.RAZORPAY_KEY_SECRET || "placeholder_secret";
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return NextResponse.json({ success: false, error: "Invalid payment signature." }, { status: 400 });
    }

    const paymentRow = await convexQuery("admin:getFloatingPaymentByOrder", { razorpay_order_id });

    if (!paymentRow) {
      return NextResponse.json({ error: "Payment order not found." }, { status: 404 });
    }

    if (String(paymentRow.worker_id || "") !== String(workerId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (paymentRow.status === "paid") {
      return NextResponse.json({
        success: true,
        already_processed: true,
        message: "Floating cash was already settled.",
      });
    }

    const applied = await convexMutation("admin:applyFloatingPaymentSuccess", {
      payment_id: paymentRow._id,
      worker_id: workerId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    });
    if (!applied?.already_processed) {
      await convexMutation("logs:addActivity", {
        type: "floating_cash_cleared",
        message: `Worker ${workerId} cleared floating cash via Razorpay. purpose=FLOATING_CASH_CLEAR amount=${applied.amount}`,
        entity_type: "worker",
        entity_id: String(workerId),
      });
    }

    return NextResponse.json({
      success: true,
      message: "Floating cash paid successfully.",
      purpose: "FLOATING_CASH_CLEAR",
      amount: Number(applied?.amount || paymentRow.amount || 0),
    });
  } catch (err) {
    console.error("Worker floating-cash verify error:", err);
    return NextResponse.json({ error: "Failed to verify floating cash payment." }, { status: 500 });
  }
}
