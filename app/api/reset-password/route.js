import { NextResponse } from "next/server";
const bcrypt = require("bcryptjs");
const { convexQuery, convexMutation } = require("../../lib/convexServer");

function parseCreatedAt(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const withTimezone = /Z$|[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : `${normalized}Z`;
  const parsed = new Date(withTimezone);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const token = body?.token && String(body.token).trim();
    const newPassword = body?.password && String(body.password);
    if (!token || !newPassword) {
      return NextResponse.json({ error: "Token and new password are required" }, { status: 400 });
    }

    const row = await convexQuery("password_reset:getByToken", { token });
    if (!row) return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    if (row.used) return NextResponse.json({ error: "Token already used" }, { status: 400 });

    const created = parseCreatedAt(row.created_at);
    if (!created) return NextResponse.json({ error: "Error validating token" }, { status: 400 });
    if (Date.now() - created.getTime() > 24 * 60 * 60 * 1000) {
      return NextResponse.json({ error: "Token expired" }, { status: 400 });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    const accountType = String(row.account_type || "users").toLowerCase();
    const accountId = row.account_id || row.user_id;
    if (!accountId) return NextResponse.json({ error: "Invalid token" }, { status: 400 });

    await convexMutation("password_reset:updateAccountPassword", {
      account_type: accountType,
      account_id: accountId,
      password: hashed,
    });
    await convexMutation("password_reset:markUsed", { id: row._id });
    await convexMutation("logs:addActivity", {
      type: "password_reset",
      message: `Password reset for ${accountType} ${String(accountId)}`,
      entity_type: accountType,
      entity_id: String(accountId),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Reset password error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
