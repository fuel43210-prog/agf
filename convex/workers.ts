import { mutationGeneric, queryGeneric } from "convex/server";

const nowIso = () => new Date().toISOString();

export const createWorker = mutationGeneric({
  handler: async (ctx, args: any) => {
    const existing = await ctx.db
      .query("workers")
      .withIndex("by_email", (q) => q.eq("email", String(args.email).toLowerCase()))
      .first();
    if (existing) throw new Error("Email already exists");

    const id = await ctx.db.insert("workers", {
      email: String(args.email).toLowerCase(),
      password: args.password,
      first_name: args.first_name,
      last_name: args.last_name,
      phone_number: args.phone_number,
      status: "Available",
      verified: false,
      status_locked: false,
      floater_cash: 0,
      pending_balance: 0,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    return { id };
  },
});

export const getByEmail = queryGeneric({
  handler: async (ctx, args: any) => {
    return await ctx.db
      .query("workers")
      .withIndex("by_email", (q) => q.eq("email", String(args.email).toLowerCase()))
      .first();
  },
});

export const getById = queryGeneric({
  handler: async (ctx, args: any) => {
    return await ctx.db.get(args.id);
  },
});

export const listAvailableVerified = queryGeneric({
  handler: async (ctx) => {
    const rows = await ctx.db.query("workers").collect();
    const isVerified = (value: unknown) => {
      if (typeof value === "boolean") return value;
      if (typeof value === "number") return value === 1;
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        return normalized === "1" || normalized === "true" || normalized === "yes";
      }
      return false;
    };
    return rows
      .filter((w) => {
        const status = String(w.status || "Available").trim().toLowerCase();
        const available = status === "available";
        return available && isVerified(w.verified) && !Boolean(w.status_locked);
      })
      .sort((a, b) =>
        `${a.first_name || ""} ${a.last_name || ""}`.localeCompare(
          `${b.first_name || ""} ${b.last_name || ""}`
        )
      );
  },
});

export const runMaintenance = mutationGeneric({
  handler: async (ctx) => {
    const workers = await ctx.db.query("workers").collect();
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    for (const w of workers) {
      const patch: Record<string, any> = {};
      if (!w.verified && w.docs_submitted_at) {
        const submitted = new Date(w.docs_submitted_at).getTime();
        if (!Number.isNaN(submitted) && submitted < oneDayAgo) {
          patch.verified = true;
        }
      }
      const lastCollected = w.last_cash_collection_at
        ? new Date(w.last_cash_collection_at).getTime()
        : new Date(w.created_at || 0).getTime();
      const shouldLock =
        (Number(w.floater_cash || 0) >= 1500 ||
          (!Number.isNaN(lastCollected) && lastCollected < sevenDaysAgo)) &&
        !w.status_locked;
      if (shouldLock) {
        patch.status = "Offline";
        patch.status_locked = true;
      }
      if (Object.keys(patch).length > 0) {
        patch.updated_at = nowIso();
        await ctx.db.patch(w._id, patch);
      }
    }
    return { ok: true };
  },
});

export const updateWorkerProfile = mutationGeneric({
  handler: async (ctx, args: any) => {
    const worker = await ctx.db.get(args.id);
    if (!worker) throw new Error("Worker not found");

    const patch: Record<string, any> = {};
    if (args.service_type !== undefined) patch.service_type = args.service_type;
    if (args.latitude !== undefined) patch.latitude = Number(args.latitude);
    if (args.longitude !== undefined) patch.longitude = Number(args.longitude);

    if (args.status !== undefined) {
      if (worker.status_locked) {
        throw new Error("Status is locked by Admin. You cannot change your status at this time.");
      }
      if (!["Available", "Busy", "Offline"].includes(args.status)) {
        throw new Error("Invalid status value");
      }
      patch.status = args.status;
    }

    if (args.submit_docs) {
      if (args.license_photo) patch.license_photo = args.license_photo;
      if (args.self_photo) patch.self_photo = args.self_photo;
      patch.docs_submitted_at = nowIso();
    }

    if (Object.keys(patch).length === 0) throw new Error("No fields to update");
    patch.updated_at = nowIso();
    await ctx.db.patch(worker._id, patch);
    return { ok: true };
  },
});

export const lockByLowRating = mutationGeneric({
  handler: async (ctx, args: any) => {
    const worker = await ctx.db.get(args.worker_id);
    if (!worker) return { ok: false };
    await ctx.db.patch(worker._id, {
      status: "Offline",
      status_locked: true,
      lock_reason: "Low Rating",
      updated_at: nowIso(),
    });
    return { ok: true };
  },
});
