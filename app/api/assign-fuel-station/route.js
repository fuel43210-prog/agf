import { NextResponse } from "next/server";
const { convexQuery, convexMutation } = require("../../lib/convexServer");
const { haversineDistance } = require("../../../database/distance-calculator");

function normalizeStationShape(station) {
  if (!station) return null;
  return {
    ...station,
    id: station.id || station._id,
    name: station.station_name || station.name || `Station ${station.id || station._id}`,
    lat: station.latitude ?? station.lat ?? null,
    lng: station.longitude ?? station.lng ?? null,
  };
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function boolFlag(value, fallback = true) {
  if (value === null || value === undefined) return fallback;
  return Boolean(value);
}

function calculateDistances(worker_lat, worker_lng, stations) {
  return stations
    .map((s) => ({
      ...s,
      lat: toNumberOrNull(s.lat ?? s.latitude),
      lng: toNumberOrNull(s.lng ?? s.longitude),
    }))
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .map((s) => ({
      ...s,
      distance_km: haversineDistance(worker_lat, worker_lng, s.lat, s.lng),
    }))
    .sort((a, b) => Number(a.distance_km || 0) - Number(b.distance_km || 0));
}

async function selectFuelStationConvex({
  worker_lat,
  worker_lng,
  fuel_type,
  litres,
  is_cod = false,
  max_radius_km = 15,
  fallback_to_prepaid = true,
}) {
  const allStations =
    (await convexQuery("fuel_station_ops:listStationsWithStock", {
      fuel_type,
      litres,
    })) || [];

  const eligibleStations = allStations.filter(
    (s) => boolFlag(s.is_open, true) && boolFlag(s.is_verified, true)
  );
  const candidates = eligibleStations.length > 0 ? eligibleStations : allStations;
  if (candidates.length === 0) {
    return { success: false, error: "No fuel stations available", fallback: null };
  }

  const stationsWithCoords = calculateDistances(worker_lat, worker_lng, candidates);
  const stationsWithoutCoords = candidates
    .map((s) => ({
      ...s,
      lat: toNumberOrNull(s.latitude),
      lng: toNumberOrNull(s.longitude),
    }))
    .filter((s) => !Number.isFinite(s.lat) || !Number.isFinite(s.lng))
    .map((s) => ({ ...s, distance_km: null }));

  let nearbyStations = [];
  if (stationsWithCoords.length > 0) {
    nearbyStations = stationsWithCoords.filter((s) => Number(s.distance_km || 0) <= Number(max_radius_km || 15));
    if (nearbyStations.length === 0) {
      if (stationsWithoutCoords.length > 0) {
        nearbyStations = stationsWithoutCoords;
      } else {
        return {
          success: false,
          error: `No fuel stations within ${max_radius_km} km radius`,
          fallback: null,
        };
      }
    }
  } else {
    nearbyStations = candidates.map((s) => ({ ...s, distance_km: null }));
  }

  const stationsWithFuel = nearbyStations.filter((s) => Boolean(s.has_fuel));
  if (stationsWithFuel.length === 0) {
    return {
      success: false,
      error: `No stations with ${litres}L of ${fuel_type} in stock`,
      out_of_stock: true,
      fallback: null,
    };
  }

  if (is_cod) {
    const codSupporting = stationsWithFuel.map((station) => {
      const codSupport = boolFlag(station.cod_supported, boolFlag(station.cod_enabled, true));
      const trustFlag = boolFlag(station.platform_trust_flag, true);
      const currentBalance = Number(station.cod_current_balance || 0);
      const balanceLimit = Number(station.cod_balance_limit || 50000);
      const balanceOk = currentBalance < balanceLimit;
      return {
        ...station,
        supports_cod: codSupport && trustFlag && balanceOk,
        cod_rejection_reason: !codSupport
          ? "cod_not_supported"
          : !trustFlag
            ? "platform_trust_flag_false"
            : !balanceOk
              ? "balance_limit_exceeded"
              : null,
      };
    });
    const codStations = codSupporting.filter((s) => s.supports_cod);

    if (codStations.length > 0) {
      return {
        success: true,
        station: codStations[0],
        selected_criteria: stationsWithCoords.length > 0 ? "cod_supported" : "cod_supported_no_geo",
        alternatives: codStations.slice(1, 3),
      };
    }

    if (fallback_to_prepaid) {
      return {
        success: true,
        station: stationsWithFuel[0],
        selected_criteria:
          stationsWithCoords.length > 0 ? "fallback_to_prepaid" : "fallback_to_prepaid_no_geo",
        message: "No COD-supporting station nearby. Using prepaid station.",
        cod_fallback: true,
        alternatives: stationsWithFuel.slice(1, 3),
      };
    }

    return {
      success: false,
      error: "No COD-supporting stations available",
      cod_stations_failed: codSupporting.map((s) => ({
        id: s.id,
        name: s.station_name || s.name,
        reason: s.cod_rejection_reason,
      })),
      fallback: stationsWithFuel[0],
    };
  }

  return {
    success: true,
    station: stationsWithFuel[0],
    selected_criteria: stationsWithCoords.length > 0 ? "nearest_with_stock" : "with_stock_no_geo",
    alternatives: stationsWithFuel.slice(1, 3),
  };
}

async function getAlternativeFuelStationsConvex({
  worker_lat,
  worker_lng,
  fuel_type,
  litres,
  excluded_station_id = null,
  limit = 5,
  max_radius_km = 20,
}) {
  const stations =
    (await convexQuery("fuel_station_ops:listStationsWithStock", {
      fuel_type,
      litres,
      excluded_station_id: excluded_station_id || undefined,
    })) || [];
  const eligible = stations.filter((s) => boolFlag(s.is_open, true) && boolFlag(s.is_verified, true));
  const candidates = eligible.length > 0 ? eligible : stations;

  const withDistance = calculateDistances(worker_lat, worker_lng, candidates);
  const base = withDistance.length
    ? withDistance.filter((s) => Number(s.distance_km || 0) <= Number(max_radius_km || 20))
    : candidates.map((s) => ({ ...s, distance_km: null }));

  return base.slice(0, limit).map((s) => ({
    id: s.id || s._id,
    name: s.station_name || s.name,
    lat: s.lat ?? s.latitude ?? null,
    lng: s.lng ?? s.longitude ?? null,
    distance_km: s.distance_km,
    cod_supported: boolFlag(s.cod_supported, true),
    has_stock: Boolean(s.has_fuel),
    available_stock: Number(s.available_stock || 0),
  }));
}

export async function POST(request) {
  try {
    const body = await request.json();
    const {
      worker_id,
      service_request_id,
      worker_lat,
      worker_lng,
      fuel_type = "petrol",
      litres = 1,
      is_cod = false,
      max_radius_km = 15,
      fallback_to_prepaid = true,
      only_alternatives = false,
      excluded_station_id = null,
    } = body || {};

    if (only_alternatives) {
      if (!worker_lat || !worker_lng) {
        return NextResponse.json({ error: "Location required" }, { status: 400 });
      }
      const alternatives = await getAlternativeFuelStationsConvex({
        worker_lat: Number(worker_lat),
        worker_lng: Number(worker_lng),
        fuel_type,
        litres: Number(litres),
        excluded_station_id,
        max_radius_km: max_radius_km || 20,
        limit: 5,
      });
      return NextResponse.json({ success: true, alternatives });
    }

    if (!worker_id) {
      return NextResponse.json({ error: "worker_id is required" }, { status: 400 });
    }
    if (!service_request_id) {
      return NextResponse.json({ error: "service_request_id is required" }, { status: 400 });
    }
    if (
      worker_lat === null ||
      worker_lat === undefined ||
      worker_lng === null ||
      worker_lng === undefined
    ) {
      return NextResponse.json({ error: "worker_lat and worker_lng are required" }, { status: 400 });
    }

    const cachedAssignment = await convexQuery("fuel_station_ops:getLatestValidCache", {
      service_request_id,
      worker_id,
    });

    if (cachedAssignment) {
      const cacheDistance = haversineDistance(
        Number(cachedAssignment.worker_lat),
        Number(cachedAssignment.worker_lng),
        Number(worker_lat),
        Number(worker_lng)
      );

      if (cacheDistance <= 0.5) {
        const station = await convexQuery("fuel_station_ops:resolveStation", {
          fuel_station_id: cachedAssignment.fuel_station_id,
          user_id: cachedAssignment.fuel_station_id,
        });
        if (station) {
          const mapped = normalizeStationShape(station);
          return NextResponse.json({
            success: true,
            fuel_station_id: mapped.id,
            name: mapped.name,
            lat: mapped.lat,
            lng: mapped.lng,
            distance_km: cachedAssignment.distance_km,
            supports_cod: mapped.cod_supported === true,
            cached: true,
            cached_at: cachedAssignment.assigned_at,
          });
        }
      } else {
        await convexMutation("fuel_station_ops:invalidateCacheForServiceRequest", {
          service_request_id,
        });
      }
    }

    const selection = await selectFuelStationConvex({
      worker_lat: Number(worker_lat),
      worker_lng: Number(worker_lng),
      fuel_type,
      litres: Number(litres),
      is_cod,
      max_radius_km,
      fallback_to_prepaid,
    });

    if (!selection.success) {
      return NextResponse.json(
        {
          success: false,
          error: selection.error,
          details: {
            out_of_stock: selection.out_of_stock || false,
            fallback_station: selection.fallback || null,
          },
        },
        { status: 200 }
      );
    }

    const station = normalizeStationShape(selection.station);

    await convexMutation("fuel_station_ops:createAssignmentAndCache", {
      service_request_id,
      worker_id,
      fuel_station_id: station.id,
      fuel_type,
      litres: Number(litres),
      distance_km: Number(station.distance_km || 0),
      is_cod: Boolean(is_cod),
      supports_cod: Boolean(station.cod_supported),
      worker_lat: Number(worker_lat),
      worker_lng: Number(worker_lng),
    });

    await convexMutation("service_requests:updateStatus", {
      id: service_request_id,
      fuel_station_id: station.id,
    });

    return NextResponse.json({
      success: true,
      fuel_station_id: station.id,
      name: station.name,
      lat: station.lat,
      lng: station.lng,
      distance_km: station.distance_km,
      supports_cod: selection.station.supports_cod === true,
      selected_criteria: selection.selected_criteria,
      cod_fallback: selection.cod_fallback || false,
      message: selection.message || null,
      alternatives: selection.alternatives?.slice(0, 2) || [],
      assignment_id: service_request_id,
    });
  } catch (err) {
    console.error("Fuel station assignment error:", err);
    return NextResponse.json(
      { error: "Failed to assign fuel station", details: err.message },
      { status: 500 }
    );
  }
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const serviceRequestId = url.searchParams.get("service_request_id");

    if (!serviceRequestId) {
      return NextResponse.json(
        { error: "service_request_id query parameter is required" },
        { status: 400 }
      );
    }

    const assignment = await convexQuery("fuel_station_ops:getLatestAssignmentByServiceRequest", {
      service_request_id: serviceRequestId,
    });

    if (!assignment) {
      return NextResponse.json(
        { error: "No fuel station assigned for this service request" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      fuel_station_id: assignment.fuel_station_id,
      name: assignment.station_name,
      lat: assignment.lat,
      lng: assignment.lng,
      distance_km: assignment.distance_km,
      fuel_type: assignment.fuel_type,
      litres: assignment.litres,
      supports_cod: Boolean(assignment.cod_supported),
      payment_mode: assignment.is_cod ? "COD" : "Prepaid",
      status: assignment.status,
      assigned_at: assignment.assigned_at,
    });
  } catch (err) {
    console.error("Get assignment error:", err);
    return NextResponse.json({ error: "Failed to retrieve assignment" }, { status: 500 });
  }
}
