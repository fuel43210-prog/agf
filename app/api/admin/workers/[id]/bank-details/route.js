import { NextResponse } from "next/server";
const { requireAdmin, errorResponse, successResponse } = require("../../../../../../database/auth-middleware");
const { decrypt } = require("../../../../../utils/encryption");
const { convexQuery, convexMutation } = require("../../../../../lib/convexServer");
const isInvalidWorkerId = (id) => {
    const value = String(id ?? "").trim().toLowerCase();
    return value === "" || value === "undefined" || value === "null";
};

export async function GET(request, props) {
    const params = await props.params;
    const { id } = params;
    if (isInvalidWorkerId(id)) return errorResponse("Invalid worker id", 400);

    const auth = requireAdmin(request);
    if (!auth) return errorResponse("Unauthorized", 401);

    try {
        const bankDetails = await convexQuery("admin:getWorkerBankDetails", { worker_id: id });

        if (!bankDetails) {
            return errorResponse("Bank details not found", 404);
        }

        // Decrypt sensitive data for admin
        return successResponse({
            bank_details: {
                ...bankDetails,
                account_number: decrypt(bankDetails.account_number),
                ifsc_code: decrypt(bankDetails.ifsc_code),
            }
        });
    } catch (err) {
        console.error("Admin GET bank-details error:", err);
        return errorResponse("Internal server error", 500);
    }
}

export async function PATCH(request, props) {
    const params = await props.params;
    const { id } = params;
    if (isInvalidWorkerId(id)) return errorResponse("Invalid worker id", 400);

    const auth = requireAdmin(request);
    if (!auth) return errorResponse("Unauthorized", 401);

    try {
        const { status, rejection_reason } = await request.json();

        if (![0, 1, 2].includes(status)) {
            return errorResponse("Invalid status", 400);
        }

        await convexMutation("admin:updateWorkerBankVerification", {
            worker_id: id,
            status,
            rejection_reason,
        });

        return successResponse({ message: "Verification status updated" });
    } catch (err) {
        if (/bank details not found/i.test(String(err?.message || ""))) {
            return errorResponse("Bank details not found", 404);
        }
        console.error("Admin PATCH bank-status error:", err);
        return errorResponse("Internal server error", 500);
    }
}
