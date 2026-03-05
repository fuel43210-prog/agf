import { mutationGeneric, queryGeneric } from "convex/server";

const nowIso = () => new Date().toISOString();

export const create = mutationGeneric({
  handler: async (ctx, args: any) => {
    const id = await ctx.db.insert("payments", {
      service_request_id: args.service_request_id || undefined,
      provider: args.provider || "razorpay",
      provider_payment_id: args.provider_payment_id || undefined,
      amount: Number(args.amount || 0),
      currency: args.currency || "INR",
      status: args.status || "created",
      metadata: args.metadata ? JSON.stringify(args.metadata) : undefined,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    return { id };
  },
});

export const updateByProviderPaymentId = mutationGeneric({
  handler: async (ctx, args: any) => {
    const row = await ctx.db
      .query("payments")
      .withIndex("by_provider_payment_id", (q) =>
        q.eq("provider_payment_id", args.provider_payment_id)
      )
      .first();
    if (!row) return { ok: false };
    await ctx.db.patch(row._id, {
      status: args.status ?? row.status,
      metadata: args.metadata ? JSON.stringify(args.metadata) : row.metadata,
      updated_at: nowIso(),
    });
    return { ok: true };
  },
});

export const list = queryGeneric({
  handler: async (ctx, args: any) => {
    const rows = await ctx.db.query("payments").collect();
    return args.status ? rows.filter((r) => r.status === args.status) : rows;
  },
});

