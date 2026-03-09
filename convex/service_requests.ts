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
    return all
      .filter((r) => (args.status ? r.status === args.status : true))
      .filter((r) => (args.user_id ? String(r.user_id || "") === String(args.user_id) : true))
      .filter((r) =>
        args.assigned_worker ? String(r.assigned_worker || "") === String(args.assigned_worker) : true
      )
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
      .map((r) => ({ ...r, id: r._id }));
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
      return { ok: true };
    } catch (err: any) {
      console.error("updateStatus error:", err);
      throw new ConvexError(`Status update failed: ${err.message}`);
    }
  },
});

