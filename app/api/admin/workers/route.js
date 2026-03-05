import { NextResponse } from "next/server";
const { convexQuery } = require("../../../lib/convexServer");

export async function GET() {
  try {
    const workers = (await convexQuery("admin:listWorkers", {})) || [];
    return NextResponse.json(workers);
  } catch (err) {
    console.error("Admin workers list error:", err);
    return NextResponse.json({ error: "Failed to load workers" }, { status: 500 });
  }
}
