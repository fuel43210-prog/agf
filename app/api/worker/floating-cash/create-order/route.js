import { NextResponse } from "next/server";
import Razorpay from "razorpay";
const { requireWorker } = require("../../../../../database/auth-middleware");
const { convexQuery, convexMutation } = require("../../../../lib/convexServer");

function getRazorpayClient() {
  const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

export async function POST(request) {
  try {
    const razorpay = getRazorpayClient();
    if (!razorpay) {
      return NextResponse.json({ error: "Razorpay is not configured on server." }, { status: 500 });
    }

    const auth = requireWorker(request);
    if (!auth?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const workerId = auth.id;
    if (!workerId) {
      return NextResponse.json({ error: "Invalid worker identity" }, { status: 401 });
    }
    const worker = await convexQuery("admin:getWorkerById", { id: workerId });

    if (!worker) {
      return NextResponse.json({ error: "Worker not found" }, { status: 404 });
    }

    const floaterCash = Number(worker.floater_cash || 0);
    if (!Number.isFinite(floaterCash) || floaterCash <= 0) {
      return NextResponse.json({ error: "No floating cash to clear." }, { status: 400 });
    }

    const existingPending = await convexQuery("admin:getLatestFloatingPending", { worker_id: workerId });

    if (existingPending?.razorpay_order_id) {
      const createdAt = new Date(String(existingPending.created_at || "").replace(" ", "T"));
      const isRecent =
        Number.isFinite(createdAt.getTime()) && Date.now() - createdAt.getTime() < 15 * 60 * 1000;

      if (isRecent) {
        return NextResponse.json(
          {
            error: "A floating cash payment is already in progress.",
            duplicate: true,
            order_id: existingPending.razorpay_order_id,
            amount: existingPending.amount_paise,
            currency: "INR",
            key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "rzp_test_placeholder",
          },
          { status: 409 }
        );
      }

      await convexMutation("admin:markFloatingPaymentFailed", {
        worker_id: workerId,
        razorpay_order_id: existingPending.razorpay_order_id,
        reason: "expired_before_checkout",
      });
    }

    const amountPaise = Math.round(floaterCash * 100);
    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: "INR",
      receipt: `floater_clear_${workerId}_${Date.now()}`,
      notes: {
        worker_id: String(workerId),
        purpose: "FLOATING_CASH_CLEAR",
      },
    });

    await convexMutation("admin:createFloatingPayment", {
      worker_id: workerId,
      amount: floaterCash,
      amount_paise: amountPaise,
      razorpay_order_id: order.id,
    });

    return NextResponse.json({
      success: true,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "rzp_test_placeholder",
      floater_cash: floaterCash,
    });
  } catch (err) {
    console.error("Worker floating-cash create-order error:", err);
    return NextResponse.json({ error: "Failed to create floating cash order." }, { status: 500 });
  }
}
