import { NextResponse } from "next/server";
import Razorpay from "razorpay";
const { convexMutation, convexQuery } = require("../../../lib/convexServer");

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

        const body = await request.json();
        const { payment_id, amount, reason } = body;

        if (!payment_id) {
            return NextResponse.json({ error: "Payment ID is required" }, { status: 400 });
        }

        const refundAmount = amount ? Math.round(Number(amount) * 100) : undefined; // Amount in paise if provided

        const refund = await razorpay.payments.refund(payment_id, {
            amount: refundAmount,
            notes: {
                reason: reason || "User requested cancellation",
            },
        });

        await convexMutation("payments:updateByProviderPaymentId", {
            provider_payment_id: payment_id,
            status: "reversed",
            metadata: { refund }
        });

        const serviceRequest = await convexQuery("service_requests:getByPaymentId", { payment_id });
        if (serviceRequest?._id) {
            await convexMutation("service_requests:updatePaymentDetails", {
                id: serviceRequest._id,
                payment_status: "REFUNDED",
                payment_details: refund,
            });
        }

        return NextResponse.json({
            success: true,
            refund_id: refund.id,
            amount: refund.amount,
            status: refund.status
        });
    } catch (err) {
        console.error("Razorpay refund error:", err);
        return NextResponse.json({ error: err.error?.description || "Refund failed" }, { status: 500 });
    }
}
