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

    const allUsers = await ctx.db.query("users").collect();
    const maxSerial = allUsers.reduce((max, u) => {
      const n = Number((u as any).serial_id || 0);
      return n > max ? n : max;
    }, 0);

    const id = await ctx.db.insert("users", {
      serial_id: maxSerial + 1,
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

export const assignMissingSerialIds = mutationGeneric({
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const sorted = users
      .slice()
      .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));

    let maxSerial = sorted.reduce((max, u) => {
      const n = Number((u as any).serial_id || 0);
      return n > max ? n : max;
    }, 0);

    let updated = 0;
    for (const user of sorted) {
      if ((user as any).serial_id == null) {
        maxSerial += 1;
        await ctx.db.patch(user._id, { serial_id: maxSerial, updated_at: nowIso() });
        updated += 1;
      }
    }
    return { ok: true, updated };
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

export const getById = queryGeneric({
  handler: async (ctx, args: any) => {
    return await ctx.db.get(args.id);
  },
});
