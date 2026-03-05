import { mutationGeneric, queryGeneric } from "convex/server";

const nowIso = () => new Date().toISOString();

export const list = queryGeneric({
  handler: async (ctx, args: any) => {
    let rows = await ctx.db.query("fuel_stations").collect();

    if (args?.id) {
      rows = rows.filter((r) => String(r._id) === String(args.id));
    }

    if (args?.verified_only) {
      rows = rows.filter((r) => Boolean(r.is_verified));
    }

    if (args?.search) {
      const q = String(args.search).toLowerCase();
      rows = rows.filter((r) => String(r.station_name || "").toLowerCase().includes(q));
    }

    const stocks = await ctx.db.query("fuel_station_stock").collect();
    const byStation = new Map<string, { petrol_stock: number; diesel_stock: number }>();
    for (const s of stocks) {
      const key = String(s.fuel_station_id);
      const current = byStation.get(key) || { petrol_stock: 0, diesel_stock: 0 };
      if (s.fuel_type === "petrol") current.petrol_stock = Number(s.stock_litres || 0);
      if (s.fuel_type === "diesel") current.diesel_stock = Number(s.stock_litres || 0);
      byStation.set(key, current);
    }

    return rows
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
      .map((r) => {
        const stock = byStation.get(String(r._id)) || { petrol_stock: 0, diesel_stock: 0 };
        return {
          ...r,
          id: r._id,
          petrol_stock: stock.petrol_stock,
          diesel_stock: stock.diesel_stock,
        };
      });
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
    await ctx.db.insert("fuel_station_stock", {
      fuel_station_id: id,
      fuel_type: "petrol",
      stock_litres: 0,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    await ctx.db.insert("fuel_station_stock", {
      fuel_station_id: id,
      fuel_type: "diesel",
      stock_litres: 0,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    return { id: String(id) };
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

export const remove = mutationGeneric({
  handler: async (ctx, args: any) => {
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Fuel station not found");

    const stocks = await ctx.db.query("fuel_station_stock").collect();
    for (const s of stocks) {
      if (String(s.fuel_station_id) === String(row._id)) {
        await ctx.db.delete(s._id);
      }
    }

    await ctx.db.delete(row._id);
    return { ok: true };
  },
});
