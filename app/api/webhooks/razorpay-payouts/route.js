import { NextResponse } from "next/server";
const crypto = require('crypto');
const { convexMutation } = require("../../../lib/convexServer");

export async function POST(request) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'payout_webhook_secret_placeholder';
    const signature = request.headers.get('x-razorpay-signature');
    const body = await request.text();

    // Verify signature (Standard Razorpay Webhook Verification)
    const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');

    // Skip signature verification for testing if secret is not set correctly
    if (process.env.NODE_ENV === 'production' && signature !== expectedSignature) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    const payload = JSON.parse(body);
    const { event, payload: eventData } = payload;
    const payout = eventData.payout.entity;

    try {
        await convexMutation("admin:handlePayoutWebhook", {
            payout_id: payout.id,
            event,
            failure_reason: payout.failure_reason,
        });

        return NextResponse.json({ success: true });
    } catch (err) {
        console.error("Webhook processing error:", err);
        return NextResponse.json({ error: "Webhook handling failed" }, { status: 500 });
    }
}
