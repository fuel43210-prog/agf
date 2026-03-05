import { mutationGeneric } from "convex/server";

const nowIso = () => new Date().toISOString();

export const addActivity = mutationGeneric({
  handler: async (ctx, args: any) => {
    await ctx.db.insert("activity_log", {
      type: args.type,
      message: args.message || "",
      entity_type: args.entity_type || "",
      entity_id: args.entity_id || "",
      created_at: nowIso(),
    });
    return { ok: true };
  },
});

