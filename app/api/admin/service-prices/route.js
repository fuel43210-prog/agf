import { NextResponse } from "next/server";
const { convexQuery, convexMutation } = require("../../../lib/convexServer");

export async function GET() {
    try {
        await convexMutation("admin:ensureDefaultServicePrices", {});
        const prices = (await convexQuery("admin:listServicePrices", {})) || [];
        return NextResponse.json(prices);
    } catch (err) {
        console.error("Service prices fetch error details:", err);
        return NextResponse.json({
            error: err?.message || "Internal server error",
            details: String(err),
            stack: err?.stack
        }, { status: 500 });
    }
}

export async function POST(request) {
    try {
        const body = await request.json();
        const { prices } = body; // Expected: [{ service_type: 'crane', amount: 1500 }, ...]

        if (!Array.isArray(prices)) {
            return NextResponse.json({ error: "Invalid data format" }, { status: 400 });
        }

        await convexMutation("admin:upsertServicePrices", { prices });

        return NextResponse.json({ success: true });
    } catch (err) {
        console.error("Service prices update error details:", err);
        return NextResponse.json({
            error: err?.message || "Internal server error",
            details: String(err),
            stack: err?.stack
        }, { status: 500 });
    }
}
