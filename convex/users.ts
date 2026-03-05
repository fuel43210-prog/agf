import { mutationGeneric, queryGeneric } from "convex/server";

const nowIso = () => new Date().toISOString();

export const signup = mutationGeneric({
  handler: async (ctx, args: any) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", String(args.email).toLowerCase()))
      .first();
    if (existing) {
      throw new Error("Email already exists");
    }

    const id = await ctx.db.insert("users", {
      email: String(args.email).toLowerCase(),
      password: args.password,
      first_name: args.first_name,
      last_name: args.last_name,
      phone_number: args.phone_number,
      role: args.role || "User",
      trust_score: 50,
      cod_success_count: 0,
      cod_failure_count: 0,
      cod_disabled: false,
      created_at: nowIso(),
      updated_at: nowIso(),
    });

    return { id };
  },
});

export const getByEmail = queryGeneric({
  handler: async (ctx, args: any) => {
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", String(args.email).toLowerCase()))
      .first();
  },
});

