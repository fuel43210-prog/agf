import { NextResponse } from "next/server";
const { convexQuery, convexMutation } = require("../../lib/convexServer");

export async function POST(request) {
    try {
        const body = await request.json();
        const { request_id, rating, review_comment } = body;

        if (!request_id || !rating) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        const updated = await convexMutation("service_requests:addFeedback", {
            id: request_id,
            rating,
            review_comment: review_comment || "",
        });

        if (updated?.assigned_worker) {
            const workerId = updated.assigned_worker;
            const recentRatings =
                (await convexQuery("service_requests:recentCompletedRatingsForWorker", { worker_id: workerId })) || [];
            if (recentRatings.length >= 10) {
                const avg = recentRatings.reduce((a, b) => a + Number(b || 0), 0) / recentRatings.length;
                if (avg < 3) {
                    await convexMutation("workers:lockByLowRating", { worker_id: workerId });
                    console.log(`Worker ${workerId} locked due to low rating: ${avg}`);
                }
            }
        }

        return NextResponse.json({ success: true });
    } catch (err) {
        console.error("Feedback error:", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
