import { mutationGeneric, queryGeneric } from "convex/server";

const nowIso = () => new Date().toISOString();

export const addReport = mutationGeneric({
  handler: async (ctx, args: any) => {
    const id = await ctx.db.insert("connectivity_reports", {
      lat: Number(args.lat),
      lng: Number(args.lng),
      severity: String(args.severity),
      effective_type: args.effectiveType ?? undefined,
      downlink:
        args.downlink === null || args.downlink === undefined ? undefined : Number(args.downlink),
      rtt: args.rtt === null || args.rtt === undefined ? undefined : Number(args.rtt),
      failures: Number(args.failures || 0),
      offline: args.offline ? 1 : 0,
      reported_at: args.reportedAt || nowIso(),
    });
    return { id };
  },
});

export const listSince = queryGeneric({
  handler: async (ctx, args: any) => {
    const since = String(args.since || "");
    const limit = Number(args.limit || 1000);
    const rows = await ctx.db.query("connectivity_reports").collect();
    return rows
      .filter((r) => String(r.reported_at || "") >= since)
      .sort((a, b) => String(b.reported_at || "").localeCompare(String(a.reported_at || "")))
      .slice(0, limit);
  },
});
