import { NextResponse } from "next/server";
const { convexQuery, convexMutation } = require("../../../lib/convexServer");

export async function GET() {
  try {
    const users = (await convexQuery("admin:listCodUsers", {})) || [];

    return NextResponse.json(
      users.map((u) => ({
        ...u,
        id: u._id,
        cod_disabled: u.cod_disabled ? 1 : 0,
      }))
    );
  } catch (err) {
    console.error("COD users fetch error:", err);
    return NextResponse.json({ error: "Failed to load COD users" }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    const { user_id, cod_disabled, reset_counts } = body || {};

    if (!user_id) {
      return NextResponse.json({ error: "user_id required" }, { status: 400 });
    }

    try {
      await convexMutation("admin:updateCodUser", {
        user_id,
        cod_disabled,
        reset_counts,
      });
    } catch (err) {
      const msg = String(err?.message || "");
      if (/no updates/i.test(msg)) {
        return NextResponse.json({ error: "No updates" }, { status: 400 });
      }
      if (/not found|not eligible/i.test(msg)) {
        return NextResponse.json({ error: "User not found or not eligible for COD controls" }, { status: 404 });
      }
      throw err;
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("COD user update error:", err);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}
