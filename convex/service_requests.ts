import { mutationGeneric, queryGeneric } from "convex/server";
import { ConvexError } from "convex/values";

const nowIso = () => new Date().toISOString();

export const create = mutationGeneric({
  handler: async (ctx, args: any) => {
    const id = await ctx.db.insert("service_requests", {
      user_id: args.user_id || undefined,
      vehicle_number: args.vehicle_number,
      driving_licence: args.driving_licence,
      phone_number: args.phone_number,
      service_type: args.service_type,
      amount: Number(args.amount),
      status: args.status || "Pending",
      fuel_station_id: args.fuel_station_id || undefined,
      payment_method: args.payment_method || "ONLINE",
      payment_status: args.payment_status || "PAID",
      payment_id: args.payment_id || undefined,
      payment_details: args.payment_details || undefined,
      litres: args.litres ?? undefined,
      fuel_price: args.fuel_price ?? undefined,
      user_lat: args.user_lat ?? undefined,
      user_lon: args.user_lon ?? undefined,
      created_at: nowIso(),
    });

    await ctx.db.insert("activity_log", {
      type: "service_request_created",
      message: `New ${args.service_type} request #${id} for ${args.vehicle_number}`,
      entity_type: "service_requests",
      entity_id: String(id),
      created_at: nowIso(),
    });

    return { id };
  },
});

export const list = queryGeneric({
  handler: async (ctx, args: any) => {
    const all = await ctx.db.query("service_requests").collect();

    const filtered = all
      .filter((r) => (args.status ? r.status === args.status : true))
      .filter((r) => (args.user_id ? String(r.user_id || "") === String(args.user_id) : true))
      .filter((r) =>
        args.assigned_worker ? String(r.assigned_worker || "") === String(args.assigned_worker) : true
      )
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

    // Enrich with fuel station details if present
    return await Promise.all(
      filtered.map(async (r) => {
        let stationInfo = {};
        if (r.fuel_station_id) {
          const station = await ctx.db.get(r.fuel_station_id);
          if (station) {
            stationInfo = {
              fuel_station_name: station.station_name,
              fuel_station_lat: station.latitude,
              fuel_station_lon: station.longitude,
            };
          }
        }
        return { ...r, id: r._id, ...stationInfo };
      })
    );
  },
});

const getByIdInternal = async (ctx: any, id: any) => {
  if (!id || String(id) === "undefined") return null;
  try {
    return await ctx.db.get(id as any);
  } catch {
    return null;
  }
};

const sanitizeIdInternal = (ctx: any, tableName: string, id: any) => {
  if (!id || String(id) === "undefined") return undefined;
  const normalized = ctx.db.normalizeId(tableName, id);
  if (!normalized) {
    throw new ConvexError(`Invalid ID format for table '${tableName}': ${id}`);
  }
  return normalized;
};

const getLatestFuelAssignmentForRequest = async (ctx: any, requestId: any) => {
  if (!requestId || String(requestId) === "undefined") return null;
  const assignments = await ctx.db.query("fuel_station_assignments").collect();
  return (
    assignments
      .filter((a: any) => String(a.service_request_id) === String(requestId))
      .sort((a: any, b: any) => String(b.assigned_at || "").localeCompare(String(a.assigned_at || "")))[0] || null
  );
};

const deductStationStockOnce = async (
  ctx: any,
  args: {
    fuel_station_id: any;
    fuel_type: string;
    litres: number;
    reference_id: any;
  }
) => {
  const stationId = args.fuel_station_id;
  const fuelType = String(args.fuel_type || "").toLowerCase();
  const litres = Number(args.litres || 0);
  const referenceId = args.reference_id;

  if (!stationId) return { ok: false, skipped: true, reason: "missing_station" };
  if (!(fuelType === "petrol" || fuelType === "diesel")) {
    return { ok: false, skipped: true, reason: "invalid_fuel_type" };
  }
  if (!Number.isFinite(litres) || litres <= 0) {
    return { ok: false, skipped: true, reason: "invalid_litres" };
  }

  const now = nowIso();
  const existingLedger = await ctx.db.query("fuel_station_ledger").collect();
  const alreadyDeducted = existingLedger.some(
    (l: any) =>
      String(l.fuel_station_id) === String(stationId) &&
      String(l.transaction_type || "") === "stock_deduct" &&
      String(l.reference_id || "") === String(referenceId)
  );
  if (alreadyDeducted) return { ok: true, skipped: true, reason: "already_deducted" };

  let stockRecord = await ctx.db
    .query("fuel_station_stock")
    .withIndex("by_fuel_station_id", (q: any) => q.eq("fuel_station_id", stationId))
    .filter((q: any) => q.eq(q.field("fuel_type"), fuelType))
    .first();

  if (!stockRecord) {
    const insertedId = await ctx.db.insert("fuel_station_stock", {
      fuel_station_id: stationId,
      fuel_type: fuelType,
      stock_litres: 0,
      created_at: now,
      updated_at: now,
    });
    stockRecord = await ctx.db.get(insertedId);
  }

  const currentStock = Number(stockRecord?.stock_litres || 0);
  const remaining = Math.max(0, currentStock - litres);

  if (stockRecord) {
    await ctx.db.patch(stockRecord._id, {
      stock_litres: remaining,
      updated_at: now,
    });
  }

  await ctx.db.insert("fuel_station_ledger", {
    fuel_station_id: stationId,
    transaction_type: "stock_deduct",
    amount: 0,
    description: `Stock deducted: ${litres}L ${fuelType} for order #${referenceId}`,
    status: "completed",
    reference_id: String(referenceId),
    created_at: now,
    updated_at: now,
  });

  return { ok: true, skipped: false, remaining_stock: remaining, deducted: litres };
};

const resolveFuelStationIdForCompletion = async (ctx: any, row: any, args: any) => {
  const fromArgs = args?.fuel_station_id
    ? sanitizeIdInternal(ctx, "fuel_stations", args.fuel_station_id)
    : undefined;
  if (row?.fuel_station_id) return row.fuel_station_id;
  if (fromArgs) return fromArgs;

  // Fallback: some flows may have an assignment but not a fuel_station_id patched onto the request.
  const latest = await getLatestFuelAssignmentForRequest(ctx, row?._id);
  return latest?.fuel_station_id;
};

const applyCompletionSettlementIfNeeded = async (ctx: any, row: any, args: any) => {
  const latestAssignment = await getLatestFuelAssignmentForRequest(ctx, row?._id);
  const workerId =
    row.assigned_worker || (args.assigned_worker ? sanitizeIdInternal(ctx, "workers", args.assigned_worker) : undefined);
  const fuelStationId = await resolveFuelStationIdForCompletion(ctx, row, args);

  const now = nowIso();
  let workerEarnings = 0;
  let stationEarnings = 0;
  const totalAmount = Number(row.amount || 0);
  const litresForFuel = (() => {
    const fromRow = Number(row.litres || 0);
    if (fromRow > 0) return fromRow;
    const fromAssignment = Number(latestAssignment?.litres || 0);
    return fromAssignment > 0 ? fromAssignment : 0;
  })();
  const fuelTypeForStock = (() => {
    const fromRow = String(row.service_type || "").toLowerCase();
    if (fromRow === "petrol" || fromRow === "diesel") return fromRow;
    const fromAssignment = String(latestAssignment?.fuel_type || "").toLowerCase();
    return fromAssignment === "petrol" || fromAssignment === "diesel" ? fromAssignment : "";
  })();

  // Always attempt stock deduction once (even if a settlement already exists).
  await deductStationStockOnce(ctx, {
    fuel_station_id: fuelStationId,
    fuel_type: fuelTypeForStock,
    litres: litresForFuel,
    reference_id: row._id,
  });

  const existingSettlement = await ctx.db
    .query("settlements")
    .withIndex("by_service_request_id", (q: any) => q.eq("service_request_id", row._id))
    .first();
  if (existingSettlement) return { ok: true, skipped: true };

  // 1. Worker Earnings
  if (workerId) {
    const worker = await ctx.db.get(workerId);
    if (worker) {
      // Update floater_cash if it was a COD (Cash on Delivery) order
      if (row.payment_method === "COD") {
        const currentFloater = Number(worker.floater_cash || 0);
        await ctx.db.patch(worker._id, {
          floater_cash: currentFloater + totalAmount,
          updated_at: now,
        });
      }

      // Calculate Worker Payout (Earnings for this job)
      const isFuel = row.service_type === "petrol" || row.service_type === "diesel";
      const basePay = 50;
      const perKmRate = 10;
      const minGuarantee = 100;
      workerEarnings = basePay;
      if (isFuel) {
        const distanceKm = Number(row.distance_km || 0);
        workerEarnings = Math.max(basePay + (distanceKm * perKmRate), minGuarantee);
      }

      // Update worker's pending balance (earnings available for next payout)
      await ctx.db.patch(worker._id, {
        pending_balance: Number(worker.pending_balance || 0) + workerEarnings,
        updated_at: now,
      });
    }
  }

  // 2. Fuel Station Earnings + Stock Deduction
  if (fuelStationId) {
    const station = await ctx.db.get(fuelStationId);
    if (station) {
      // Station payout is based on fuel cost (litres * price)
      stationEarnings = litresForFuel * Number(row.fuel_price || 0);

      if (stationEarnings > 0) {
        await ctx.db.patch(station._id, {
          pending_payout: Number(station.pending_payout || 0) + stationEarnings,
          total_earnings: Number(station.total_earnings || 0) + stationEarnings,
          updated_at: now,
        });

        // Create ledger entry for the station
        await ctx.db.insert("fuel_station_ledger", {
          fuel_station_id: station._id,
          transaction_type: "sale",
          amount: stationEarnings,
          description: `Fulfilled ${litresForFuel}L ${row.service_type} for order #${row._id}`,
          status: "pending",
          reference_id: String(row._id),
          created_at: now,
          updated_at: now,
        });
      }

      // Stock is deducted above via `deductStationStockOnce` to make it idempotent and
      // independent of settlement creation (so it can be fixed retroactively).
    }
  }

  // 3. Global Settlement Record
  await ctx.db.insert("settlements", {
    service_request_id: row._id,
    worker_id: workerId as any,
    fuel_station_id: fuelStationId as any,
    settlement_date: now,
    customer_amount: totalAmount,
    fuel_cost: stationEarnings,
    delivery_fee: row.service_type === "petrol" || row.service_type === "diesel" ? 80 : 0,
    platform_service_fee: Math.round(totalAmount * 0.05),
    surge_fee: 0,
    fuel_station_payout: stationEarnings,
    worker_payout: workerEarnings,
    platform_profit: totalAmount - workerEarnings - stationEarnings,
    status: "pending_reconciliation",
    created_at: now,
    updated_at: now,
  });

  return { ok: true, skipped: false };
};

export const getById = queryGeneric({
  handler: async (ctx, args: any) => {
    const row = await getByIdInternal(ctx, args.id);
    return row ? { ...row, id: row._id } : null;
  },
});

export const getByPaymentId = queryGeneric({
  handler: async (ctx, args: any) => {
    const paymentId = String(args.payment_id || "");
    if (!paymentId) return null;
    const rows = await ctx.db.query("service_requests").collect();
    const byExact = rows.find((r) => String(r.payment_id || "") === paymentId);
    if (byExact) return byExact;
    const byLegacy = rows.find((r) => String(r.payment_id || "") === `pay_SE${paymentId.slice(-12)}`);
    return byLegacy || null;
  },
});

export const updatePaymentDetails = mutationGeneric({
  handler: async (ctx, args: any) => {
    try {
      const row = await getByIdInternal(ctx, args.id);
      if (!row) throw new Error("Service request not found");

      const patch: Record<string, any> = {};
      if (args.payment_status !== undefined) patch.payment_status = args.payment_status;
      if (args.payment_details !== undefined) {
        patch.payment_details =
          typeof args.payment_details === "string"
            ? args.payment_details
            : JSON.stringify(args.payment_details);
      }
      await ctx.db.patch(row._id, patch);
      return { ok: true };
    } catch (err: any) {
      console.error("updatePaymentDetails error:", err);
      throw new Error(`Payment update failed: ${err.message}`);
    }
  },
});

export const addFeedback = mutationGeneric({
  handler: async (ctx, args: any) => {
    try {
      const row = await getByIdInternal(ctx, args.id);
      if (!row) throw new Error("Service request not found");

      await ctx.db.patch(row._id, {
        rating: Number(args.rating),
        review_comment: String(args.review_comment || ""),
      });
      return { ok: true, assigned_worker: row.assigned_worker };
    } catch (err: any) {
      console.error("addFeedback error:", err);
      throw new Error(`Feedback submission failed: ${err.message}`);
    }
  },
});

export const recentCompletedRatingsForWorker = queryGeneric({
  handler: async (ctx, args: any) => {
    const rows = await ctx.db.query("service_requests").collect();
    return rows
      .filter((r) => String(r.assigned_worker || "") === String(args.worker_id))
      .filter((r) => String(r.status || "") === "Completed" && r.rating != null)
      .sort((a, b) =>
        String(b.completed_at || b.created_at || "").localeCompare(String(a.completed_at || a.created_at || ""))
      )
      .slice(0, 10)
      .map((r) => Number(r.rating || 0));
  },
});

export const updateStatus = mutationGeneric({
  handler: async (ctx, args: any) => {
    try {
      const row = await getByIdInternal(ctx, args.id);
      if (!row) throw new Error("Service request not found");

      const patch: Record<string, any> = {};
      if (args.status) {
        patch.status = args.status;
        const now = nowIso();
        if (args.status === "Assigned") patch.assigned_at = now;
        if (args.status === "In Progress") patch.in_progress_at = now;
        if (args.status === "Completed") patch.completed_at = now;
        if (args.status === "Cancelled") patch.cancelled_at = now;
      }
      if (args.assigned_worker !== undefined) patch.assigned_worker = sanitizeIdInternal(ctx, "workers", args.assigned_worker);
      if (args.cod_failure_reason !== undefined) patch.cod_failure_reason = args.cod_failure_reason;
      if (args.payment_status !== undefined) patch.payment_status = args.payment_status;
      if (args.payment_method !== undefined) patch.payment_method = args.payment_method;
      if (args.fuel_station_id !== undefined) patch.fuel_station_id = sanitizeIdInternal(ctx, "fuel_stations", args.fuel_station_id);
      if (args.status === "Cancelled" && args.cod_failure_reason !== undefined) {
        patch.payment_status = "FAILED_COD";
      }

      await ctx.db.patch(row._id, patch);

      // --- NEW: Update User COD Stats & Trust Score ---
      if (row.user_id) {
        const user = await ctx.db.get(row.user_id);
        if (user) {
          const userPatch: Record<string, any> = { updated_at: nowIso() };
          const isCod = row.payment_method === "COD" || args.payment_method === "COD";

          if (args.status === "Completed" && isCod) {
            userPatch.cod_success_count = (user.cod_success_count || 0) + 1;
            userPatch.trust_score = Math.min(100, (user.trust_score || 50) + 5);
          } else if (args.status === "Cancelled" && args.cod_failure_reason) {
            userPatch.cod_failure_count = (user.cod_failure_count || 0) + 1;
            userPatch.cod_last_failure_reason = args.cod_failure_reason;
            userPatch.trust_score = Math.max(0, (user.trust_score || 50) - 20);


            await ctx.db.insert("activity_log", {
              type: "cod_failure",
              message: `COD Failure for User ${user.first_name}: ${args.cod_failure_reason}`,
              entity_type: "users",
              entity_id: String(user._id),
              created_at: nowIso(),
            });
          }

          if (Object.keys(userPatch).length > 1) {
            await ctx.db.patch(user._id, userPatch);
          }
        }
      }
      // ------------------------------------------------

      // Log Status Change
      if (args.status) {
        await ctx.db.insert("activity_log", {
          type: "service_request_status_change",
          message: `Request #${row._id} status changed to ${args.status}`,
          entity_type: "service_requests",
          entity_id: String(row._id),
          created_at: nowIso(),
        });
      }

      // Settlement and Financial update logic on Completion
      if (args.status === "Completed") {
        await applyCompletionSettlementIfNeeded(ctx, row, args);
      }
      return { ok: true };
    } catch (err: any) {
      console.error("updateStatus error:", err);
      throw new ConvexError(`Status update failed: ${err.message}`);
    }
  },
});

export const adminUpdateStatus = mutationGeneric({
  handler: async (ctx, args: any) => {
    try {
      const row = await getByIdInternal(ctx, args.id);
      if (!row) throw new Error("Service request not found");

      const patch: Record<string, any> = {
        updated_at: nowIso(),
      };
      if (args.status) {
        patch.status = args.status;
        const now = nowIso();
        if (args.status === "Completed") patch.completed_at = now;
        if (args.status === "Cancelled") patch.cancelled_at = now;
      }

      if (args.assigned_worker !== undefined) {
        patch.assigned_worker = args.assigned_worker === null
          ? null
          : sanitizeIdInternal(ctx, "workers", args.assigned_worker);
      }

      await ctx.db.patch(row._id, patch);

      await ctx.db.insert("activity_log", {
        type: "admin_manual_override",
        message: `Admin force updated request #${row._id} to ${args.status || "new state"}`,
        entity_type: "service_requests",
        entity_id: String(row._id),
        created_at: nowIso(),
      });

      if (args.status === "Completed") {
        await applyCompletionSettlementIfNeeded(ctx, row, args);
      }

      return { ok: true };
    } catch (err: any) {
      console.error("adminUpdateStatus error:", err);
      throw new ConvexError(`Admin override failed: ${err.message}`);
    }
  },
});
