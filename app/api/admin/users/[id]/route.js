import { NextResponse } from "next/server";
const bcrypt = require("bcryptjs");
const { convexQuery, convexMutation } = require("../../../../lib/convexServer");

export async function PATCH(request, context) {
  try {
    const params = await context.params;
    const id = params?.id;
    if (!id) return NextResponse.json({ error: "Invalid user id" }, { status: 400 });

    const body = await request.json();
    const { first_name, last_name, email, phone_number, role, new_password } = body || {};
    if (!first_name || !last_name || !email || !phone_number || role == null) {
      return NextResponse.json(
        { error: "Missing required fields: first_name, last_name, email, phone_number, role" },
        { status: 400 }
      );
    }
    if (!["User", "Admin"].includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const existing = await convexQuery("admin:getUserById", { id });
    if (!existing) return NextResponse.json({ error: "User not found" }, { status: 404 });

    if (String(existing.role || "").toLowerCase() === "admin" && role !== "Admin") {
      const adminCount = await convexQuery("admin:countAdmins", {});
      if (Number(adminCount || 0) <= 1) {
        return NextResponse.json({ error: "At least one admin account must remain" }, { status: 403 });
      }
    }

    const password = new_password?.trim() ? await bcrypt.hash(String(new_password).trim(), 10) : undefined;
    const args = {
      id,
      first_name,
      last_name,
      email,
      phone_number,
      role,
    };
    if (password) args.password = password;

    await convexMutation("admin:updateUser", args);

    const changes = [];
    if (existing.first_name !== first_name || existing.last_name !== last_name) changes.push("name");
    if (existing.email !== email) changes.push("email");
    if (String(existing.phone_number || "") !== String(phone_number || "")) changes.push("phone");
    if (existing.role !== role) changes.push("role");
    if (password) changes.push("password");
    const changeSummary = changes.length ? ` (${changes.join(", ")})` : "";
    await convexMutation("logs:addActivity", {
      type: "user_updated",
      message: `User ${first_name} ${last_name} updated${changeSummary}`,
      entity_type: "user",
      entity_id: String(id),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = String(err?.message || "");
    if (/email already in use/i.test(msg)) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }
    console.error("Admin user update error:", err);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}

export async function DELETE(request, context) {
  try {
    const params = await context.params;
    const id = params?.id;
    if (!id) return NextResponse.json({ error: "Invalid user id" }, { status: 400 });

    const user = await convexQuery("admin:getUserById", { id });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (String(user.role || "").toLowerCase() === "admin") {
      return NextResponse.json({ error: "Cannot delete admin accounts" }, { status: 403 });
    }

    await convexMutation("admin:deleteUser", { id });
    await convexMutation("logs:addActivity", {
      type: "user_deleted",
      message: `User ${user.first_name} ${user.last_name} removed`,
      entity_type: "user",
      entity_id: String(id),
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Admin user delete error:", err);
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}
