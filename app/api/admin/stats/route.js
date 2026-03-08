import { NextResponse } from "next/server";
const { convexQuery } = require("../../../lib/convexServer");

const ANALYTICS_WINDOW_DAYS = 14;
const HEATMAP_MAX_POINTS = 600;

const toDateOnlyString = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const buildDateRange = (days) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dates = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(toDateOnlyString(d));
  }
  return dates;
};

const normalizeMinutes = (value) => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
};

const parseDate = (raw) => {
  if (!raw) return null;
  const d = new Date(String(raw).replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
};

const dayOf = (raw) => {
  const d = parseDate(raw);
  return d ? toDateOnlyString(d) : null;
};

export async function GET(request) {
  try {
    const url = request.url ? new URL(request.url) : null;
    const dateParam = url?.searchParams?.get("date") ?? null;
    const filterByDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam);
    const rangeParam = url?.searchParams?.get("range") || "daily";

    const snap = await convexQuery("admin:getStatsSnapshot", {});
    const users = snap?.users || [];
    const workers = snap?.workers || [];
    const requests = snap?.requests || [];
    const activityRows = snap?.activity || [];
    const stations = (await convexQuery("fuel_stations:list", {})) || [];

    const stationUserIds = new Set(stations.map((s) => String(s.user_id || "")));
    const usersOnly = users.filter(
      (u) => (u.role || "User") === "User" && !stationUserIds.has(String(u._id))
    );
    const usersById = new Map(users.map((u) => [String(u._id), u]));
    const workersById = new Map(workers.map((w) => [String(w._id), w]));

    const totalUsers = usersOnly.length;
    const totalWorkers = workers.length;
    const activeWorkersList = workers
      .filter((w) => ["Available", "Busy"].includes(String(w.status || "")))
      .slice()
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
      .slice(0, 10)
      .map((w) => ({
        id: w._id,
        first_name: w.first_name,
        last_name: w.last_name,
        status: w.status || "Offline",
        latitude: w.latitude,
        longitude: w.longitude,
        service_type: w.service_type,
      }));
    const activeWorkers = activeWorkersList.length;

    const activeRequestsCount = requests.filter((r) =>
      ["Pending", "Assigned", "In Progress"].includes(String(r.status || ""))
    ).length;

    const recentUsers = usersOnly
      .filter((u) => !filterByDate || dayOf(u.created_at) === dateParam)
      .slice()
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
      .slice(0, filterByDate ? 50 : 10)
      .map((u) => ({
        id: u._id,
        email: u.email,
        first_name: u.first_name,
        last_name: u.last_name,
        created_at: u.created_at,
      }));

    const recentWorkersWithDate = workers
      .filter((w) => !filterByDate || dayOf(w.created_at) === dateParam)
      .slice()
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
      .slice(0, filterByDate ? 50 : 10);

    const serviceRequests = requests
      .slice()
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
      .slice(0, 20)
      .map((sr) => {
        const user = usersById.get(String(sr.user_id || ""));
        const worker = workersById.get(String(sr.assigned_worker || ""));
        return {
          id: sr._id,
          user_id: sr.user_id || null,
          vehicle_number: sr.vehicle_number,
          service_type: sr.service_type,
          amount: sr.amount,
          status: sr.status,
          created_at: sr.created_at,
          assigned_at: sr.assigned_at,
          in_progress_at: sr.in_progress_at,
          completed_at: sr.completed_at,
          cancelled_at: sr.cancelled_at,
          user_lat: sr.user_lat,
          user_lon: sr.user_lon,
          assigned_worker: sr.assigned_worker,
          payment_method: sr.payment_method,
          payment_status: sr.payment_status,
          payment_id: sr.payment_id,
          first_name: user?.first_name,
          last_name: user?.last_name,
          phone_number: user?.phone_number,
          worker_first_name: worker?.first_name,
          worker_last_name: worker?.last_name,
          worker_phone: worker?.phone_number,
          worker_status: worker?.status,
          worker_latitude: worker?.latitude,
          worker_longitude: worker?.longitude,
        };
      });

    const activityLog = activityRows
      .filter((a) => !filterByDate || dayOf(a.created_at) === dateParam)
      .slice()
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
      .slice(0, filterByDate ? 50 : 15)
      .map((a) => ({
        id: a._id,
        type: a.type,
        message: a.message,
        created_at: a.created_at,
      }));

    const dateRange = buildDateRange(ANALYTICS_WINDOW_DAYS);
    const requestsByDay = new Map();
    const codFailuresByDay = new Map();
    const etaAgg = new Map();

    requests.forEach((r) => {
      const createdDay = dayOf(r.created_at);
      if (createdDay) requestsByDay.set(createdDay, (requestsByDay.get(createdDay) || 0) + 1);

      if (String(r.payment_status || "") === "FAILED_COD") {
        const failedDay = dayOf(r.cancelled_at || r.created_at);
        if (failedDay) codFailuresByDay.set(failedDay, (codFailuresByDay.get(failedDay) || 0) + 1);
      }

      if (r.completed_at && r.created_at) {
        const start = parseDate(r.created_at);
        const end = parseDate(r.completed_at);
        if (start && end && end >= start) {
          const minutes = (end.getTime() - start.getTime()) / 60000;
          const key = dayOf(r.created_at);
          if (key) {
            const curr = etaAgg.get(key) || { sum: 0, count: 0 };
            curr.sum += minutes;
            curr.count += 1;
            etaAgg.set(key, curr);
          }
        }
      }
    });

    const requestsPerDay = dateRange.map((date) => ({ date, count: requestsByDay.get(date) || 0 }));
    const codFailuresPerDay = dateRange.map((date) => ({ date, count: codFailuresByDay.get(date) || 0 }));
    const avgEtaPerDay = dateRange.map((date) => {
      const row = etaAgg.get(date);
      return { date, minutes: row ? normalizeMinutes(row.sum / row.count) : 0 };
    });
    const etaOverall = (() => {
      let sum = 0;
      let count = 0;
      for (const row of etaAgg.values()) {
        sum += row.sum;
        count += row.count;
      }
      return count ? normalizeMinutes(sum / count) : 0;
    })();

    const statusCounts = { Available: 0, Busy: 0, Offline: 0 };
    workers.forEach((w) => {
      const s = String(w.status || "Offline");
      if (Object.prototype.hasOwnProperty.call(statusCounts, s)) statusCounts[s] += 1;
      else statusCounts.Offline += 1;
    });
    const workerUtilization = Object.entries(statusCounts).map(([status, count]) => ({ status, count }));
    const utilizationPercent = totalWorkers ? Math.round((statusCounts.Busy / totalWorkers) * 100) : 0;

    const cancellationHeat = requests
      .filter((r) => String(r.status || "") === "Cancelled")
      .filter((r) => Number.isFinite(Number(r.user_lat)) && Number.isFinite(Number(r.user_lon)))
      .slice(0, HEATMAP_MAX_POINTS)
      .map((r) => ({ lat: Number(r.user_lat), lng: Number(r.user_lon), intensity: 0.8 }));
    const failureHeat = requests
      .filter((r) => String(r.payment_status || "") === "FAILED_COD")
      .filter((r) => Number.isFinite(Number(r.user_lat)) && Number.isFinite(Number(r.user_lon)))
      .slice(0, HEATMAP_MAX_POINTS)
      .map((r) => ({ lat: Number(r.user_lat), lng: Number(r.user_lon), intensity: 0.9 }));

    const userActivities = recentUsers.map((u) => ({
      type: "user_registered",
      message: `${u.first_name} ${u.last_name} joined the platform`,
      created_at: u.created_at,
      first_name: u.first_name,
      last_name: u.last_name,
    }));
    const workerCreatedActivities = recentWorkersWithDate.map((w) => ({
      type: "worker_created",
      message: `Worker ${w.first_name} ${w.last_name} joined`,
      created_at: w.created_at,
      first_name: w.first_name,
      last_name: w.last_name,
    }));
    const recentActivity = [...userActivities, ...workerCreatedActivities, ...activityLog]
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      .slice(0, 50);

    let rangeStartDate = new Date();
    rangeStartDate.setHours(0, 0, 0, 0);
    if (rangeParam === "weekly") rangeStartDate.setDate(rangeStartDate.getDate() - 7);
    else if (rangeParam === "monthly") rangeStartDate.setDate(rangeStartDate.getDate() - 30);
    else if (rangeParam === "all") rangeStartDate = new Date(0);

    const inRange = (raw) => {
      const d = parseDate(raw);
      return d ? d >= rangeStartDate : false;
    };

    const completedPaid = requests.filter(
      (r) =>
        String(r.status || "") === "Completed" &&
        String(r.payment_status || "") === "PAID" &&
        inRange(r.completed_at)
    );
    const financialStats = completedPaid.reduce(
      (acc, r) => {
        const amount = Number(r.amount || 0);
        if (String(r.payment_method || "").toUpperCase() === "ONLINE") acc.online_earnings += amount;
        if (String(r.payment_method || "").toUpperCase() === "COD") acc.cod_earnings += amount;
        acc.total_earnings += amount;
        return acc;
      },
      { online_earnings: 0, cod_earnings: 0, total_earnings: 0 }
    );

    const workerFinancials = workers.map((w) => {
      const byWorker = completedPaid.filter((r) => String(r.assigned_worker || "") === String(w._id));
      const online_earnings = byWorker
        .filter((r) => String(r.payment_method || "").toUpperCase() === "ONLINE")
        .reduce((s, r) => s + Number(r.amount || 0), 0);
      const cod_earnings = byWorker
        .filter((r) => String(r.payment_method || "").toUpperCase() === "COD")
        .reduce((s, r) => s + Number(r.amount || 0), 0);
      return {
        id: w._id,
        first_name: w.first_name,
        last_name: w.last_name,
        service_type: w.service_type,
        current_float: Number(w.floater_cash || 0),
        online_earnings,
        cod_earnings,
      };
    });

    return NextResponse.json({
      totalUsers,
      totalWorkers,
      activeWorkers,
      activeRequests: activeRequestsCount,
      recentUsers,
      recentActivity,
      activeWorkersList,
      serviceRequests,
      analytics: {
        windowDays: ANALYTICS_WINDOW_DAYS,
        requestsPerDay,
        codFailuresPerDay,
        avgEtaPerDay,
        avgEtaMinutes: etaOverall,
        workerUtilization,
        utilizationPercent,
      },
      heatmaps: {
        cancellations: cancellationHeat,
        failures: failureHeat,
      },
      financials: {
        range: rangeParam,
        totalEarnings: financialStats.total_earnings || 0,
        onlineEarnings: financialStats.online_earnings || 0,
        codEarnings: financialStats.cod_earnings || 0,
        workerFinancials,
      },
    });
  } catch (err) {
    console.error("Admin stats error:", err);
    return NextResponse.json({ error: "Failed to load stats" }, { status: 500 });
  }
}
