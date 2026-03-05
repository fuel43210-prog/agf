import { NextResponse } from "next/server";
const { requireAdmin, errorResponse, successResponse } = require("../../../../../database/auth-middleware");
const { convexQuery, convexMutation } = require("../../../../lib/convexServer");
const { createRazorpayContact, createRazorpayFundAccount, createRazorpayPayout } = require("../../../../utils/razorpayX");
const { decrypt } = require("../../../../utils/encryption");

function normalizeAccountNumber(value) {
  return String(value || "").replace(/\s+/g, "");
}

function normalizeIfsc(value) {
  return String(value || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function isValidIfsc(value) {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(value);
}

function sanitizeRazorpayName(value) {
  const ascii = String(value || "")
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "");
  const cleaned = ascii
    .replace(/[^a-zA-Z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned.slice(0, 50);
}

function buildRazorpayContactName(station) {
  const candidates = [
    sanitizeRazorpayName(station.station_name),
    sanitizeRazorpayName(station.account_holder_name),
    "Fuel Station Account",
  ];
  for (const name of candidates) {
    if (name.length >= 3) return name;
  }
  return "Fuel Station Account";
}

function normalizeContactEmail(value, stationId) {
  const email = String(value || "").trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return email;
  return `station${stationId}@example.com`;
}

function normalizeContactNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (/^\d{10}$/.test(digits)) return digits;
  if (/^91\d{10}$/.test(digits)) return digits;
  return "";
}

function isMockPayoutMode() {
  const accountNumber = process.env.RAZORPAY_ACCOUNT_NUMBER || "";
  const forceMock = String(process.env.FORCE_MOCK_PAYOUTS || "").toLowerCase();
  const isForced = forceMock === "1" || forceMock === "true" || forceMock === "yes";
  const invalidAccount =
    !accountNumber ||
    accountNumber === "your_razorpayx_account_number_here" ||
    accountNumber.length < 10;
  return isForced || invalidAccount;
}

function safeDecrypt(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return decrypt(raw);
  } catch {
    return raw;
  }
}

async function settleStation(station) {
  const fuelStationId = station.id;
  const stationName = station.station_name || `Fuel Station ${fuelStationId}`;
  const mockMode = isMockPayoutMode();

  await convexMutation("fuel_station_ops:ensureStationPendingLedger", { fuel_station_id: fuelStationId });
  const pendingRows = (await convexQuery("fuel_station_ops:listStationPendingEarnings", { fuel_station_id: fuelStationId })) || [];

  if (!pendingRows.length) {
    return {
      fuel_station_id: fuelStationId,
      station_name: stationName,
      status: "skipped",
      settled_amount: 0,
      count: 0,
      reason: "No pending earning entries",
    };
  }

  const ledgerIds = pendingRows.map((row) => row.id);
  const amountToSettle = pendingRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);

  let accountNumber = normalizeAccountNumber(safeDecrypt(station.account_number || ""));
  let ifsc = normalizeIfsc(safeDecrypt(station.ifsc_code || ""));

  if (!mockMode && (!station.account_number || !station.ifsc_code)) {
    throw new Error("Bank details missing. Please add account number and IFSC from station login.");
  }
  if (!mockMode && !/^\d{9,18}$/.test(accountNumber)) {
    throw new Error("Invalid station account number. Please update bank details.");
  }
  if (!mockMode && !isValidIfsc(ifsc)) {
    throw new Error("Invalid station IFSC. Please update bank details.");
  }
  if (mockMode) {
    if (!/^\d{9,18}$/.test(accountNumber)) accountNumber = String(900000000000 + Number(fuelStationId || 0));
    if (!isValidIfsc(ifsc)) ifsc = "HDFC0000001";
  }

  let contactId = station.razorpay_contact_id;
  let fundAccountId = station.razorpay_fund_account_id;

  if (!contactId) {
    const contactName = buildRazorpayContactName(station);
    let contactNumber = normalizeContactNumber(station.phone_number);
    const contactEmail = normalizeContactEmail(station.email, fuelStationId);
    if (!contactNumber && mockMode) contactNumber = "9999999999";
    if (!contactNumber && !mockMode) {
      throw new Error(`Invalid station phone for payout contact (station ${fuelStationId}).`);
    }
    const contact = await createRazorpayContact({
      name: contactName,
      email: contactEmail,
      contact: contactNumber,
    });
    contactId = contact.id;
    await convexMutation("fuel_station_ops:saveStationPayoutRefs", {
      fuel_station_id: fuelStationId,
      razorpay_contact_id: contactId,
    });
  }

  if (!fundAccountId) {
    const fundAccount = await createRazorpayFundAccount(contactId, {
      name: "Fuel Station Beneficiary",
      ifsc,
      account_number: accountNumber,
    });
    fundAccountId = fundAccount.id;
    await convexMutation("fuel_station_ops:saveStationPayoutRefs", {
      fuel_station_id: fuelStationId,
      razorpay_fund_account_id: fundAccountId,
    });
  }

  const payout = await createRazorpayPayout({
    fund_account_id: fundAccountId,
    amount: amountToSettle,
    reference_id: `STATION_SETTLE_${fuelStationId}_${Date.now()}`,
  });

  await convexMutation("fuel_station_ops:settleStationPayoutBatch", {
    fuel_station_id: fuelStationId,
    ledger_ids: ledgerIds,
    amount: amountToSettle,
    count: ledgerIds.length,
    reference_id: payout.id,
  });

  return {
    fuel_station_id: fuelStationId,
    station_name: stationName,
    status: "success",
    settled_amount: amountToSettle,
    count: ledgerIds.length,
    payout_id: payout.id,
  };
}

export async function POST(request) {
  const auth = requireAdmin(request);
  if (!auth) return errorResponse("Unauthorized", 401);

  try {
    const body = await request.json().catch(() => ({}));
    const requestedStationId = body?.fuel_station_id || undefined;

    let eligibleStations =
      (await convexQuery("fuel_station_ops:listStationsWithPendingPayouts", {
        fuel_station_id: requestedStationId,
      })) || [];

    if (!eligibleStations.length && requestedStationId) {
      await convexMutation("fuel_station_ops:ensureStationPendingLedger", {
        fuel_station_id: requestedStationId,
      });
      eligibleStations =
        (await convexQuery("fuel_station_ops:listStationsWithPendingPayouts", {
          fuel_station_id: requestedStationId,
        })) || [];
    }

    if (!eligibleStations.length) {
      return errorResponse("No stations with pending payouts found.", 400);
    }

    const results = {
      mock_mode: isMockPayoutMode(),
      total_stations: eligibleStations.length,
      success_count: 0,
      failed_count: 0,
      total_amount: 0,
      details: [],
    };

    for (const station of eligibleStations) {
      try {
        const settled = await settleStation(station);
        if (settled.status === "success") {
          results.success_count += 1;
          results.total_amount += Number(settled.settled_amount || 0);
        } else {
          results.failed_count += 1;
        }
        results.details.push(settled);
      } catch (err) {
        results.failed_count += 1;
        results.details.push({
          fuel_station_id: station.id,
          station_name: station.station_name,
          status: "failed",
          error: err?.message || "Settlement failed",
        });
      }
    }

    return successResponse(results);
  } catch (err) {
    console.error("Bulk station payout error:", err);
    return errorResponse("Internal server error during station payout processing", 500);
  }
}
