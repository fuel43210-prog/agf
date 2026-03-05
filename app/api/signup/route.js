import { NextResponse } from "next/server";
const bcrypt = require("bcryptjs");
const { validatePhoneByCountry } = require("../../signup/phoneValidation");
const { convexMutation } = require("../../lib/convexServer");

export async function POST(request) {
  try {
    const body = await request.json();
    const {
      role,
      firstName,
      lastName,
      email,
      countryIso2,
      countryDial,
      phone,
      password,
    } = body || {};

    if (
      !role ||
      !firstName ||
      !lastName ||
      !email ||
      !countryIso2 ||
      !countryDial ||
      !phone ||
      !password
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const dialDigits = String(countryDial).replace(/\D/g, "");
    let nationalNumber = String(phone || "");
    if (dialDigits) {
      const dialRegex = new RegExp(`^\\+?${dialDigits}`);
      nationalNumber = nationalNumber.replace(dialRegex, "");
    }

    const phoneCheck = validatePhoneByCountry({
      countryIso2,
      dialCode: countryDial,
      nationalNumber,
    });

    if (!phoneCheck.valid) {
      return NextResponse.json({ error: phoneCheck.message }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const isWorker = role === "Worker";

    let result;
    if (isWorker) {
      result = await convexMutation("workers:createWorker", {
        email,
        password: hashedPassword,
        first_name: firstName,
        last_name: lastName,
        phone_number: phoneCheck.fullPhone,
      });
    } else {
      result = await convexMutation("users:signup", {
        email,
        password: hashedPassword,
        first_name: firstName,
        last_name: lastName,
        phone_number: phoneCheck.fullPhone,
        role: "User",
      });
    }

    const { generateToken } = require("../../../database/auth-middleware");
    const token = generateToken({
      id: result.id,
      email: email,
      role: isWorker ? "Worker" : "User"
    });

    return NextResponse.json(
      {
        success: true,
        id: result.id,
        type: isWorker ? "worker" : "user",
        token: token
      },
      { status: 201 }
    );
  } catch (err) {
    const message = String(err?.message || "");
    const isDuplicateEmail =
      /already exists|unique constraint|duplicate key|\bunique\b/i.test(message);

    if (isDuplicateEmail) {
      return NextResponse.json(
        { error: "Email already exists" },
        { status: 409 }
      );
    }

    console.error("Signup error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

