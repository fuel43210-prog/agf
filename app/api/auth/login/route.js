import { NextResponse } from "next/server";
const { generateToken } = require("../../../../database/auth-middleware");
const bcrypt = require("bcryptjs");
const { convexQuery, convexMutation } = require("../../../lib/convexServer");

export async function POST(request) {
  try {
    const body = await request.json();
    const { role, email, password } = body || {};

    if (!email || !password || !role) {
      return NextResponse.json(
        { success: false, error: "Missing email, password, or role" },
        { status: 400 }
      );
    }

    const user = await convexQuery("auth:getLoginAccount", { role, email });

    if (!user) {
      return NextResponse.json(
        { 
          success: false, 
          error: "No account found for this email and role. Please sign up first." 
        },
        { status: 401 }
      );
    }

    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return NextResponse.json(
        { success: false, error: "Incorrect password." },
        { status: 401 }
      );
    }

    // Generate JWT token
    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    // Log login activity
    const activityMessage = `${user.role} login`;
    await convexMutation("logs:addActivity", {
      type: "login",
      message: activityMessage,
      entity_type: user.role,
      entity_id: String(user.id),
    });

    return NextResponse.json(
      {
        success: true,
        token,
        user: {
          id: user.id,
          serial_id: user.serial_id ?? null,
          email: user.email,
          role: user.role,
          first_name: user.first_name,
          last_name: user.last_name,
          phone_number: user.phone_number || "",
          ...(user.role === "Fuel_Station" && {
            station_name: user.station_name,
            is_verified: user.is_verified,
            cod_enabled: user.cod_enabled,
          }),
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Login error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
