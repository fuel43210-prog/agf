import { NextResponse } from "next/server";
const { convexQuery } = require("../../../lib/convexServer");

const toRadians = (v) => (v * Math.PI) / 180;
const distanceMeters = (a, b) => {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * 6371000 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get("user_id");
    const orderAmountParam = url.searchParams.get("order_amount");
    const locationParam = url.searchParams.get("location");
    const stationIdParam = url.searchParams.get("fuelstation_id");
    const locationAllowsParam = url.searchParams.get("location_allows_cod");

    const orderAmount = Number(orderAmountParam);
    if (!userId) {
      return NextResponse.json({ cod_allowed: false, reason: "invalid_user" }, { status: 400 });
    }
    if (Number.isNaN(orderAmount)) {
      return NextResponse.json({ cod_allowed: false, reason: "invalid_amount" }, { status: 400 });
    }

    const cfg = (await convexQuery("cod:getSettings", {})) || {
      cod_limit: 500,
      trust_threshold: 50,
      max_failures: 3,
      disable_days: 7,
    };

    const user = await convexQuery("users:getById", { id: userId });

    if (!user) {
      return NextResponse.json({ cod_allowed: false, reason: "user_not_found" }, { status: 404 });
    }

    const trustScore = Number(user.trust_score ?? 0);
    if (trustScore < Number(cfg.trust_threshold)) {
      return NextResponse.json({ cod_allowed: false, reason: "trust_score_low" });
    }

    if (user.cod_disabled) {
      return NextResponse.json({ cod_allowed: false, reason: "cod_disabled" });
    }

    if (user.cod_disabled_until) {
      const until = new Date(user.cod_disabled_until);
      if (!Number.isNaN(until.getTime()) && until.getTime() > Date.now()) {
        return NextResponse.json({ cod_allowed: false, reason: "cod_disabled_until" });
      }
    }

    if (Number(user.cod_failure_count || 0) >= Number(cfg.max_failures)) {
      return NextResponse.json({ cod_allowed: false, reason: "cod_fail_limit" });
    }

    if (orderAmount > Number(cfg.cod_limit)) {
      return NextResponse.json({ cod_allowed: false, reason: "order_amount_too_high" });
    }

    if (locationAllowsParam && String(locationAllowsParam).toLowerCase() === "false") {
      return NextResponse.json({ cod_allowed: false, reason: "location_not_supported" });
    }

    let station = null;
    if (stationIdParam) {
      const selected = await convexQuery("fuel_stations:list", { id: stationIdParam });
      station = selected?.[0] || null;
    } else if (locationParam) {
      const [latStr, lngStr] = String(locationParam).split(",");
      const lat = Number(latStr);
      const lng = Number(lngStr);
      if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
        const stations = (await convexQuery("fuel_stations:list", {})) || [];
        let nearest = null;
        let nearestDist = Infinity;
        stations.forEach((s) => {
          if (s.latitude == null || s.longitude == null) return;
          const d = distanceMeters({ lat, lng }, { lat: s.latitude, lng: s.longitude });
          if (d < nearestDist) {
            nearestDist = d;
            nearest = s;
          }
        });
        station = nearest;
      }
    }

    if (!station) {
      return NextResponse.json({ cod_allowed: false, reason: "fuel_station_not_found" });
    }

    if (station.cod_supported === 0 || station.cod_supported === false) {
      return NextResponse.json({ cod_allowed: false, reason: "fuel_station_no_cod" });
    }

    if (station.cod_delivery_allowed === 0 || station.cod_delivery_allowed === false) {
      return NextResponse.json({ cod_allowed: false, reason: "location_not_supported" });
    }

    return NextResponse.json({
      cod_allowed: true,
      reason: "ok",
      fuel_station_id: station.id,
    });
  } catch (err) {
    console.error("COD eligibility error:", err);
    return NextResponse.json({ cod_allowed: false, reason: "server_error" }, { status: 500 });
  }
}
