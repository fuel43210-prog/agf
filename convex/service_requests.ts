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
      await ctx.db.patch(row._id, patch);

      // Settlement and Financial update logic on Completion
      if (args.status === "Completed") {
        const workerId = row.assigned_worker || (args.assigned_worker ? sanitizeIdInternal(ctx, "workers", args.assigned_worker) : undefined);
        const fuelStationId = row.fuel_station_id || (args.fuel_station_id ? sanitizeIdInternal(ctx, "fuel_stations", args.fuel_station_id) : undefined);

        const now = nowIso();
        let workerEarnings = 0;
        let stationEarnings = 0;
        const totalAmount = Number(row.amount || 0);

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

        // 2. Fuel Station Earnings
        if (fuelStationId) {
          const station = await ctx.db.get(fuelStationId);
          if (station) {
            // Station payout is based on fuel cost (litres * price)
            stationEarnings = Number(row.litres || 0) * Number(row.fuel_price || 0);

            // If it's not a fuel delivery (e.g., crane), station payout logic might vary, 
            // but for now we assume stationEarnings is 0 if no fuel details.

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
                description: `Fulfilled ${row.litres}L ${row.service_type} for order #${row._id}`,
                status: "pending",
                reference_id: String(row._id),
                created_at: now,
                updated_at: now,
              });
            }
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
          delivery_fee: (row.service_type === "petrol" || row.service_type === "diesel") ? 80 : 0,
          platform_service_fee: Math.round(totalAmount * 0.05),
          surge_fee: 0,
          fuel_station_payout: stationEarnings,
          worker_payout: workerEarnings,
          platform_profit: totalAmount - workerEarnings - stationEarnings,
          status: "pending_reconciliation",
          created_at: now,
          updated_at: now,
        });
      }
      return { ok: true };
    } catch (err: any) {
      console.error("updateStatus error:", err);
      throw new ConvexError(`Status update failed: ${err.message}`);
    }
  },
});

