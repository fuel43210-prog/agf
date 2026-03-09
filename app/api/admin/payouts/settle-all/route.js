import { NextResponse } from "next/server";
const { requireAdmin, errorResponse, successResponse } = require("../../../../../database/auth-middleware");
const { createRazorpayContact, createRazorpayFundAccount, createRazorpayPayout } = require("../../../../utils/razorpayX");
const { decrypt } = require("../../../../utils/encryption");
const { convexQuery, convexMutation } = require("../../../../lib/convexServer");

function normalizeAccountNumber(value) {
  return String(value || "").replace(/\s+/g, "");
}

function normalizeIfsc(value) {
  return String(value || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function isValidIfsc(value) {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(value);
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function POST(request) {
  const auth = requireAdmin(request);
  if (!auth) return errorResponse("Unauthorized", 401);

  try {
    const eligibleWorkers = (await convexQuery("admin:listEligibleWorkersForPayout", {})) || [];
    console.log(`[Settle-All] Found ${eligibleWorkers.length} eligible workers for payout.`);
    if (eligibleWorkers.length === 0) {
      return errorResponse("No verified workers found with pending balance.", 400);
    }

    const results = {
      total_workers: eligibleWorkers.length,
      success_count: 0,
      failed_count: 0,
      total_amount: 0,
      details: [],
    };

    for (const worker of eligibleWorkers) {
      try {
        const pendingBalance = toNumber(worker.pending_balance, 0);
        if (pendingBalance <= 0) {
          results.failed_count += 1;
          results.details.push({
            worker_id: worker.id,
            name: worker.first_name,
            status: "failed",
            error: "Invalid pending balance",
          });
          continue;
        }

        let contact_id = worker.razorpay_contact_id;
        let fund_account_id = worker.razorpay_fund_account_id;

        if (!contact_id) {
          const contact = await createRazorpayContact({
            name: `${worker.first_name || ""} ${worker.last_name || ""}`.trim(),
            email: worker.email,
            contact: worker.phone_number,
          });
          contact_id = contact.id;
          await convexMutation("admin:saveWorkerPayoutRefs", {
            worker_id: worker.id,
            razorpay_contact_id: contact_id,
          });
        }

        if (!fund_account_id) {
          const rawIfsc = decrypt(worker.ifsc_code || "");
          const rawAccountNumber = decrypt(worker.account_number || "");
          const normalizedIfsc = normalizeIfsc(rawIfsc);
          const normalizedAccountNumber = normalizeAccountNumber(rawAccountNumber);

          if (!isValidIfsc(normalizedIfsc)) {
            await convexMutation("admin:updateWorkerBankVerification", {
              worker_id: worker.id,
              status: 2,
              rejection_reason: "Invalid IFSC format. Must be 11 characters (e.g., HDFC0001234).",
            });
            throw new Error(`Invalid IFSC for worker ${worker.id}. Please correct bank details and re-verify.`);
          }

          if (!/^\d{9,18}$/.test(normalizedAccountNumber)) {
            await convexMutation("admin:updateWorkerBankVerification", {
              worker_id: worker.id,
              status: 2,
              rejection_reason: "Invalid account number. Must be 9 to 18 digits.",
            });
            throw new Error(`Invalid account number for worker ${worker.id}. Please correct bank details and re-verify.`);
          }

          const fundAccount = await createRazorpayFundAccount(contact_id, {
            name: worker.account_holder_name,
            ifsc: normalizedIfsc,
            account_number: normalizedAccountNumber,
          });
          fund_account_id = fundAccount.id;
          await convexMutation("admin:saveWorkerPayoutRefs", {
            worker_id: worker.id,
            razorpay_fund_account_id: fund_account_id,
          });
        }

        // Razorpay reference_id has a 40-char limit
        const refId = `W${String(worker.id).slice(-6)}_${Date.now().toString().slice(-9)}`;
        const payout = await createRazorpayPayout({
          fund_account_id,
          amount: pendingBalance,
          reference_id: refId,
        });

        await convexMutation("admin:finalizeWorkerPayout", {
          worker_id: worker.id,
          amount: pendingBalance,
          payout_id: payout.id,
          status: payout.status || "processing",
          notes: "Admin payout settlement",
        });

        results.success_count += 1;
        results.total_amount += pendingBalance;
        results.details.push({
          worker_id: worker.id,
          name: worker.first_name,
          status: "success",
          payout_id: payout.id,
        });
      } catch (err) {
        console.error(`Payout failed for worker ${worker.id}:`, err);
        results.failed_count += 1;
        results.details.push({
          worker_id: worker.id,
          name: worker.first_name,
          status: "failed",
          error: err?.message || "Payout failed",
        });
      }
    }

    return successResponse(results);
  } catch (err) {
    console.error("Bulk payout error:", err);
    return errorResponse("Internal server error during payout processing", 500);
  }
}
