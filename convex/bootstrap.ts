import { mutationGeneric } from "convex/server";

const nowIso = () => new Date().toISOString();

export const seedDefaults = mutationGeneric({
  handler: async (ctx) => {
    const defaults = [
      ["petrol", "Petrol", 100],
      ["diesel", "Diesel", 150],
      ["crane", "Crane", 200],
      ["mechanic_bike", "Mechanic (Bike)", 300],
      ["mechanic_car", "Mechanic (Car)", 300],
    ];

    for (const [code, label, amount] of defaults) {
      const existing = await ctx.db
        .query("service_types")
        .withIndex("by_code", (q) => q.eq("code", code))
        .first();
      if (!existing) {
        await ctx.db.insert("service_types", {
          code,
          label,
          amount,
          created_at: nowIso(),
        });
      }
    }

    const cod = await ctx.db
      .query("cod_settings")
      .withIndex("by_singleton_key", (q) => q.eq("singleton_key", "default"))
      .first();
    if (!cod) {
      await ctx.db.insert("cod_settings", {
        singleton_key: "default",
        cod_limit: 500,
        trust_threshold: 50,
        max_failures: 3,
        disable_days: 7,
        updated_at: nowIso(),
      });
    }

    return { ok: true };
  },
});

