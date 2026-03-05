import { mutationGeneric, queryGeneric } from "convex/server";

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
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  },
});

export const updateStatus = mutationGeneric({
  handler: async (ctx, args: any) => {
    const row = await ctx.db.get(args.id);
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
    if (args.assigned_worker !== undefined) patch.assigned_worker = args.assigned_worker;
    if (args.cod_failure_reason !== undefined) patch.cod_failure_reason = args.cod_failure_reason;
    await ctx.db.patch(row._id, patch);
    return { ok: true };
  },
});

