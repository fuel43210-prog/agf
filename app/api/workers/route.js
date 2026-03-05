import { NextResponse } from "next/server";
const { convexQuery, convexMutation } = require("../../lib/convexServer");

/** Returns active workers (Available + verified) for the user dashboard. */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const workerId = url.searchParams.get("id");

    await convexMutation("workers:runMaintenance", {});

    if (workerId) {
      const worker = await convexQuery("workers:getById", { id: workerId });
      if (!worker) {
        return NextResponse.json({ error: "Worker not found" }, { status: 404 });
      }
      return NextResponse.json(
        {
          ...worker,
          id: worker.id || worker._id,
        },
        { status: 200 }
      );
    }

    const workers = await convexQuery("workers:listAvailableVerified", {});
    const normalized = (workers || []).map((w) => ({
      ...w,
      id: w.id || w._id,
    }));
    return NextResponse.json(normalized);
  } catch (err) {
    console.error("Workers list error:", err);
    return NextResponse.json({ error: "Failed to load workers" }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    const { id, service_type, status, latitude, longitude, license_photo, self_photo, submit_docs } = body || {};

    if (!id) {
      return NextResponse.json({ error: "Worker ID is required" }, { status: 400 });
    }

    if (latitude !== undefined) {
      const lat = Number(latitude);
      if (Number.isNaN(lat) || lat < -90 || lat > 90) {
        return NextResponse.json({ error: "Invalid latitude" }, { status: 400 });
      }
    }
    if (longitude !== undefined) {
      const lng = Number(longitude);
      if (Number.isNaN(lng) || lng < -180 || lng > 180) {
        return NextResponse.json({ error: "Invalid longitude" }, { status: 400 });
      }
    }

    try {
      await convexMutation("workers:updateWorkerProfile", {
        id,
        service_type,
        status,
        latitude,
        longitude,
        license_photo,
        self_photo,
        submit_docs,
      });
    } catch (err) {
      const message = String(err?.message || "");
      if (/not found/i.test(message)) {
        return NextResponse.json({ error: "Worker not found" }, { status: 404 });
      }
      if (/too large|limit|max size|payload/i.test(message)) {
        return NextResponse.json({ error: "Uploaded images are too large. Please upload smaller images." }, { status: 413 });
      }
      if (/locked/i.test(message)) {
        return NextResponse.json({ error: message, locked: true }, { status: 403 });
      }
      if (/invalid status/i.test(message)) {
        return NextResponse.json({ error: "Invalid status value" }, { status: 400 });
      }
      if (/no fields to update/i.test(message)) {
        return NextResponse.json({ error: "No fields to update" }, { status: 400 });
      }
      throw err;
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Worker update error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
