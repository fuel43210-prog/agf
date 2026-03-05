import { NextResponse } from "next/server";
const crypto = require("crypto");
const { convexMutation, convexQuery } = require("../../../lib/convexServer");

/**
 * POST /api/payment/webhook
 * Razorpay webhook endpoint for payment events
 * Signature verification is done to ensure request authenticity
 */
export async function POST(request) {
  try {
    const rawBody = await request.text();
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const signature = request.headers.get("x-razorpay-signature");

    // Get Razorpay webhook secret from environment
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.warn("RAZORPAY_WEBHOOK_SECRET not configured");
      // In development, allow unverified webhooks. In production, reject.
      if (process.env.NODE_ENV === "production") {
        return NextResponse.json(
          { error: "Webhook secret not configured" },
          { status: 500 }
        );
      }
    }

    // Verify signature if secret is configured
    if (webhookSecret) {
      if (!signature) {
        return NextResponse.json({ error: "Missing webhook signature" }, { status: 401 });
      }

      const computedSignature = crypto
        .createHmac("sha256", webhookSecret)
        .update(rawBody)
        .digest("hex");

      if (computedSignature !== signature) {
        console.error("Webhook signature verification failed");
        return NextResponse.json(
          { error: "Signature verification failed" },
          { status: 401 }
        );
      }
    }

    const event = body.event;
    const paymentData = body.payload?.payment?.entity || {};
    const paymentId = paymentData.id;
    const amount = paymentData.amount || 0;

    // Handle payment events
    if (event === "payment.authorized" || event === "payment.captured") {
      const serviceRequest = await convexQuery("service_requests:getByPaymentId", { payment_id: paymentId });

      if (serviceRequest) {
        await convexMutation("payments:upsertForServiceRequest", {
          service_request_id: serviceRequest._id,
          provider: "razorpay",
          provider_payment_id: paymentId,
          amount,
          currency: paymentData.currency || "INR",
          status: "captured",
          metadata: paymentData,
        });

        await convexMutation("service_requests:updatePaymentDetails", {
          id: serviceRequest._id,
          payment_status: "PAID",
          payment_details: paymentData,
        });

        console.log(`Payment captured for service request ${String(serviceRequest._id)}`);
      }
    } else if (event === "payment.failed") {
      const serviceRequest = await convexQuery("service_requests:getByPaymentId", { payment_id: paymentId });

      if (serviceRequest) {
        await convexMutation("payments:upsertForServiceRequest", {
          service_request_id: serviceRequest._id,
          provider: "razorpay",
          provider_payment_id: paymentId,
          amount,
          currency: paymentData.currency || "INR",
          status: "failed",
          metadata: paymentData,
        });

        await convexMutation("service_requests:updatePaymentDetails", {
          id: serviceRequest._id,
          payment_status: "FAILED",
          payment_details: paymentData,
        });

        console.log(`Payment failed for service request ${String(serviceRequest._id)}`);
      }
    }

    return NextResponse.json({ success: true, event });
  } catch (err) {
    console.error("Webhook processing error:", err);
    // Return non-2xx so webhook sender can retry on transient failures.
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
