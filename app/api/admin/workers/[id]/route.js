import { NextResponse } from "next/server";
const bcrypt = require("bcryptjs");
const { convexQuery, convexMutation } = require("../../../../lib/convexServer");

const ALLOWED_STATUSES = ["Available", "Busy", "Offline"];
const isInvalidWorkerId = (id) => {
  const value = String(id ?? "").trim().toLowerCase();
  return value === "" || value === "undefined" || value === "null";
};

export async function GET(request, context) {
  try {
    const params = await context.params;
    const id = params?.id;
    if (isInvalidWorkerId(id)) return NextResponse.json({ error: "Invalid worker id" }, { status: 400 });

    const worker = await convexQuery("admin:getWorkerById", { id });
    if (!worker) return NextResponse.json({ error: "Worker not found" }, { status: 404 });
    return NextResponse.json({ ...worker, id: worker._id });
  } catch (err) {
    console.error("Admin worker get error:", err);
    return NextResponse.json({ error: "Failed to fetch worker" }, { status: 500 });
  }
}

export async function PATCH(request, context) {
  try {
    const params = await context.params;
    const id = params?.id;
    if (isInvalidWorkerId(id)) return NextResponse.json({ error: "Invalid worker id" }, { status: 400 });

    const body = await request.json();
    const { first_name, last_name, email, phone_number, status, status_locked, verified, new_password, reverify } =
      body || {};

    if (reverify) {
      const worker = await convexQuery("admin:getWorkerById", { id });
      if (!worker) return NextResponse.json({ error: "Worker not found" }, { status: 404 });
      await convexMutation("admin:updateWorker", { id, reverify: true });
      await convexMutation("logs:addActivity", {
        type: "worker_reverify",
        message: `Re-verification requested for ${worker.first_name} ${worker.last_name}`,
        entity_type: "worker",
        entity_id: String(id),
      });
      return NextResponse.json({ success: true, message: "Worker documents cleared for re-verification" });
    }

    if (!first_name || !last_name || !email || !phone_number || status == null) {
      return NextResponse.json(
        { error: "Missing required fields: first_name, last_name, email, phone_number, status" },
        { status: 400 }
      );
    }
    if (!ALLOWED_STATUSES.includes(status)) {
      return NextResponse.json({ error: "Invalid status. Must be Available, Busy, or Offline" }, { status: 400 });
    }

    const existing = await convexQuery("admin:getWorkerById", { id });
    if (!existing) return NextResponse.json({ error: "Worker not found" }, { status: 404 });

    let finalLock = existing.status_locked ? 1 : 0;
    if (status !== existing.status) finalLock = 1;
    if (status_locked !== undefined) finalLock = status_locked ? 1 : 0;
    const finalVerified = verified !== undefined ? (verified ? 1 : 0) : existing.verified ? 1 : 0;
    const password = new_password?.trim() ? await bcrypt.hash(String(new_password).trim(), 10) : undefined;

    await convexMutation("admin:updateWorker", {
      id,
      first_name,
      last_name,
      email,
      phone_number,
      status,
      status_locked: Boolean(finalLock),
      verified: Boolean(finalVerified),
      password,
    });

    const changes = [];
    if (existing.first_name !== first_name || existing.last_name !== last_name) changes.push("name");
    if (existing.email !== email) changes.push("email");
    if (String(existing.phone_number || "") !== String(phone_number || "")) changes.push("phone");
    if (existing.status !== status) changes.push("status");
    if ((existing.status_locked ? 1 : 0) !== finalLock) changes.push("lock");
    if ((existing.verified ? 1 : 0) !== finalVerified) changes.push("verified");
    if (password) changes.push("password");
    const changeSummary = changes.length ? ` (${changes.join(", ")})` : "";
    await convexMutation("logs:addActivity", {
      type: "worker_updated",
      message: `Worker ${first_name} ${last_name} updated${changeSummary}`,
      entity_type: "worker",
      entity_id: String(id),
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = String(err?.message || "");
    if (/email already in use/i.test(msg)) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }
    console.error("Admin worker update error:", err);
    return NextResponse.json({ error: "Failed to update worker" }, { status: 500 });
  }
}

export async function DELETE(request, context) {
  try {
    const params = await context.params;
    const id = params?.id;
    if (isInvalidWorkerId(id)) return NextResponse.json({ error: "Invalid worker id" }, { status: 400 });

    const worker = await convexQuery("admin:getWorkerById", { id });
    if (!worker) return NextResponse.json({ error: "Worker not found" }, { status: 404 });

    await convexMutation("admin:deleteWorker", { id });
    await convexMutation("logs:addActivity", {
      type: "worker_deleted",
      message: `Worker ${worker.first_name} ${worker.last_name} removed`,
      entity_type: "worker",
      entity_id: String(id),
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Admin worker delete error:", err);
    return NextResponse.json({ error: "Failed to delete worker" }, { status: 500 });
  }
}
