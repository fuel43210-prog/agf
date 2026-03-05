import { NextResponse } from "next/server";
const { requireWorker, errorResponse, successResponse } = require("../../../../database/auth-middleware");
const { encrypt, decrypt, maskValue } = require("../../../utils/encryption");
const { convexQuery, convexMutation } = require("../../../lib/convexServer");

/** GET worker bank details (masked) */
export async function GET(request) {
    const auth = requireWorker(request);
    if (!auth) return errorResponse("Unauthorized", 401);

    try {
        const bankDetails = await convexQuery("admin:getWorkerBankDetails", { worker_id: auth.id });

        if (!bankDetails) {
            return successResponse({ bank_details: null });
        }

        // Mask the sensitive details even for the worker themselves
        // They can edit, but once submitted, we hide the full number for security.
        return successResponse({
            bank_details: {
                ...bankDetails,
                account_number: maskValue(decrypt(bankDetails.account_number), 4),
                ifsc_code: maskValue(decrypt(bankDetails.ifsc_code), 4),
            }
        });
    } catch (err) {
        console.error("GET bank-details error:", err);
        return errorResponse("Internal server error", 500);
    }
}

/** POST/Update worker bank details */
export async function POST(request) {
    const auth = requireWorker(request);
    if (!auth) return errorResponse("Unauthorized", 401);

    try {
        const { account_holder_name, account_number, ifsc_code, bank_name } = await request.json();

        if (!account_holder_name || !account_number || !ifsc_code || !bank_name) {
            return errorResponse("All bank details are required", 400);
        }

        const normalizedAccountHolderName = String(account_holder_name).trim();
        const normalizedBankName = String(bank_name).trim();
        const normalizedAccountNumber = String(account_number).replace(/\s+/g, "");
        const normalizedIfsc = String(ifsc_code).replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

        if (!/^\d{9,18}$/.test(normalizedAccountNumber)) {
            return errorResponse("Account number must be 9 to 18 digits", 400);
        }

        // Standard IFSC format: 4 letters + 0 + 6 alphanumeric characters.
        if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(normalizedIfsc)) {
            return errorResponse("Invalid IFSC format. Expected 11 characters (e.g., HDFC0001234)", 400);
        }

        // Encrypt sensitive data
        const encryptedAccount = encrypt(normalizedAccountNumber);
        const encryptedIFSC = encrypt(normalizedIfsc);

        try {
            await convexMutation("admin:upsertWorkerBankDetailsForWorker", {
                worker_id: auth.id,
                account_holder_name: normalizedAccountHolderName,
                account_number: encryptedAccount,
                ifsc_code: encryptedIFSC,
                bank_name: normalizedBankName,
            });
        } catch (err) {
            if (/already verified/i.test(String(err?.message || ""))) {
                return errorResponse("Bank details are already verified and cannot be changed. Contact support to update.", 403);
            }
            throw err;
        }

        return successResponse({ message: "Bank details submitted for verification" });
    } catch (err) {
        console.error("POST bank-details error:", err);
        return errorResponse("Internal server error", 500);
    }
}
