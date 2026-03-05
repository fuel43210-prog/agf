import { NextResponse } from "next/server";
const { convexQuery } = require("../../../../../lib/convexServer");
const isInvalidWorkerId = (id) => {
    const value = String(id ?? "").trim().toLowerCase();
    return value === "" || value === "undefined" || value === "null";
};

export async function GET(request, { params }) {
    try {
        const { id } = await params;
        if (isInvalidWorkerId(id)) return NextResponse.json({ error: "Missing worker ID" }, { status: 400 });

        const reviews = await convexQuery("admin:getWorkerReviews", { worker_id: id });

        return NextResponse.json(reviews);
    } catch (err) {
        console.error("Fetch reviews error:", err);
        return NextResponse.json({ error: "Failed to load reviews" }, { status: 500 });
    }
}
