import { NextResponse } from "next/server";
const { convexQuery } = require("../../../lib/convexServer");

export async function GET() {
  try {
    const users = (await convexQuery("admin:listUsers", {})) || [];
    return NextResponse.json(users.map((u) => ({ ...u, id: u._id })));
  } catch (err) {
    console.error("Admin users list error:", err);
    return NextResponse.json({ error: "Failed to load users" }, { status: 500 });
  }
}
