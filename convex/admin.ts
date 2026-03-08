import { mutationGeneric, queryGeneric } from "convex/server";

const nowIso = () => new Date().toISOString();

const defaultCodSettings = {
  cod_limit: 500,
  trust_threshold: 50,
  max_failures: 3,
  disable_days: 7,
};

const defaultPlatformSettings = {
  delivery_fee_base: 50,
  platform_service_fee_percentage: 5,
  is_raining: 0,
  surge_night_multiplier: 1.5,
  surge_rain_multiplier: 1.3,
};

const defaultServicePrices = [
  { service_type: "petrol", amount: 100 },
  { service_type: "diesel", amount: 100 },
  { service_type: "crane", amount: 1500 },
  { service_type: "mechanic_bike", amount: 500 },
  { service_type: "mechanic_car", amount: 1200 },
];

const getByIdInternal = async (ctx: any, id: any) => {
  if (!id || String(id) === "undefined") return null;
  try {
    return await ctx.db.get(id as any);
  } catch {
    return null;
  }
};

const sanitizeIdInternal = (id: any) => {
  if (!id || String(id) === "undefined") return undefined;
  return id;
};

export const getCodSettings = queryGeneric({
  handler: async (ctx) => {
    const row = await ctx.db
      .query("cod_settings")
      .withIndex("by_singleton_key", (q) => q.eq("singleton_key", "default"))
      .first();
    return row || { singleton_key: "default", ...defaultCodSettings };
  },
});

export const upsertCodSettings = mutationGeneric({
  handler: async (ctx, args: any) => {
    const row = await ctx.db
      .query("cod_settings")
      .withIndex("by_singleton_key", (q) => q.eq("singleton_key", "default"))
      .first();
    const patch = {
      cod_limit: Number(args.cod_limit),
      trust_threshold: Number(args.trust_threshold),
      max_failures: Number(args.max_failures),
      disable_days: Number(args.disable_days),
      updated_at: nowIso(),
    };
    if (row) {
      await ctx.db.patch(row._id, patch);
      return { ok: true };
    }
    await ctx.db.insert("cod_settings", { singleton_key: "default", ...patch });
    return { ok: true };
  },
});

export const ensureDefaultServicePrices = mutationGeneric({
  handler: async (ctx) => {
    const existing = await ctx.db.query("service_prices").collect();
    for (const item of defaultServicePrices) {
      const found = existing.find((r) => r.service_type === item.service_type);
      if (!found) {
        await ctx.db.insert("service_prices", {
          service_type: item.service_type,
          amount: item.amount,
          updated_at: nowIso(),
        });
      }
    }
    return { ok: true };
  },
});

export const listServicePrices = queryGeneric({
  handler: async (ctx) => {
    return await ctx.db
      .query("service_prices")
      .collect();
  },
});

export const upsertServicePrices = mutationGeneric({
  handler: async (ctx, args: any) => {
    const rows = await ctx.db.query("service_prices").collect();
    const now = nowIso();
    for (const item of args.prices || []) {
      const serviceType = String(item.service_type || "");
      const amount = Number(item.amount || 0);
      const found = rows.find((r) => r.service_type === serviceType);
      if (found) {
        await ctx.db.patch(found._id, { amount, updated_at: now });
      } else {
        await ctx.db.insert("service_prices", {
          service_type: serviceType,
          amount,
          updated_at: now,
        });
      }
    }
    return { ok: true };
  },
});

export const getPlatformSettings = queryGeneric({
  handler: async (ctx) => {
    const row = await ctx.db
      .query("platform_settings")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .first();
    if (!row) return defaultPlatformSettings;
    try {
      return { ...defaultPlatformSettings, ...JSON.parse(row.value_json || "{}") };
    } catch {
      return defaultPlatformSettings;
    }
  },
});

export const upsertPlatformSettings = mutationGeneric({
  handler: async (ctx, args: any) => {
    const row = await ctx.db
      .query("platform_settings")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .first();
    const next = {
      is_raining: args.is_raining ? 1 : 0,
      delivery_fee_base: Number(args.delivery_fee_base),
      platform_service_fee_percentage: Number(args.platform_service_fee_percentage),
      surge_night_multiplier: Number(args.surge_night_multiplier),
      surge_rain_multiplier: Number(args.surge_rain_multiplier),
    };
    if (row) {
      await ctx.db.patch(row._id, {
        value_json: JSON.stringify(next),
        updated_at: nowIso(),
      });
      return { ok: true };
    }
    await ctx.db.insert("platform_settings", {
      key: "default",
      value_json: JSON.stringify(next),
      updated_at: nowIso(),
    });
    return { ok: true };
  },
});

export const listCodUsers = queryGeneric({
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const stations = await ctx.db.query("fuel_stations").collect();
    const stationUserIds = new Set(stations.map((s) => String(s.user_id || "")));
    return users
      .filter((u) => (u.role || "User") === "User")
      .filter((u) => !stationUserIds.has(String(u._id)))
      .sort((a, b) => {
        const f = Number(b.cod_failure_count || 0) - Number(a.cod_failure_count || 0);
        if (f !== 0) return f;
        return Number(a.trust_score || 0) - Number(b.trust_score || 0);
      });
  },
});

export const updateCodUser = mutationGeneric({
  handler: async (ctx, args: any) => {
    const user = await getByIdInternal(ctx, args.user_id);
    if (!user || (user.role || "User") !== "User") {
      throw new Error("User not found or not eligible for COD controls");
    }
    const stations = await ctx.db.query("fuel_stations").collect();
    if (stations.some((s) => String(s.user_id || "") === String(user._id))) {
      throw new Error("User not found or not eligible for COD controls");
    }

    const patch: Record<string, any> = {};
    if (args.cod_disabled !== undefined) {
      patch.cod_disabled = Boolean(args.cod_disabled);
      if (!args.cod_disabled) patch.cod_disabled_until = undefined;
    }
    if (args.reset_counts) {
      patch.cod_success_count = 0;
      patch.cod_failure_count = 0;
      patch.cod_last_failure_reason = undefined;
    }
    if (Object.keys(patch).length === 0) {
      throw new Error("No updates");
    }
    await ctx.db.patch(user._id, patch);
    return { ok: true };
  },
});

export const getStatsSnapshot = queryGeneric({
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const workers = await ctx.db.query("workers").collect();
    const requests = await ctx.db.query("service_requests").collect();
    const activity = await ctx.db.query("activity_log").collect();
    return { users, workers, requests, activity };
  },
});

export const listUsers = queryGeneric({
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const stations = await ctx.db.query("fuel_stations").collect();
    const stationUserIds = new Set(stations.map((s) => String(s.user_id || "")));
    return users
      .filter((u) => ["User", "Admin"].includes(String(u.role || "User")))
      .filter((u) => !stationUserIds.has(String(u._id)))
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  },
});

export const getUserById = queryGeneric({
  handler: async (ctx, args: any) => {
    return await getByIdInternal(ctx, args.id);
  },
});

export const countAdmins = queryGeneric({
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    return users.filter((u) => String(u.role || "").toLowerCase() === "admin").length;
  },
});

export const updateUser = mutationGeneric({
  handler: async (ctx, args: any) => {
    const user = await getByIdInternal(ctx, args.id);
    if (!user) throw new Error("User not found");
    const users = await ctx.db.query("users").collect();
    const existingEmail = users.find(
      (u) => String(u._id) !== String(user._id) && String(u.email || "").toLowerCase() === String(args.email || "").toLowerCase()
    );
    if (existingEmail) throw new Error("Email already in use");
    await ctx.db.patch(user._id, {
      first_name: args.first_name,
      last_name: args.last_name,
      email: String(args.email || "").toLowerCase(),
      phone_number: args.phone_number,
      role: args.role,
      ...(args.password ? { password: args.password } : {}),
      updated_at: nowIso(),
    });
    return { ok: true };
  },
});

export const deleteUser = mutationGeneric({
  handler: async (ctx, args: any) => {
    const user = await getByIdInternal(ctx, args.id);
    if (!user) throw new Error("User not found");

    const requests = await ctx.db.query("service_requests").collect();
    for (const r of requests) {
      if (String(r.user_id || "") === String(user._id)) {
        await ctx.db.patch(r._id, { user_id: undefined });
      }
    }
    await ctx.db.delete(user._id);
    return { ok: true };
  },
});

export const listWorkers = queryGeneric({
  handler: async (ctx) => {
    const workers = await ctx.db.query("workers").collect();
    const requests = await ctx.db.query("service_requests").collect();
    const bank = await ctx.db.query("worker_bank_details").collect();

    const ratingByWorker = new Map<string, { sum: number; count: number }>();
    for (const r of requests) {
      if (r.assigned_worker && r.rating != null) {
        const key = String(r.assigned_worker);
        const curr = ratingByWorker.get(key) || { sum: 0, count: 0 };
        curr.sum += Number(r.rating || 0);
        curr.count += 1;
        ratingByWorker.set(key, curr);
      }
    }
    const bankByWorker = new Map(bank.map((b) => [String(b.worker_id), b]));

    return workers
      .slice()
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
      .map((w) => {
        const rating = ratingByWorker.get(String(w._id));
        const bankRow = bankByWorker.get(String(w._id));
        return {
          ...w,
          id: w._id,
          avg_rating: rating && rating.count ? rating.sum / rating.count : null,
          is_bank_verified: Number(bankRow?.is_bank_verified || 0),
        };
      });
  },
});

export const getWorkerById = queryGeneric({
  handler: async (ctx, args: any) => {
    return await getByIdInternal(ctx, args.id);
  },
});

export const updateWorker = mutationGeneric({
  handler: async (ctx, args: any) => {
    const worker = await getByIdInternal(ctx, args.id);
    if (!worker) throw new Error("Worker not found");
    const workers = await ctx.db.query("workers").collect();
    const existingEmail = workers.find(
      (w) => String(w._id) !== String(worker._id) && String(w.email || "").toLowerCase() === String(args.email || "").toLowerCase()
    );
    if (existingEmail) throw new Error("Email already in use");

    const patch: Record<string, any> = {
      first_name: args.first_name,
      last_name: args.last_name,
      email: String(args.email || "").toLowerCase(),
      phone_number: args.phone_number,
      status: args.status,
      status_locked: Boolean(args.status_locked),
      verified: Boolean(args.verified),
      updated_at: nowIso(),
    };
    if (args.password) patch.password = args.password;
    if (!patch.verified) patch.docs_submitted_at = undefined;
    if (args.reverify) {
      patch.license_photo = undefined;
      patch.self_photo = undefined;
      patch.docs_submitted_at = undefined;
      patch.verified = false;
    }
    await ctx.db.patch(worker._id, patch);
    return { ok: true };
  },
});

export const deleteWorker = mutationGeneric({
  handler: async (ctx, args: any) => {
    const worker = await getByIdInternal(ctx, args.id);
    if (!worker) throw new Error("Worker not found");
    await ctx.db.delete(worker._id);
    return { ok: true };
  },
});

export const getWorkerReviews = queryGeneric({
  handler: async (ctx, args: any) => {
    const rows = await ctx.db.query("service_requests").collect();
    return rows
      .filter((r) => String(r.assigned_worker || "") === String(args.worker_id))
      .filter((r) => r.rating != null)
      .sort((a, b) =>
        String(b.completed_at || b.created_at || "").localeCompare(String(a.completed_at || a.created_at || ""))
      )
      .slice(0, 10)
      .map((r) => ({
        id: r._id,
        rating: r.rating,
        review_comment: r.review_comment,
        completed_at: r.completed_at,
      }));
  },
});

export const collectWorkerCash = mutationGeneric({
  handler: async (ctx, args: any) => {
    const worker = await getByIdInternal(ctx, args.worker_id);
    if (!worker) throw new Error("Worker not found");
    const floaterCashAmount = Number(worker.floater_cash || 0);
    const now = nowIso();

    if (floaterCashAmount > 0) {
      await ctx.db.insert("settlements", {
        service_request_id: undefined,
        worker_id: worker._id,
        settlement_date: now,
        customer_amount: floaterCashAmount,
        fuel_cost: 0,
        delivery_fee: 0,
        platform_service_fee: 0,
        surge_fee: 0,
        fuel_station_payout: 0,
        worker_payout: 0,
        platform_profit: floaterCashAmount,
        status: "collected",
        notes: `Cash collection: ${floaterCashAmount} INR collected. ${args.notes || ""}`,
        created_at: now,
        updated_at: now,
      });
    }

    await ctx.db.patch(worker._id, {
      floater_cash: 0,
      last_cash_collection_at: now,
      status_locked: false,
      lock_reason: undefined,
      updated_at: now,
    });
    return { ok: true, amount_collected: floaterCashAmount, collected_at: now };
  },
});

export const getWorkerBankDetails = queryGeneric({
  handler: async (ctx, args: any) => {
    const rows = await ctx.db.query("worker_bank_details").collect();
    return rows.find((r) => String(r.worker_id) === String(args.worker_id)) || null;
  },
});

export const updateWorkerBankVerification = mutationGeneric({
  handler: async (ctx, args: any) => {
    const rows = await ctx.db.query("worker_bank_details").collect();
    const row = rows.find((r) => String(r.worker_id) === String(args.worker_id));
    if (!row) throw new Error("Bank details not found");
    await ctx.db.patch(row._id, {
      is_bank_verified: Number(args.status),
      rejection_reason: args.rejection_reason || undefined,
      updated_at: nowIso(),
    });
    return { ok: true };
  },
});

export const upsertWorkerBankDetailsForWorker = mutationGeneric({
  handler: async (ctx, args: any) => {
    const rows = await ctx.db.query("worker_bank_details").collect();
    const row = rows.find((r) => String(r.worker_id) === String(args.worker_id));
    if (row && Number(row.is_bank_verified || 0) === 1) {
      throw new Error("Bank details are already verified and cannot be changed. Contact support to update.");
    }
    const now = nowIso();
    if (row) {
      await ctx.db.patch(row._id, {
        account_holder_name: args.account_holder_name,
        account_number: args.account_number,
        ifsc_code: args.ifsc_code,
        bank_name: args.bank_name,
        is_bank_verified: 0,
        rejection_reason: undefined,
        updated_at: now,
      });
      return { ok: true };
    }
    await ctx.db.insert("worker_bank_details", {
      worker_id: args.worker_id,
      account_holder_name: args.account_holder_name,
      account_number: args.account_number,
      ifsc_code: args.ifsc_code,
      bank_name: args.bank_name,
      is_bank_verified: 0,
      created_at: now,
      updated_at: now,
    });
    return { ok: true };
  },
});

export const handlePayoutWebhook = mutationGeneric({
  handler: async (ctx, args: any) => {
    const payoutId = String(args.payout_id || "");
    const event = String(args.event || "");
    const failureReason = args.failure_reason || "Payout failed";
    if (!payoutId || !event) return { ok: false };

    const logs = await ctx.db.query("payout_logs").collect();
    const log = logs.find((l) => String(l.payout_id || "") === payoutId);
    if (!log) return { ok: false };

    if (event === "payout.processed") {
      await ctx.db.patch(log._id, { status: "processed", updated_at: nowIso() });
      return { ok: true };
    }

    if (["payout.reversed", "payout.rejected", "payout.failed"].includes(event)) {
      const worker = await ctx.db.get(log.worker_id);
      if (worker) {
        await ctx.db.patch(worker._id, {
          pending_balance: Number(worker.pending_balance || 0) + Number(log.amount || 0),
          updated_at: nowIso(),
        });
      }
      await ctx.db.patch(log._id, {
        status: event.split(".")[1],
        error_message: String(failureReason),
        updated_at: nowIso(),
      });
      return { ok: true };
    }

    return { ok: false };
  },
});

export const listPayoutWorkersSummary = queryGeneric({
  handler: async (ctx) => {
    const workers = await ctx.db.query("workers").collect();
    const settlements = await ctx.db.query("settlements").collect();
    const payouts = await ctx.db.query("worker_payouts").collect();

    const earnedByWorker = new Map<string, number>();
    settlements.forEach((s) => {
      const key = String(s.worker_id || "");
      if (!key) return;
      earnedByWorker.set(key, (earnedByWorker.get(key) || 0) + Number(s.worker_payout || 0));
    });
    const paidByWorker = new Map<string, number>();
    payouts.forEach((p) => {
      const key = String(p.worker_id || "");
      if (!key) return;
      paidByWorker.set(key, (paidByWorker.get(key) || 0) + Number(p.amount || 0));
    });

    return workers.map((w) => ({
      id: w._id,
      first_name: w.first_name,
      last_name: w.last_name,
      phone_number: w.phone_number,
      service_type: w.service_type,
      lifetime_earnings: Number(earnedByWorker.get(String(w._id)) || 0),
      total_paid: Number(paidByWorker.get(String(w._id)) || 0),
    }));
  },
});

export const listWorkerPayouts = queryGeneric({
  handler: async (ctx, args: any) => {
    const rows = await ctx.db.query("worker_payouts").collect();
    return rows
      .filter((r) => String(r.worker_id || "") === String(args.worker_id))
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  },
});

export const createWorkerPayout = mutationGeneric({
  handler: async (ctx, args: any) => {
    const id = await ctx.db.insert("worker_payouts", {
      worker_id: args.worker_id,
      amount: Number(args.amount || 0),
      reference_id: args.reference_id || undefined,
      notes: args.notes || undefined,
      created_at: nowIso(),
    });
    return { id };
  },
});

export const listEligibleWorkersForPayout = queryGeneric({
  handler: async (ctx) => {
    const workers = await ctx.db.query("workers").collect();
    const bank = await ctx.db.query("worker_bank_details").collect();
    const bankByWorker = new Map(bank.map((b) => [String(b.worker_id), b]));
    return workers
      .filter((w) => Number(w.pending_balance || 0) > 0)
      .map((w) => {
        const bd = bankByWorker.get(String(w._id));
        return {
          id: w._id,
          first_name: w.first_name,
          last_name: w.last_name,
          email: w.email,
          phone_number: w.phone_number,
          pending_balance: Number(w.pending_balance || 0),
          account_holder_name: bd?.account_holder_name || "",
          account_number: bd?.account_number || "",
          ifsc_code: bd?.ifsc_code || "",
          bank_name: bd?.bank_name || "",
          is_bank_verified: Number(bd?.is_bank_verified || 0),
          razorpay_contact_id: bd?.razorpay_contact_id || "",
          razorpay_fund_account_id: bd?.razorpay_fund_account_id || "",
        };
      })
      .filter((w) => Number(w.is_bank_verified || 0) === 1);
  },
});

export const saveWorkerPayoutRefs = mutationGeneric({
  handler: async (ctx, args: any) => {
    const rows = await ctx.db.query("worker_bank_details").collect();
    const row = rows.find((r) => String(r.worker_id) === String(args.worker_id));
    if (!row) throw new Error("Bank details not found");
    await ctx.db.patch(row._id, {
      ...(args.razorpay_contact_id !== undefined
        ? { razorpay_contact_id: args.razorpay_contact_id }
        : {}),
      ...(args.razorpay_fund_account_id !== undefined
        ? { razorpay_fund_account_id: args.razorpay_fund_account_id }
        : {}),
      updated_at: nowIso(),
    });
    return { ok: true };
  },
});

export const finalizeWorkerPayout = mutationGeneric({
  handler: async (ctx, args: any) => {
    let worker;
    try {
      worker = await ctx.db.get(args.worker_id);
    } catch {
      const workers = await ctx.db.query("workers").collect();
      worker = workers.find((w) => String(w._id) === String(args.worker_id));
    }
    if (!worker) throw new Error("Worker not found");
    const amount = Number(args.amount || 0);
    const now = nowIso();

    await ctx.db.insert("payout_logs", {
      worker_id: worker._id,
      payout_id: args.payout_id || undefined,
      amount,
      status: args.status || "processing",
      created_at: now,
      updated_at: now,
    });

    await ctx.db.insert("worker_payouts", {
      worker_id: worker._id,
      amount,
      reference_id: args.payout_id || undefined,
      notes: args.notes || "Admin payout settlement",
      created_at: now,
    });

    await ctx.db.patch(worker._id, {
      pending_balance: 0,
      last_payout_at: now,
      updated_at: now,
    });
    return { ok: true };
  },
});

export const getLatestFloatingPending = queryGeneric({
  handler: async (ctx, args: any) => {
    const rows = await ctx.db.query("floating_cash_payments").collect();
    const filtered = rows
      .filter((r) => String(r.worker_id || "") === String(args.worker_id))
      .filter((r) => ["created", "processing"].includes(String(r.status || "")))
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    return filtered[0] || null;
  },
});

export const createFloatingPayment = mutationGeneric({
  handler: async (ctx, args: any) => {
    const now = nowIso();
    const id = await ctx.db.insert("floating_cash_payments", {
      worker_id: args.worker_id,
      amount: Number(args.amount),
      amount_paise: Number(args.amount_paise),
      purpose: "FLOATING_CASH_CLEAR",
      razorpay_order_id: args.razorpay_order_id,
      status: "created",
      created_at: now,
      updated_at: now,
    });
    return { id };
  },
});

export const markFloatingPaymentFailed = mutationGeneric({
  handler: async (ctx, args: any) => {
    const rows = await ctx.db.query("floating_cash_payments").collect();
    const row = rows.find(
      (r) =>
        String(r.worker_id || "") === String(args.worker_id) &&
        String(r.razorpay_order_id || "") === String(args.razorpay_order_id) &&
        ["created", "processing"].includes(String(r.status || ""))
    );
    if (!row) return { ok: false };
    await ctx.db.patch(row._id, {
      status: "failed",
      failure_reason: args.reason || "payment_failed_or_cancelled",
      updated_at: nowIso(),
    });
    return { ok: true };
  },
});

export const getFloatingPaymentByOrder = queryGeneric({
  handler: async (ctx, args: any) => {
    const rows = await ctx.db.query("floating_cash_payments").collect();
    return rows.find((r) => String(r.razorpay_order_id || "") === String(args.razorpay_order_id)) || null;
  },
});

export const applyFloatingPaymentSuccess = mutationGeneric({
  handler: async (ctx, args: any) => {
    const payment = await getByIdInternal(ctx, args.payment_id);
    if (!payment) throw new Error("Payment order not found.");
    const worker = await getByIdInternal(ctx, args.worker_id);
    if (!worker) throw new Error("Worker not found");
    if (String(payment.worker_id || "") !== String(worker._id)) throw new Error("Forbidden");
    if (String(payment.status || "") === "paid") return { already_processed: true, amount: Number(payment.amount || 0) };

    const now = nowIso();
    await ctx.db.patch(payment._id, {
      razorpay_payment_id: args.razorpay_payment_id,
      razorpay_signature: args.razorpay_signature,
      status: "paid",
      updated_at: now,
    });

    const amount = Number(payment.amount || 0);
    const previousFloater = Number(worker.floater_cash || 0);
    await ctx.db.patch(worker._id, {
      floater_cash: 0,
      last_cash_collection_at: now,
      status_locked: false,
      lock_reason: undefined,
      updated_at: now,
    });

    await ctx.db.insert("settlements", {
      service_request_id: undefined,
      worker_id: worker._id,
      settlement_date: now,
      customer_amount: amount,
      fuel_cost: 0,
      delivery_fee: 0,
      platform_service_fee: 0,
      surge_fee: 0,
      fuel_station_payout: 0,
      worker_payout: 0,
      platform_profit: amount,
      status: "collected",
      notes: `purpose=FLOATING_CASH_CLEAR; order_id=${args.razorpay_order_id}; payment_id=${args.razorpay_payment_id}; previous_floater=${previousFloater}`,
      created_at: now,
      updated_at: now,
    });
    return { success: true, amount, already_processed: false };
  },
});

export const getFuelStationAdminDetails = queryGeneric({
  handler: async (ctx, args: any) => {
    const stations = await ctx.db.query("fuel_stations").collect();
    let station =
      stations.find((s) => String(s._id) === String(args.id)) ||
      stations.find((s) => String(s.user_id || "") === String(args.id));
    if (!station) return null;

    const users = await ctx.db.query("users").collect();
    const linkedUser = users.find((u) => String(u._id) === String(station?.user_id || ""));
    const stocks = await ctx.db.query("fuel_station_stock").collect();
    const ledger = await ctx.db.query("fuel_station_ledger").collect();

    const stationStocks = stocks.filter((s) => String(s.fuel_station_id) === String(station?._id));
    const stocksObj: Record<string, number> = {};
    stationStocks.forEach((s) => {
      stocksObj[String(s.fuel_type)] = Number(s.stock_litres || 0);
    });

    const recent_ledger = ledger
      .filter((l) => String(l.fuel_station_id) === String(station?._id))
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
      .slice(0, 10);

    return {
      station: {
        ...station,
        id: station._id,
        linked_user_email: linkedUser?.email,
        linked_user_phone: linkedUser?.phone_number,
        stocks: stocksObj,
      },
      recent_ledger,
    };
  },
});

export const updateFuelStationAdmin = mutationGeneric({
  handler: async (ctx, args: any) => {
    const station = await getByIdInternal(ctx, args.id);
    if (!station) throw new Error("Fuel station not found");
    const patch: Record<string, any> = {};
    const fields = ["is_verified", "is_open", "cod_enabled", "cod_balance_limit", "platform_trust_flag"];
    for (const f of fields) {
      if (args[f] !== undefined) patch[f] = args[f];
    }
    if (args.cod_enabled !== undefined) patch.cod_supported = args.cod_enabled;
    patch.updated_at = nowIso();
    await ctx.db.patch(station._id, patch);

    if (args.sync_linked_user && station.user_id) {
      const stations = await ctx.db.query("fuel_stations").collect();
      for (const s of stations) {
        if (String(s._id) !== String(station._id) && String(s.user_id || "") === String(station.user_id)) {
          await ctx.db.patch(s._id, patch);
        }
      }
    }
    return { ok: true };
  },
});

export const setUserPassword = mutationGeneric({
  handler: async (ctx, args: any) => {
    const user = await getByIdInternal(ctx, args.user_id);
    if (!user) return { ok: false };
    await ctx.db.patch(user._id, { password: args.password, ...(args.email ? { email: args.email } : {}) });
    return { ok: true };
  },
});

export const deleteFuelStationDeep = mutationGeneric({
  handler: async (ctx, args: any) => {
    const station = await getByIdInternal(ctx, args.id);
    if (!station) throw new Error("Fuel station not found");

    const tablesToClean = [
      "fuel_station_bank_details",
      "fuel_station_stock",
      "fuel_station_ledger",
      "cod_settlements",
      "settlements",
      "fuel_station_assignments",
      "worker_station_cache",
    ] as const;

    for (const table of tablesToClean) {
      const rows = await (ctx.db.query(table as any) as any).collect();
      for (const r of rows) {
        if (String(r.fuel_station_id || "") === String(station._id)) {
          await ctx.db.delete(r._id);
        }
      }
    }

    await ctx.db.delete(station._id);
    return { ok: true, user_id: station.user_id };
  },
});

export const listPayments = queryGeneric({
  handler: async (ctx, args: any) => {
    const provider = args.provider;
    const status = args.status;
    const userId = args.user_id;
    const serviceRequestId = args.service_request_id;
    const startDate = args.start_date;
    const endDate = args.end_date;
    const limit = Number(args.limit || 50);
    const offset = Number(args.offset || 0);

    const payments = await ctx.db.query("payments").collect();
    const requests = await ctx.db.query("service_requests").collect();
    const users = await ctx.db.query("users").collect();
    const reqById = new Map(requests.map((r) => [String(r._id), r]));
    const userById = new Map(users.map((u) => [String(u._id), u]));

    const filtered = payments
      .filter((p) => (provider ? String(p.provider || "") === String(provider) : true))
      .filter((p) => (status ? String(p.status || "") === String(status) : true))
      .filter((p) => (serviceRequestId ? String(p.service_request_id || "") === String(serviceRequestId) : true))
      .filter((p) => {
        const req = reqById.get(String(p.service_request_id || ""));
        return userId ? String(req?.user_id || "") === String(userId) : true;
      })
      .filter((p) => (startDate ? String(p.created_at || "") >= String(startDate) : true))
      .filter((p) => (endDate ? String(p.created_at || "") <= String(endDate) : true))
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

    const total = filtered.length;
    const rows = filtered.slice(offset, offset + limit).map((p) => {
      const req = reqById.get(String(p.service_request_id || ""));
      const user = userById.get(String(req?.user_id || ""));
      return {
        ...p,
        id: p._id,
        user_id: req?.user_id,
        service_type: req?.service_type,
        service_request_amount: req?.amount,
        service_request_payment_method: req?.payment_method,
        service_request_payment_status: req?.payment_status,
        first_name: user?.first_name,
        last_name: user?.last_name,
        email: user?.email,
      };
    });

    return { payments: rows, total };
  },
});

export const reconcilePayment = mutationGeneric({
  handler: async (ctx, args: any) => {
    const payment = await getByIdInternal(ctx, args.payment_id);
    if (!payment) throw new Error("Payment not found");
    await ctx.db.patch(payment._id, { status: args.status, updated_at: nowIso() });
    return { ok: true };
  },
});

export const paymentSummary = queryGeneric({
  handler: async (ctx, args: any) => {
    const days = Number(args.days || 30);
    const start = new Date();
    start.setDate(start.getDate() - days);
    const startDate = start.toISOString().split("T")[0];
    const payments = (await ctx.db.query("payments").collect()).filter(
      (p) => String(p.created_at || "") >= startDate
    );

    const summary = {
      total_payments: payments.length,
      unique_orders: new Set(payments.map((p) => String(p.service_request_id || ""))).size,
      total_amount: payments.reduce((s, p) => s + Number(p.amount || 0), 0),
      avg_payment_amount: payments.length
        ? payments.reduce((s, p) => s + Number(p.amount || 0), 0) / payments.length
        : 0,
      online_payments: payments.filter((p) => p.provider === "razorpay").length,
      cod_payments: payments.filter((p) => p.provider === "cod").length,
      captured_amount: payments
        .filter((p) => p.status === "captured")
        .reduce((s, p) => s + Number(p.amount || 0), 0),
      failed_amount: payments.filter((p) => p.status === "failed").reduce((s, p) => s + Number(p.amount || 0), 0),
      pending_collection_amount: payments
        .filter((p) => p.status === "pending_collection")
        .reduce((s, p) => s + Number(p.amount || 0), 0),
    };

    const groupedProvider = new Map<string, any[]>();
    payments.forEach((p) => {
      const k = String(p.provider || "unknown");
      if (!groupedProvider.has(k)) groupedProvider.set(k, []);
      groupedProvider.get(k)!.push(p);
    });
    const provider_breakdown = Array.from(groupedProvider.entries())
      .map(([provider, rows]) => {
        const total_amount = rows.reduce((s, p) => s + Number(p.amount || 0), 0);
        const captured = rows.filter((p) => p.status === "captured");
        const failed = rows.filter((p) => p.status === "failed");
        return {
          provider,
          count: rows.length,
          total_amount,
          avg_amount: rows.length ? total_amount / rows.length : 0,
          captured_count: captured.length,
          captured_amount: captured.reduce((s, p) => s + Number(p.amount || 0), 0),
          failed_count: failed.length,
          success_rate_percentage: rows.length ? (captured.length / rows.length) * 100 : 0,
        };
      })
      .sort((a, b) => b.count - a.count);

    const groupedStatus = new Map<string, any[]>();
    payments.forEach((p) => {
      const k = String(p.status || "unknown");
      if (!groupedStatus.has(k)) groupedStatus.set(k, []);
      groupedStatus.get(k)!.push(p);
    });
    const status_breakdown = Array.from(groupedStatus.entries())
      .map(([status, rows]) => {
        const total_amount = rows.reduce((s, p) => s + Number(p.amount || 0), 0);
        return {
          status,
          count: rows.length,
          total_amount,
          avg_amount: rows.length ? total_amount / rows.length : 0,
        };
      })
      .sort((a, b) => b.count - a.count);

    const groupedDay = new Map<string, any[]>();
    payments.forEach((p) => {
      const day = String(p.created_at || "").slice(0, 10);
      if (!groupedDay.has(day)) groupedDay.set(day, []);
      groupedDay.get(day)!.push(p);
    });
    const daily_trend = Array.from(groupedDay.entries())
      .map(([date, rows]) => ({
        date,
        count: rows.length,
        total_amount: rows.reduce((s, p) => s + Number(p.amount || 0), 0),
        providers_used: new Set(rows.map((p) => String(p.provider || "unknown"))).size,
      }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));

    return {
      start_date: startDate,
      end_date: new Date().toISOString().split("T")[0],
      summary,
      provider_breakdown,
      status_breakdown,
      daily_trend,
    };
  },
});

export const listSettlements = queryGeneric({
  handler: async (ctx, args: any) => {
    const workerId = args.worker_id;
    const fuelStationId = args.fuel_station_id;
    const status = args.status;
    const startDate = args.start_date;
    const endDate = args.end_date;
    const limit = Number(args.limit || 50);
    const offset = Number(args.offset || 0);

    const settlements = await ctx.db.query("settlements").collect();
    const workers = await ctx.db.query("workers").collect();
    const stations = await ctx.db.query("fuel_stations").collect();
    const requests = await ctx.db.query("service_requests").collect();
    const workerById = new Map(workers.map((w) => [String(w._id), w]));
    const stationById = new Map(stations.map((s) => [String(s._id), s]));
    const reqById = new Map(requests.map((r) => [String(r._id), r]));

    const filtered = settlements
      .filter((s) => (workerId ? String(s.worker_id || "") === String(workerId) : true))
      .filter((s) => (fuelStationId ? String(s.fuel_station_id || "") === String(fuelStationId) : true))
      .filter((s) => (status ? String(s.status || "") === String(status) : true))
      .filter((s) => (startDate ? String(s.settlement_date || "") >= String(startDate) : true))
      .filter((s) => (endDate ? String(s.settlement_date || "") <= String(endDate) : true))
      .sort((a, b) => String(b.settlement_date || "").localeCompare(String(a.settlement_date || "")));

    const total = filtered.length;
    const rows = filtered.slice(offset, offset + limit).map((s) => {
      const worker = workerById.get(String(s.worker_id || ""));
      const station = stationById.get(String(s.fuel_station_id || ""));
      const req = reqById.get(String(s.service_request_id || ""));
      return {
        ...s,
        id: s._id,
        worker_first_name: worker?.first_name,
        worker_last_name: worker?.last_name,
        worker_email: worker?.email,
        fuel_station_name: station?.station_name || station?.name,
        request_status: req?.status,
        customer_id: req?.user_id,
      };
    });
    return { settlements: rows, total };
  },
});

export const reconcileSettlement = mutationGeneric({
  handler: async (ctx, args: any) => {
    const row = await getByIdInternal(ctx, args.settlement_id);
    if (!row) throw new Error("Settlement not found");
    await ctx.db.patch(row._id, {
      status: "reconciled",
      notes: args.notes || undefined,
      updated_at: nowIso(),
    });
    return { ok: true };
  },
});

export const settlementSummary = queryGeneric({
  handler: async (ctx, args: any) => {
    const days = Number(args.days || 30);
    const start = new Date();
    start.setDate(start.getDate() - days);
    const startDate = start.toISOString().split("T")[0];

    const settlements = (await ctx.db.query("settlements").collect()).filter(
      (s) => String(s.settlement_date || "") >= startDate
    );
    const workers = await ctx.db.query("workers").collect();
    const stations = await ctx.db.query("fuel_stations").collect();
    const workerById = new Map(workers.map((w) => [String(w._id), w]));
    const stationById = new Map(stations.map((s) => [String(s._id), s]));

    const totalCustomerAmount = settlements.reduce((s, r) => s + Number(r.customer_amount || 0), 0);
    const summary = {
      total_settlements: settlements.length,
      total_workers: new Set(settlements.map((s) => String(s.worker_id || ""))).size,
      total_fuel_stations: new Set(settlements.map((s) => String(s.fuel_station_id || ""))).size,
      total_customer_amount: totalCustomerAmount,
      total_fuel_station_payout: settlements.reduce((s, r) => s + Number(r.fuel_station_payout || 0), 0),
      total_worker_payout: settlements.reduce((s, r) => s + Number(r.worker_payout || 0), 0),
      total_platform_profit: settlements.reduce((s, r) => s + Number(r.platform_profit || 0), 0),
      avg_platform_profit: settlements.length
        ? settlements.reduce((s, r) => s + Number(r.platform_profit || 0), 0) / settlements.length
        : 0,
      min_platform_profit: settlements.length
        ? Math.min(...settlements.map((r) => Number(r.platform_profit || 0)))
        : 0,
      max_platform_profit: settlements.length
        ? Math.max(...settlements.map((r) => Number(r.platform_profit || 0)))
        : 0,
      avg_profit_margin_percentage: totalCustomerAmount
        ? (settlements.reduce((s, r) => s + Number(r.platform_profit || 0), 0) / totalCustomerAmount) * 100
        : 0,
    };

    const groupedWorker = new Map<string, any[]>();
    settlements.forEach((s) => {
      const k = String(s.worker_id || "");
      if (!k) return;
      if (!groupedWorker.has(k)) groupedWorker.set(k, []);
      groupedWorker.get(k)!.push(s);
    });
    const worker_summary = Array.from(groupedWorker.entries())
      .map(([worker_id, rows]) => {
        const worker = workerById.get(worker_id);
        const total_earnings = rows.reduce((sum, r) => sum + Number(r.worker_payout || 0), 0);
        return {
          id: worker_id,
          first_name: worker?.first_name,
          last_name: worker?.last_name,
          deliveries: rows.length,
          total_earnings,
          avg_per_delivery: rows.length ? total_earnings / rows.length : 0,
          base_pay_total: rows.reduce((sum, r) => sum + Number(r.worker_base_pay || 0), 0),
          distance_pay_total: rows.reduce((sum, r) => sum + Number(r.worker_distance_pay || 0), 0),
          surge_bonus_total: rows.reduce((sum, r) => sum + Number(r.worker_surge_bonus || 0), 0),
          incentive_bonus_total: rows.reduce((sum, r) => sum + Number(r.worker_incentive_bonus || 0), 0),
        };
      })
      .sort((a, b) => b.total_earnings - a.total_earnings);

    const groupedStation = new Map<string, any[]>();
    settlements.forEach((s) => {
      const k = String(s.fuel_station_id || "");
      if (!k) return;
      if (!groupedStation.has(k)) groupedStation.set(k, []);
      groupedStation.get(k)!.push(s);
    });
    const fuel_station_summary = Array.from(groupedStation.entries())
      .map(([fuel_station_id, rows]) => {
        const station = stationById.get(fuel_station_id);
        return {
          id: fuel_station_id,
          name: station?.station_name || station?.name,
          orders: rows.length,
          total_payout: rows.reduce((sum, r) => sum + Number(r.fuel_station_payout || 0), 0),
          avg_fuel_cost: rows.length
            ? rows.reduce((sum, r) => sum + Number(r.fuel_cost || 0), 0) / rows.length
            : 0,
          total_customer_amount: rows.reduce((sum, r) => sum + Number(r.customer_amount || 0), 0),
        };
      })
      .sort((a, b) => b.total_payout - a.total_payout);

    return {
      start_date: startDate,
      end_date: new Date().toISOString().split("T")[0],
      summary,
      worker_summary,
      fuel_station_summary,
    };
  },
});

export const getFinancialsByWorker = queryGeneric({
  handler: async (ctx, args: any) => {
    const startDate = args.startDate;
    if (!startDate) {
      return [];
    }

    // This query is most efficient with a database index on ["status", "completed_at"]
    const completedPaidRequests = await ctx.db
      .query("service_requests")
      // Assuming an index on 'status' exists for performance.
      .withIndex("by_status", (q) => q.eq("status", "Completed"))
      .filter((q) =>
        q.and(
          q.eq(q.field("payment_status"), "PAID"),
          q.gte(q.field("completed_at"), startDate)
        )
      )
      .collect();

    const financialsByWorker = new Map<string, { worker_id: string; online_earnings: number; cod_earnings: number }>();

    for (const req of completedPaidRequests) {
      if (!req.assigned_worker) continue;

      const workerId = req.assigned_worker.toString();
      const current = financialsByWorker.get(workerId) || {
        worker_id: workerId,
        online_earnings: 0,
        cod_earnings: 0,
      };

      const amount = Number(req.amount || 0);
      if (String(req.payment_method || "").toUpperCase() === "ONLINE") {
        current.online_earnings += amount;
      } else if (String(req.payment_method || "").toUpperCase() === "COD") {
        current.cod_earnings += amount;
      }

      financialsByWorker.set(workerId, current);
    }

    return Array.from(financialsByWorker.values());
  },
});
