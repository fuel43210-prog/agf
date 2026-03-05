import { NextResponse } from "next/server";
const bcrypt = require("bcryptjs");
const { generateToken } = require("../../../database/auth-middleware");
const { convexQuery } = require("../../lib/convexServer");

export async function POST(request) {
  try {
    const body = await request.json();
    const { role, email, password } = body || {};

    if (!email || !password || !role) {
      return NextResponse.json({ error: "Missing email, password, or role" }, { status: 400 });
    }

    const normalizedRole = role === "Station" ? "Fuel_Station" : role;
    const user = await convexQuery("auth:getLoginAccount", { role: normalizedRole, email });

    if (!user) {
      return NextResponse.json(
        { error: "No account found for this email and role. Please sign up first." },
        { status: 401 }
      );
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
    }

    if (role === "Admin" && user.role !== "Admin") {
      return NextResponse.json({ error: "You are not an admin" }, { status: 403 });
    }
    if (role === "User" && user.role !== "User") {
      return NextResponse.json({ error: "This account is not a user account" }, { status: 403 });
    }

    const finalRole = role === "Station" ? "Station" : user.role;
    const token = generateToken({ id: user.id, email: user.email, role: finalRole });

    return NextResponse.json(
      {
        success: true,
        id: user.id,
        serial_id: user.serial_id ?? null,
        role: finalRole,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        phone_number: user.phone_number || "",
        driving_licence: user.driving_licence || "",
        station_name: user.station_name,
        is_verified: user.is_verified,
        cod_enabled: user.cod_enabled,
        token,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Login error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
