// API Route for Worker Payouts and Settlements
import { NextResponse } from "next/server";
const { convexQuery, convexMutation } = require("../../lib/convexServer");

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const summary = searchParams.get("summary");
    const worker_id = searchParams.get("worker_id");

    if (summary === "true") {
      const rows = (await convexQuery("admin:listPayoutWorkersSummary", {})) || [];
      return NextResponse.json(rows);
    } else if (worker_id) {
      const rows = (await convexQuery("admin:listWorkerPayouts", { worker_id })) || [];
      return NextResponse.json(rows);
    }

    return NextResponse.json([]);
  } catch (err) {
    console.error("Payouts API Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { worker_id, amount, reference_id, notes } = body;

    if (!worker_id || !amount) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const args = { worker_id, amount };
    if (reference_id) args.reference_id = reference_id;
    if (notes) args.notes = notes;

    await convexMutation("admin:createWorkerPayout", args);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Payout Creation Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
