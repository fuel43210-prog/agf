import { mutationGeneric, queryGeneric } from "convex/server";

const nowIso = () => new Date().toISOString();

function eqId(a: any, b: any) {
  return String(a || "") === String(b || "");
}

export const resolveStation = queryGeneric({
  handler: async (ctx, args: any) => {
    const stations = await ctx.db.query("fuel_stations").collect();

    if (args?.fuel_station_id) {
      const direct = stations.find((s) => eqId(s._id, args.fuel_station_id));
      if (direct) return { ...direct, id: direct._id };
    }

    if (args?.user_id) {
      const byStationId = stations.find((s) => eqId(s._id, args.user_id));
      if (byStationId) return { ...byStationId, id: byStationId._id };
      const byUserRef = stations.find((s) => eqId(s.user_id, args.user_id));
      if (byUserRef) return { ...byUserRef, id: byUserRef._id };
    }

    if (args?.email) {
      const email = String(args.email).toLowerCase();
      const byStationEmail = stations.find((s) => String(s.email || "").toLowerCase() === email);
      if (byStationEmail) return { ...byStationEmail, id: byStationEmail._id };

      const user = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .first();
      if (user) {
        const byLinkedUser = stations.find((s) => eqId(s.user_id, user._id));
        if (byLinkedUser) return { ...byLinkedUser, id: byLinkedUser._id };
      }
    }

    return null;
  },
});

export const getStocks = queryGeneric({
  handler: async (ctx, args: any) => {
    const stationId = args?.fuel_station_id;
    const rows = await ctx.db.query("fuel_station_stock").collect();
    return rows
      .filter((r) => eqId(r.fuel_station_id, stationId))
      .sort((a, b) => String(a.fuel_type || "").localeCompare(String(b.fuel_type || "")));
  },
});

export const upsertStock = mutationGeneric({
  handler: async (ctx, args: any) => {
    const stationId = args?.fuel_station_id;
    const fuelType = String(args?.fuel_type || "").toLowerCase();
    const stockLitres = Number(args?.stock_litres || 0);
    const now = nowIso();

    const rows = await ctx.db.query("fuel_station_stock").collect();
    const existing = rows.find((r) => eqId(r.fuel_station_id, stationId) && r.fuel_type === fuelType);

    if (existing) {
      await ctx.db.patch(existing._id, {
        stock_litres: stockLitres,
        last_refilled_at: now,
        updated_at: now,
      });
    } else {
      await ctx.db.insert("fuel_station_stock", {
        fuel_station_id: stationId,
        fuel_type: fuelType,
        stock_litres: stockLitres,
        last_refilled_at: now,
        created_at: now,
        updated_at: now,
      });
    }

    return { ok: true, updated_at: now };
  },
});

export const decreaseStock = mutationGeneric({
  handler: async (ctx, args: any) => {
    const stationId = args?.fuel_station_id;
    const fuelType = String(args?.fuel_type || "").toLowerCase();
    const litres = Number(args?.litres_picked_up || 0);
    const now = nowIso();

    const rows = await ctx.db.query("fuel_station_stock").collect();
    const existing = rows.find((r) => eqId(r.fuel_station_id, stationId) && r.fuel_type === fuelType);
    if (!existing) {
      throw new Error(`Stock record for ${fuelType} not found`);
    }
    const current = Number(existing.stock_litres || 0);
    if (current < litres) {
      throw new Error(`Insufficient stock. Available: ${current}L, Requested: ${litres}L`);
    }
    const remaining = current - litres;
    await ctx.db.patch(existing._id, { stock_litres: remaining, updated_at: now });
    return { ok: true, remaining_stock: remaining, updated_at: now };
  },
});

export const addLedgerEntry = mutationGeneric({
  handler: async (ctx, args: any) => {
    const now = nowIso();
    const id = await ctx.db.insert("fuel_station_ledger", {
      fuel_station_id: args.fuel_station_id,
      settlement_id: args.settlement_id || undefined,
      transaction_type: args.transaction_type || "stock_update",
      amount: Number(args.amount || 0),
      description: args.description || "",
      running_balance: args.running_balance ?? undefined,
      status: args.status || "completed",
      reference_id: args.reference_id || undefined,
      created_at: now,
      updated_at: now,
    });
    return { id };
  },
});

export const listLedger = queryGeneric({
  handler: async (ctx, args: any) => {
    const stationId = args?.fuel_station_id;
    const limit = Number(args?.limit || 50);
    const offset = Number(args?.offset || 0);
    const rows = await ctx.db.query("fuel_station_ledger").collect();
    const filtered = rows
      .filter((r) => eqId(r.fuel_station_id, stationId))
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    return filtered.slice(offset, offset + limit);
  },
});

export const listCodSettlements = queryGeneric({
  handler: async (ctx, args: any) => {
    const stationId = args?.fuel_station_id;
    const limit = Number(args?.limit || 20);
    const rows = await ctx.db.query("cod_settlements").collect();
    return rows
      .filter((r) => eqId(r.fuel_station_id, stationId))
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
      .slice(0, limit);
  },
});

export const getEarningsSummary = queryGeneric({
  handler: async (ctx, args: any) => {
    const stationId = args?.fuel_station_id;
    const rows = await ctx.db.query("fuel_station_ledger").collect();
    const filtered = rows.filter((r) => eqId(r.fuel_station_id, stationId));
    const saleRows = filtered.filter((r) =>
      ["sale", "cod_settlement"].includes(String(r.transaction_type || ""))
    );

    let completed = 0;
    let settled = 0;
    let pending = 0;
    for (const r of saleRows) {
      const amount = Number(r.amount || 0);
      const status = String(r.status || "").toLowerCase();
      if (status === "completed") completed += amount;
      if (status === "settled") settled += amount;
      if (status === "pending") pending += amount;
    }

    return {
      total_transactions: saleRows.length,
      completed_earnings: completed,
      settled_earnings: settled,
      pending_earnings: pending,
    };
  },
});

export const getPendingCodSummary = queryGeneric({
  handler: async (ctx, args: any) => {
    const stationId = args?.fuel_station_id;
    const rows = await ctx.db.query("service_requests").collect();
    const pending = rows.filter(
      (r) =>
        eqId(r.fuel_station_id, stationId) &&
        String(r.payment_method || "").toUpperCase() === "COD" &&
        String(r.payment_status || "").toUpperCase() === "PENDING_COLLECTION"
    );
    return {
      count: pending.length,
      total_pending: pending.reduce((sum, r) => sum + Number(r.amount || 0), 0),
    };
  },
});

export const getBankDetails = queryGeneric({
  handler: async (ctx, args: any) => {
    const stationId = args?.fuel_station_id;
    const rows = await ctx.db.query("fuel_station_bank_details").collect();
    return rows.find((r) => eqId(r.fuel_station_id, stationId)) || null;
  },
});

export const upsertBankDetails = mutationGeneric({
  handler: async (ctx, args: any) => {
    const stationId = args?.fuel_station_id;
    const rows = await ctx.db.query("fuel_station_bank_details").collect();
    const existing = rows.find((r) => eqId(r.fuel_station_id, stationId));
    const now = nowIso();

    if (existing) {
      await ctx.db.patch(existing._id, {
        account_holder_name: args.account_holder_name,
        account_number: args.account_number,
        ifsc_code: args.ifsc_code,
        bank_name: args.bank_name,
        razorpay_fund_account_id: undefined,
        updated_at: now,
      });
      return { ok: true };
    }

    await ctx.db.insert("fuel_station_bank_details", {
      fuel_station_id: stationId,
      account_holder_name: args.account_holder_name,
      account_number: args.account_number,
      ifsc_code: args.ifsc_code,
      bank_name: args.bank_name,
      created_at: now,
      updated_at: now,
    });
    return { ok: true };
  },
});
