import { queryGeneric } from "convex/server";

export const getLoginAccount = queryGeneric({
  handler: async (ctx, args: any) => {
    const role = String(args.role || "");
    const email = String(args.email || "").toLowerCase();

    if (role === "Worker") {
      const worker = await ctx.db
        .query("workers")
        .withIndex("by_email", (q) => q.eq("email", email))
        .first();
      if (!worker) return null;
      return {
        id: worker._id,
        email: worker.email,
        password: worker.password,
        first_name: worker.first_name,
        last_name: worker.last_name,
        phone_number: worker.phone_number || "",
        role: "Worker",
      };
    }

    if (role === "Fuel_Station") {
      const user = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .first();
      if (!user) return null;
      const station = await ctx.db
        .query("fuel_stations")
        .withIndex("by_user_id", (q) => q.eq("user_id", user._id))
        .first();
      if (!station) return null;
      return {
        id: user._id,
        serial_id: (user as any).serial_id ?? null,
        email: user.email,
        password: user.password,
        first_name: user.first_name,
        last_name: user.last_name,
        phone_number: user.phone_number || "",
        role: "Fuel_Station",
        station_name: station.station_name || "",
        is_verified: Boolean(station.is_verified),
        cod_enabled: station.cod_enabled !== false,
      };
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (!user) return null;
    return {
      id: user._id,
      serial_id: (user as any).serial_id ?? null,
      email: user.email,
      password: user.password,
      first_name: user.first_name,
      last_name: user.last_name,
      phone_number: user.phone_number || "",
      role: user.role || "User",
    };
  },
});
