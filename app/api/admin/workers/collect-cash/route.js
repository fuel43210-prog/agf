import { NextResponse } from "next/server";
const { convexMutation } = require("../../../../lib/convexServer");
const isInvalidWorkerId = (id) => {
  const value = String(id ?? "").trim().toLowerCase();
  return value === "" || value === "undefined" || value === "null";
};

export async function POST(request) {
  try {
    const { worker_id, notes } = await request.json();
    if (isInvalidWorkerId(worker_id)) {
      return NextResponse.json({ error: "Worker ID is required" }, { status: 400 });
    }

    const result = await convexMutation("admin:collectWorkerCash", { worker_id, notes });
    await convexMutation("logs:addActivity", {
      type: "cash_collected",
      message: `Admin collected ${result.amount_collected} floater cash from worker ID ${worker_id}`,
      entity_type: "worker",
      entity_id: String(worker_id),
    });

    return NextResponse.json({
      success: true,
      message: "Cash collection recorded and worker status unlocked.",
      amount_collected: result.amount_collected,
      worker_id,
      collected_at: result.collected_at,
    });
  } catch (err) {
    const msg = String(err?.message || "");
    if (/worker not found/i.test(msg)) {
      return NextResponse.json({ error: "Worker not found" }, { status: 404 });
    }
    console.error("Cash collection error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
