import { mutationGeneric, queryGeneric } from "convex/server";

const nowIso = () => new Date().toISOString();

export const list = queryGeneric({
  handler: async (ctx) => {
    return await ctx.db.query("fuel_stations").collect();
  },
});

export const create = mutationGeneric({
  handler: async (ctx, args: any) => {
    const id = await ctx.db.insert("fuel_stations", {
      user_id: args.user_id || undefined,
      station_name: args.station_name || "",
      email: args.email || "",
      phone_number: args.phone_number || "",
      address: args.address || "",
      latitude: args.latitude ?? undefined,
      longitude: args.longitude ?? undefined,
      cod_enabled: args.cod_enabled !== false,
      cod_supported: args.cod_supported !== false,
      cod_delivery_allowed: args.cod_delivery_allowed !== false,
      cod_current_balance: Number(args.cod_current_balance || 0),
      cod_balance_limit: Number(args.cod_balance_limit || 50000),
      is_verified: Boolean(args.is_verified),
      is_open: args.is_open !== false,
      platform_trust_flag: Boolean(args.platform_trust_flag),
      total_earnings: Number(args.total_earnings || 0),
      pending_payout: Number(args.pending_payout || 0),
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    return { id };
  },
});

export const update = mutationGeneric({
  handler: async (ctx, args: any) => {
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Fuel station not found");
    const patch = { ...args };
    delete patch.id;
    patch.updated_at = nowIso();
    await ctx.db.patch(row._id, patch);
    return { ok: true };
  },
});

