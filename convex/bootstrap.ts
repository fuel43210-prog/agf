import { mutationGeneric } from "convex/server";

const nowIso = () => new Date().toISOString();

export const seedDefaults = mutationGeneric({
  handler: async (ctx) => {

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

