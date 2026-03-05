import { NextResponse } from "next/server";
const { requireAuth, errorResponse, successResponse } = require("../../../../database/auth-middleware");
const { encrypt, decrypt } = require("../../../utils/encryption");
const { convexQuery, convexMutation } = require("../../../lib/convexServer");

function maskValue(value, keep = 4) {
  const raw = String(value || "");
  if (!raw) return "";
  if (raw.length <= keep) return "*".repeat(raw.length);
  return `${"*".repeat(raw.length - keep)}${raw.slice(-keep)}`;
}

async function resolveFuelStationId(auth) {
  if (!auth) return null;
  const station = await convexQuery("fuel_station_ops:resolveStation", {
    fuel_station_id: auth.id,
    user_id: auth.id,
    email: auth.email,
  });
  return station?.id || null;
}

export async function GET(request) {
  const auth = requireAuth(request);
  if (!auth) return errorResponse("Unauthorized", 401);

  const fuelStationId = await resolveFuelStationId(auth);
  if (!fuelStationId) return errorResponse("Unauthorized", 401);

  try {
    const bankDetails = await convexQuery("fuel_station_ops:getBankDetails", {
      fuel_station_id: fuelStationId,
    });

    if (!bankDetails) {
      return successResponse({ bank_details: null });
    }

    const rawAccount = (() => {
      try {
        return decrypt(bankDetails.account_number);
      } catch {
        return String(bankDetails.account_number || "");
      }
    })();
    const rawIfsc = (() => {
      try {
        return decrypt(bankDetails.ifsc_code);
      } catch {
        return String(bankDetails.ifsc_code || "");
      }
    })();

    return successResponse({
      bank_details: {
        account_holder_name: bankDetails.account_holder_name,
        account_number: maskValue(rawAccount, 4),
        ifsc_code: maskValue(rawIfsc, 4),
        bank_name: bankDetails.bank_name,
        updated_at: bankDetails.updated_at,
      },
    });
  } catch (err) {
    console.error("GET fuel-station bank-details error:", err);
    return errorResponse("Internal server error", 500);
  }
}

export async function POST(request) {
  const auth = requireAuth(request);
  if (!auth) return errorResponse("Unauthorized", 401);

  const fuelStationId = await resolveFuelStationId(auth);
  if (!fuelStationId) return errorResponse("Unauthorized", 401);

  try {
    const { account_holder_name, account_number, ifsc_code, bank_name } = await request.json();

    if (!account_holder_name || !account_number || !ifsc_code || !bank_name) {
      return errorResponse("All bank details are required", 400);
    }

    const normalizedHolder = String(account_holder_name).trim();
    const normalizedBank = String(bank_name).trim();
    const normalizedAccount = String(account_number).replace(/\s+/g, "");
    const normalizedIfsc = String(ifsc_code).replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

    if (!/^\d{9,18}$/.test(normalizedAccount)) {
      return errorResponse("Account number must be 9 to 18 digits", 400);
    }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(normalizedIfsc)) {
      return errorResponse("Invalid IFSC format. Expected 11 characters (e.g., HDFC0001234)", 400);
    }

    await convexMutation("fuel_station_ops:upsertBankDetails", {
      fuel_station_id: fuelStationId,
      account_holder_name: normalizedHolder,
      account_number: encrypt(normalizedAccount),
      ifsc_code: encrypt(normalizedIfsc),
      bank_name: normalizedBank,
    });

    return successResponse({ message: "Bank details saved successfully." });
  } catch (err) {
    console.error("POST fuel-station bank-details error:", err);
    return errorResponse("Internal server error", 500);
  }
}
