import { NextResponse } from "next/server";
const { convexQuery, convexMutation } = require("../../../lib/convexServer");

export async function GET() {
    try {
        const settings = await convexQuery("admin:getPlatformSettings", {});
        return NextResponse.json(settings);
    } catch (err) {
        console.error("Platform settings fetch error:", err);
        return NextResponse.json({ error: "Failed to load platform settings" }, { status: 500 });
    }
}

export async function PUT(request) {
    try {
        const body = await request.json();
        await convexMutation("admin:upsertPlatformSettings", {
            is_raining: body.is_raining,
            is_emergency: body.is_emergency,
            delivery_fee_base: body.delivery_fee_base,
            platform_service_fee_percentage: body.platform_service_fee_percentage,
            surge_night_multiplier: body.surge_night_multiplier,
            surge_rain_multiplier: body.surge_rain_multiplier,
        });

        return NextResponse.json({ success: true });
    } catch (err) {
        console.error("Platform settings update error:", err);
        return NextResponse.json({ error: "Failed to update platform settings" }, { status: 500 });
    }
}
