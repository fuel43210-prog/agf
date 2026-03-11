const fs = require("fs");
const path = require("path");
const { ConvexHttpClient } = require("convex/browser");

function loadEnvValue(key) {
  const candidates = [".env.local", ".env"];
  for (const filename of candidates) {
    const filePath = path.join(process.cwd(), filename);
    if (!fs.existsSync(filePath)) continue;
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = String(line || "").trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const k = trimmed.slice(0, idx).trim();
      if (k !== key) continue;
      return trimmed.slice(idx + 1).trim();
    }
  }
  return "";
}

async function main() {
  const convexUrl =
    process.env.NEXT_PUBLIC_CONVEX_URL ||
    process.env.CONVEX_URL ||
    loadEnvValue("NEXT_PUBLIC_CONVEX_URL") ||
    loadEnvValue("CONVEX_URL");

  if (!convexUrl) {
    throw new Error("Missing Convex URL. Set NEXT_PUBLIC_CONVEX_URL/CONVEX_URL or add it to .env.local.");
  }

  const client = new ConvexHttpClient(convexUrl);

  const stations = (await client.query("fuel_stations:list", {})) || [];
  if (stations.length === 0) {
    console.log("No fuel stations found in Convex. Create one first, then re-run.");
    return;
  }

  const station = stations[0];
  const stationId = String(station.id || station._id);
  const fuelType = "petrol";
  const litres = 1;

  const beforeStocks = (await client.query("fuel_station_ops:getStocks", { fuel_station_id: stationId })) || [];
  const beforeRow = beforeStocks.find((s) => String(s.fuel_type || "").toLowerCase() === fuelType);
  const beforeLitres = Number(beforeRow?.stock_litres || 0);

  // Ensure enough stock for the test (minimize side effects)
  let didAdjustStock = false;
  if (beforeLitres < litres) {
    await client.mutation("fuel_station_ops:upsertStock", {
      fuel_station_id: stationId,
      fuel_type: fuelType,
      stock_litres: litres,
    });
    didAdjustStock = true;
  }

  const created = await client.mutation("service_requests:create", {
    user_id: undefined,
    vehicle_number: `TEST${Date.now()}`,
    driving_licence: "TESTDL",
    phone_number: "9999999999",
    service_type: fuelType,
    amount: 0,
    status: "Pending",
    fuel_station_id: stationId,
    payment_method: "TEST",
    payment_status: "TEST",
    litres,
    fuel_price: 0,
    user_lat: 0,
    user_lon: 0,
  });

  const requestId = String(created?.id);
  await client.mutation("service_requests:updateStatus", { id: requestId, status: "Completed" });

  const afterStocks = (await client.query("fuel_station_ops:getStocks", { fuel_station_id: stationId })) || [];
  const afterRow = afterStocks.find((s) => String(s.fuel_type || "").toLowerCase() === fuelType);
  const afterLitres = Number(afterRow?.stock_litres || 0);

  const ledger = (await client.query("fuel_station_ops:listLedger", { fuel_station_id: stationId, limit: 20 })) || [];
  const stockDeduct = ledger.find(
    (l) => String(l.transaction_type || "") === "stock_deduct" && String(l.reference_id || "") === requestId
  );

  if (didAdjustStock) {
    await client.mutation("fuel_station_ops:upsertStock", {
      fuel_station_id: stationId,
      fuel_type: fuelType,
      stock_litres: beforeLitres,
    });
  }

  console.log(
    JSON.stringify(
      {
        station_id: stationId,
        request_id: requestId,
        fuel_type: fuelType,
        deducted_litres_expected: litres,
        stock_before: beforeLitres,
        stock_after: afterLitres,
        stock_delta: afterLitres - beforeLitres,
        stock_deduct_ledger_found: Boolean(stockDeduct),
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error("tmp_test_stock.js failed:", e?.message || e);
  process.exitCode = 1;
});
