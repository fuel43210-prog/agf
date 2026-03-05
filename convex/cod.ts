import { mutationGeneric, queryGeneric } from "convex/server";

const nowIso = () => new Date().toISOString();

export const getSettings = queryGeneric({
  handler: async (ctx) => {
    const row = await ctx.db
      .query("cod_settings")
      .withIndex("by_singleton_key", (q) => q.eq("singleton_key", "default"))
      .first();
    if (row) return row;
    return {
      singleton_key: "default",
      cod_limit: 500,
      trust_threshold: 50,
      max_failures: 3,
      disable_days: 7,
      updated_at: nowIso(),
    };
  },
});

export const upsertSettings = mutationGeneric({
  handler: async (ctx, args: any) => {
    const row = await ctx.db
      .query("cod_settings")
      .withIndex("by_singleton_key", (q) => q.eq("singleton_key", "default"))
      .first();
    const patch = {
      cod_limit: Number(args.cod_limit ?? 500),
      trust_threshold: Number(args.trust_threshold ?? 50),
      max_failures: Number(args.max_failures ?? 3),
      disable_days: Number(args.disable_days ?? 7),
      updated_at: nowIso(),
    };
    if (row) {
      await ctx.db.patch(row._id, patch);
      return { ok: true, id: row._id };
    }
    const id = await ctx.db.insert("cod_settings", {
      singleton_key: "default",
      ...patch,
    });
    return { ok: true, id };
  },
});
