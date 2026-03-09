import { mutationGeneric, queryGeneric } from "convex/server";

const nowIso = () => new Date().toISOString();

function eqId(a: any, b: any) {
  if (!a || !b) return false;
  return String(a) === String(b);
}

const getByIdInternal = async (ctx: any, id: any) => {
  if (!id || String(id) === "undefined") return null;
  const normalizedId = ctx.db.normalizeId("fuel_stations", id);
  if (!normalizedId) return null;
  try {
    return await ctx.db.get(normalizedId);
  } catch {
    return null;
  }
};

const sanitizeIdInternal = (ctx: any, id: any, table: string = "fuel_stations") => {
  if (!id || String(id) === "undefined") return undefined;
  return ctx.db.normalizeId(table, id) || undefined;
};

export const resolveStation = queryGeneric({
  handler: async (ctx, args: any) => {
    // 1. Try resolving by station ID directly
    const stationId = args?.fuel_station_id;
    if (stationId) {
      const normalized = ctx.db.normalizeId("fuel_stations", stationId);
      if (normalized) {
        const direct = await ctx.db.get(normalized);
        if (direct) return { ...direct, id: direct._id };
      }
    }

    // 2. Try resolving by user ID or user-linked ID
    const userId = args?.user_id || args?.fuel_station_id;
    if (userId) {
      // It might be a user ID
      const normalizedUser = ctx.db.normalizeId("users", userId);
      if (normalizedUser) {
        const byUser = await ctx.db
          .query("fuel_stations")
          .withIndex("by_user_id", (q: any) => q.eq("user_id", normalizedUser))
          .first();
        if (byUser) return { ...byUser, id: byUser._id };
      }

      // Or it might be a fuel_station ID that wasn't normalized in the previous step
      const normalizedStation = ctx.db.normalizeId("fuel_stations", userId);
      if (normalizedStation) {
        const byStation = await ctx.db.get(normalizedStation);
        if (byStation) return { ...byStation, id: byStation._id };
      }
    }

    // 3. Try resolving by email
    const email = args?.email ? String(args.email).toLowerCase() : null;
    if (email) {
      const byEmail = await ctx.db
        .query("fuel_stations")
        .withIndex("by_email", (q: any) => q.eq("email", email))
        .first();
      if (byEmail) return { ...byEmail, id: byEmail._id };

      const user = await ctx.db
        .query("users")
        .withIndex("by_email", (q: any) => q.eq("email", email))
        .first();
      if (user) {
        const byUser = await ctx.db
          .query("fuel_stations")
          .withIndex("by_user_id", (q: any) => q.eq("user_id", user._id))
          .first();
        if (byUser) return { ...byUser, id: byUser._id };
      }
    }

    return null;
  },
});

export const getStocks = queryGeneric({
  handler: async (ctx, args: any) => {
    const stationId = args?.fuel_station_id;
    if (!stationId) return [];

    const normalized = ctx.db.normalizeId("fuel_stations", stationId);
    if (!normalized) return [];

    const rows = await ctx.db
      .query("fuel_station_stock")
      .withIndex("by_fuel_station_id", (q: any) => q.eq("fuel_station_id", normalized))
      .collect();
    return rows
      .sort((a, b) => String(a.fuel_type || "").localeCompare(String(b.fuel_type || "")))
      .map((r) => ({ ...r, id: r._id }));
  },
});

export const upsertStock = mutationGeneric({
  handler: async (ctx, args: any) => {
    const stationId = args?.fuel_station_id;
    const normalized = ctx.db.normalizeId("fuel_stations", stationId);
    if (!normalized) throw new Error("Invalid fuel station ID");

    const fuelType = String(args?.fuel_type || "").toLowerCase();
    const stockLitres = Number(args?.stock_litres || 0);
    const now = nowIso();

    const existing = await ctx.db
      .query("fuel_station_stock")
      .withIndex("by_fuel_station_id", (q: any) => q.eq("fuel_station_id", normalized))
      .filter((q) => q.eq(q.field("fuel_type"), fuelType))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        stock_litres: stockLitres,
        last_refilled_at: now,
        updated_at: now,
      });
    } else {
      await ctx.db.insert("fuel_station_stock", {
        fuel_station_id: normalized,
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
    const normalized = ctx.db.normalizeId("fuel_stations", stationId);
    if (!normalized) throw new Error("Invalid fuel station ID");

    const fuelType = String(args?.fuel_type || "").toLowerCase();
    const litres = Number(args?.litres_picked_up || 0);
    const now = nowIso();

    const existing = await ctx.db
      .query("fuel_station_stock")
      .withIndex("by_fuel_station_id", (q: any) => q.eq("fuel_station_id", normalized))
      .filter((q) => q.eq(q.field("fuel_type"), fuelType))
      .first();

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
    return filtered.slice(offset, offset + limit).map((r) => ({ ...r, id: r._id }));
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
      .slice(0, limit)
      .map((r) => ({ ...r, id: r._id }));
  },
});

export const getEarningsSummary = queryGeneric({
  handler: async (ctx, args: any) => {
    const stationId = args?.fuel_station_id;
    if (!stationId) return null;

    const normalized = ctx.db.normalizeId("fuel_stations", stationId);
    if (!normalized) return null;

    const rows = await ctx.db
      .query("fuel_station_ledger")
      .withIndex("by_fuel_station_id", (q: any) => q.eq("fuel_station_id", normalized))
      .collect();

    const saleRows = rows.filter((r) =>
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

export const listPendingPayoutLedger = queryGeneric({
  handler: async (ctx, args: any) => {
    const fuelStationId = args?.fuel_station_id;
    const status = args?.status ? String(args.status) : "pending";
    const limit = Number(args?.limit || 50);
    const offset = Number(args?.offset || 0);

    const ledger = await ctx.db.query("fuel_station_ledger").collect();
    const stations = await ctx.db.query("fuel_stations").collect();
    const stationById = new Map(stations.map((s) => [String(s._id), s]));

    const rows = ledger
      .filter((l) =>
        ["sale", "cod_settlement"].includes(String(l.transaction_type || ""))
      )
      .filter((l) => (fuelStationId ? eqId(l.fuel_station_id, fuelStationId) : true))
      .filter((l) => (status ? String(l.status || "pending") === status : true))
      .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));

    return rows.slice(offset, offset + limit).map((l) => {
      const station = stationById.get(String(l.fuel_station_id));
      return {
        id: l._id,
        fuel_station_id: l.fuel_station_id,
        transaction_type: l.transaction_type || "sale",
        amount: Number(l.amount || 0),
        description: l.description || "",
        status: l.status || "pending",
        created_at: l.created_at,
        station_name: station?.station_name || (station as any)?.name || null,
        email: station?.email || null,
      };
    });
  },
});

export const getStationPayoutContext = queryGeneric({
  handler: async (ctx, args: any) => {
    const station = await getByIdInternal(ctx, args.fuel_station_id);
    if (!station) return null;
    const rows = await ctx.db.query("fuel_station_bank_details").collect();
    const bank = rows.find((r) => eqId(r.fuel_station_id, station._id)) || null;
    return { station, bank };
  },
});

export const ensureStationPendingLedger = mutationGeneric({
  handler: async (ctx, args: any) => {
    const station = await getByIdInternal(ctx, args.fuel_station_id);
    if (!station) throw new Error("Fuel station not found");
    const now = nowIso();
    const ledger = await ctx.db.query("fuel_station_ledger").collect();
    const pending = ledger.filter(
      (l) =>
        eqId(l.fuel_station_id, station._id) &&
        String(l.status || "") === "pending" &&
        ["sale", "cod_settlement"].includes(String(l.transaction_type || ""))
    );
    if (pending.length > 0) {
      return { created: false, pending_count: pending.length };
    }
    const carryAmount = Number(station.pending_payout || 0);
    if (carryAmount <= 0) {
      return { created: false, pending_count: 0 };
    }
    await ctx.db.insert("fuel_station_ledger", {
      fuel_station_id: station._id,
      transaction_type: "cod_settlement",
      amount: carryAmount,
      description: "Auto-generated pending payout entry",
      status: "pending",
      reference_id: `AUTO_CARRY_${String(station._id)}_${Date.now()}`,
      created_at: now,
      updated_at: now,
    });
    return { created: true, pending_count: 1 };
  },
});

export const saveStationPayoutRefs = mutationGeneric({
  handler: async (ctx, args: any) => {
    const rows = await ctx.db.query("fuel_station_bank_details").collect();
    const bank = rows.find((r) => eqId(r.fuel_station_id, args.fuel_station_id));
    if (!bank) {
      throw new Error("Fuel station bank details not found");
    }
    await ctx.db.patch(bank._id, {
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

export const settleStationPayoutByLedgerIds = mutationGeneric({
  handler: async (ctx, args: any) => {
    const station = await getByIdInternal(ctx, args.fuel_station_id);
    if (!station) throw new Error("Fuel station not found");
    const requested = new Set((args.ledger_ids || []).map((id: any) => String(id)));
    if (requested.size === 0) throw new Error("No ledger ids provided");

    const now = nowIso();
    const ledger = await ctx.db.query("fuel_station_ledger").collect();
    const rows = ledger.filter(
      (l) =>
        requested.has(String(l._id)) &&
        eqId(l.fuel_station_id, station._id) &&
        String(l.status || "pending") === "pending" &&
        ["sale", "cod_settlement"].includes(String(l.transaction_type || ""))
    );
    const amountToSettle = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const countToSettle = rows.length;
    if (amountToSettle <= 0 || countToSettle === 0) {
      return { ok: false, amount: 0, count: 0 };
    }

    for (const row of rows) {
      await ctx.db.patch(row._id, { status: "settled", updated_at: now });
    }

    await ctx.db.patch(station._id, {
      pending_payout: Math.max(0, Number(station.pending_payout || 0) - amountToSettle),
      updated_at: now,
    });

    await ctx.db.insert("fuel_station_ledger", {
      fuel_station_id: station._id,
      transaction_type: "payout",
      amount: -amountToSettle,
      description: `Payout for ${countToSettle} transactions`,
      status: "settled",
      created_at: now,
      updated_at: now,
    });

    return { ok: true, amount: amountToSettle, count: countToSettle };
  },
});

export const listStationsWithPendingPayouts = queryGeneric({
  handler: async (ctx, args: any) => {
    const requestedStationId = args?.fuel_station_id;
    const stations = await ctx.db.query("fuel_stations").collect();
    const banks = await ctx.db.query("fuel_station_bank_details").collect();
    const ledger = await ctx.db.query("fuel_station_ledger").collect();
    const bankByStation = new Map(banks.map((b) => [String(b.fuel_station_id), b]));

    const withPending = stations
      .filter((s) => (requestedStationId ? eqId(s._id, requestedStationId) : true))
      .filter((s) =>
        ledger.some(
          (l) =>
            eqId(l.fuel_station_id, s._id) &&
            String(l.status || "") === "pending" &&
            ["sale", "cod_settlement"].includes(String(l.transaction_type || ""))
        )
      )
      .map((s) => {
        const bank = bankByStation.get(String(s._id));
        return {
          id: s._id,
          station_name: s.station_name || (s as any).name || "",
          email: s.email || "",
          phone_number: s.phone_number || "",
          pending_payout: Number(s.pending_payout || 0),
          account_holder_name: bank?.account_holder_name || "",
          account_number: bank?.account_number || "",
          ifsc_code: bank?.ifsc_code || "",
          bank_name: bank?.bank_name || "",
          razorpay_contact_id: bank?.razorpay_contact_id || "",
          razorpay_fund_account_id: bank?.razorpay_fund_account_id || "",
        };
      });

    return withPending;
  },
});

export const listStationPendingEarnings = queryGeneric({
  handler: async (ctx, args: any) => {
    const fuelStationId = args.fuel_station_id;
    const rows = await ctx.db.query("fuel_station_ledger").collect();
    return rows
      .filter(
        (l) =>
          eqId(l.fuel_station_id, fuelStationId) &&
          String(l.status || "") === "pending" &&
          ["sale", "cod_settlement"].includes(String(l.transaction_type || ""))
      )
      .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))
      .map((l) => ({ id: l._id, amount: Number(l.amount || 0) }));
  },
});

export const settleStationPayoutBatch = mutationGeneric({
  handler: async (ctx, args: any) => {
    const station = await getByIdInternal(ctx, args.fuel_station_id);
    if (!station) throw new Error("Fuel station not found");
    const now = nowIso();
    const ledgerIds = new Set((args.ledger_ids || []).map((id: any) => String(id)));
    const amountToSettle = Number(args.amount || 0);
    const count = Number(args.count || 0);

    const ledger = await ctx.db.query("fuel_station_ledger").collect();
    const rows = ledger.filter(
      (l) =>
        ledgerIds.has(String(l._id)) &&
        eqId(l.fuel_station_id, station._id) &&
        String(l.status || "") === "pending" &&
        ["sale", "cod_settlement"].includes(String(l.transaction_type || ""))
    );

    for (const row of rows) {
      await ctx.db.patch(row._id, { status: "settled", updated_at: now });
    }

    await ctx.db.patch(station._id, {
      pending_payout: Math.max(0, Number(station.pending_payout || 0) - amountToSettle),
      updated_at: now,
    });

    await ctx.db.insert("fuel_station_ledger", {
      fuel_station_id: station._id,
      transaction_type: "payout",
      amount: -amountToSettle,
      description: `Payout for ${count} transactions`,
      status: "settled",
      reference_id: args.reference_id || undefined,
      created_at: now,
      updated_at: now,
    });
    return { ok: true };
  },
});

export const listStationsWithStock = queryGeneric({
  handler: async (ctx, args: any) => {
    const fuelType = String(args?.fuel_type || "").toLowerCase();
    const litres = Number(args?.litres || 0);
    const excludedStationId = args?.excluded_station_id;

    const stations = await ctx.db.query("fuel_stations").collect();
    const stocks = await ctx.db.query("fuel_station_stock").collect();

    const result = stations
      .filter((s) => (excludedStationId ? !eqId(s._id, excludedStationId) : true))
      .map((s) => {
        const stockRow = stocks.find(
          (st) => eqId(st.fuel_station_id, s._id) && String(st.fuel_type || "").toLowerCase() === fuelType
        );
        const available = Number(stockRow?.stock_litres || 0);
        return {
          id: s._id,
          station_name: s.station_name || (s as any).name || "",
          latitude: s.latitude,
          longitude: s.longitude,
          cod_supported: Boolean(s.cod_supported ?? s.cod_enabled ?? true),
          cod_enabled: Boolean(s.cod_enabled ?? true),
          platform_trust_flag: Boolean(s.platform_trust_flag ?? true),
          cod_current_balance: Number(s.cod_current_balance || 0),
          cod_balance_limit: Number(s.cod_balance_limit || 50000),
          is_open: Boolean(s.is_open ?? true),
          is_verified: Boolean(s.is_verified ?? true),
          available_stock: available,
          has_fuel: available >= litres,
        };
      });

    return result;
  },
});

export const getLatestValidCache = queryGeneric({
  handler: async (ctx, args: any) => {
    const rows = await ctx.db.query("worker_station_cache").collect();
    const match = rows
      .filter(
        (r) =>
          eqId(r.worker_id, args.worker_id) &&
          eqId(r.service_request_id, args.service_request_id) &&
          Boolean(r.is_valid)
      )
      .sort((a, b) => String(b.assigned_at || "").localeCompare(String(a.assigned_at || "")))[0];
    return match || null;
  },
});

export const invalidateCacheForServiceRequest = mutationGeneric({
  handler: async (ctx, args: any) => {
    const now = nowIso();
    const rows = await ctx.db.query("worker_station_cache").collect();
    for (const row of rows) {
      if (eqId(row.service_request_id, args.service_request_id) && Boolean(row.is_valid)) {
        await ctx.db.patch(row._id, { is_valid: false, invalidated_at: now });
      }
    }
    return { ok: true };
  },
});

export const createAssignmentAndCache = mutationGeneric({
  handler: async (ctx, args: any) => {
    const now = nowIso();
    await ctx.db.insert("fuel_station_assignments", {
      service_request_id: sanitizeIdInternal(ctx, args.service_request_id, "service_requests"),
      worker_id: sanitizeIdInternal(ctx, args.worker_id, "workers"),
      fuel_station_id: sanitizeIdInternal(ctx, args.fuel_station_id, "fuel_stations"),
      fuel_type: args.fuel_type,
      litres: Number(args.litres || 0),
      distance_km: Number(args.distance_km || 0),
      is_cod: Boolean(args.is_cod),
      supports_cod: Boolean(args.supports_cod),
      assigned_at: now,
      status: "assigned",
      created_at: now,
      updated_at: now,
    });
    await ctx.db.insert("worker_station_cache", {
      worker_id: sanitizeIdInternal(ctx, args.worker_id, "workers"),
      service_request_id: sanitizeIdInternal(ctx, args.service_request_id, "service_requests"),
      fuel_station_id: sanitizeIdInternal(ctx, args.fuel_station_id, "fuel_stations"),
      worker_lat: Number(args.worker_lat),
      worker_lng: Number(args.worker_lng),
      distance_km: Number(args.distance_km || 0),
      assigned_at: now,
      is_valid: true,
    });
    return { ok: true, assigned_at: now };
  },
});

export const getLatestAssignmentByServiceRequest = queryGeneric({
  handler: async (ctx, args: any) => {
    const assignments = await ctx.db.query("fuel_station_assignments").collect();
    const stations = await ctx.db.query("fuel_stations").collect();
    const byStation = new Map(stations.map((s) => [String(s._id), s]));
    const row = assignments
      .filter((a) => eqId(a.service_request_id, args.service_request_id))
      .sort((a, b) => String(b.assigned_at || "").localeCompare(String(a.assigned_at || "")))[0];
    if (!row) return null;
    const station = byStation.get(String(row.fuel_station_id));
    return {
      ...row,
      station_name: station?.station_name || (station as any)?.name || null,
      lat: station?.latitude ?? null,
      lng: station?.longitude ?? null,
      cod_supported: Boolean(station?.cod_supported ?? true),
    };
  },
});
