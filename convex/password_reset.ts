import { mutationGeneric, queryGeneric } from "convex/server";

const nowIso = () => new Date().toISOString();

export const createToken = mutationGeneric({
  handler: async (ctx, args: any) => {
    const id = await ctx.db.insert("password_resets", {
      user_id: args.user_id || undefined,
      account_type: args.account_type || "users",
      account_id: args.account_id || undefined,
      token: args.token,
      used: false,
      created_at: args.created_at || nowIso(),
    });
    return { id };
  },
});

export const getByToken = queryGeneric({
  handler: async (ctx, args: any) => {
    return await ctx.db
      .query("password_resets")
      .withIndex("by_token", (q) => q.eq("token", String(args.token || "")))
      .first();
  },
});

export const markUsed = mutationGeneric({
  handler: async (ctx, args: any) => {
    const row = await ctx.db.get(args.id);
    if (!row) return { ok: false };
    await ctx.db.patch(row._id, {
      used: true,
      consumed_at: nowIso(),
    });
    return { ok: true };
  },
});

export const updateAccountPassword = mutationGeneric({
  handler: async (ctx, args: any) => {
    const accountType = String(args.account_type || "users").toLowerCase();
    const accountId = args.account_id;
    if (!accountId) return { ok: false };

    if (accountType === "workers") {
      const worker = await ctx.db.get(accountId);
      if (!worker) return { ok: false };
      await ctx.db.patch(worker._id, { password: args.password, updated_at: nowIso() });
      return { ok: true };
    }

    const user = await ctx.db.get(accountId);
    if (!user) return { ok: false };
    await ctx.db.patch(user._id, { password: args.password, updated_at: nowIso() });
    return { ok: true };
  },
});
