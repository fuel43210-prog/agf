import { NextResponse } from "next/server";
const bcrypt = require("bcryptjs");
const { convexMutation } = require("../../../lib/convexServer");

export async function POST(request) {
  try {
    const body = await request.json();
    const {
      station_name,
      email,
      phone_number,
      address,
      latitude,
      longitude,
      password,
    } = body || {};

    // Validate required fields
    if (
      !station_name ||
      !email ||
      !phone_number ||
      !address ||
      latitude === undefined ||
      latitude === null ||
      longitude === undefined ||
      longitude === null ||
      !password
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required fields: station_name, email, phone_number, address, latitude, longitude, password"
        },
        { status: 400 }
      );
    }

    // Validate coordinates
    if (
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      latitude < -90 || latitude > 90 ||
      longitude < -180 || longitude > 180
    ) {
      return NextResponse.json(
        { success: false, error: "Invalid coordinates" },
        { status: 400 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    try {
      const userResult = await convexMutation("users:signup", {
        email,
        password: hashedPassword,
        first_name: station_name,
        last_name: "Station",
        phone_number,
        role: "Fuel_Station",
      });

      const fuelStationResult = await convexMutation("fuel_stations:create", {
        user_id: userResult.id,
        station_name,
        email,
        phone_number,
        address,
        latitude,
        longitude,
        cod_enabled: true,
        is_verified: false,
        is_open: true,
      });

      await convexMutation("logs:addActivity", {
        type: "fuel_station_created",
        message: `Fuel station ${station_name} created`,
        entity_type: "Station",
        entity_id: String(fuelStationResult.id),
      });

      return NextResponse.json(
        {
          success: true,
          message: "Fuel station account created successfully",
          fuel_station_id: fuelStationResult.id,
          user_id: userResult.id,
        },
        { status: 201 }
      );
    } catch (err) {
      const message = String(err?.message || "");
      const isDuplicateEmail =
        /unique constraint|duplicate key|\bunique\b|email already exists/i.test(message);

      if (isDuplicateEmail) {
        return NextResponse.json(
          { success: false, error: "Email already exists" },
          { status: 409 }
        );
      }
      throw err;
    }
  } catch (err) {
    console.error("Fuel station signup error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

