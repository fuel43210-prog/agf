const fs = require("fs");
const path = require("path");
const sdk = require("node-appwrite");

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function loadEnv() {
  const root = process.cwd();
  parseEnvFile(path.join(root, ".env"));
  parseEnvFile(path.join(root, ".env.local"));
}

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function sanitizeId(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 36);
}

async function createTable(tablesDB, databaseId, name) {
  const tableId = sanitizeId(name);
  try {
    if (typeof tablesDB.createTable === "function") {
      return await tablesDB.createTable({ databaseId, tableId, name });
    }
    throw new Error("No supported createTable method found on TablesDB client.");
  } catch (err) {
    const message = String(err?.message || "");
    if (/already exists|conflict|409/i.test(message)) {
      console.log(`Table exists: ${name} (${tableId})`);
      return null;
    }
    throw err;
  }
}

async function main() {
  loadEnv();

  const endpoint = requiredEnv("NEXT_PUBLIC_APPWRITE_ENDPOINT");
  const projectId = requiredEnv("NEXT_PUBLIC_APPWRITE_PROJECT_ID");
  const apiKey = requiredEnv("APPWRITE_API_KEY");
  const databaseId = requiredEnv("APPWRITE_DATABASE_ID");

  const client = new sdk.Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(apiKey);

  const tablesDB = new sdk.TablesDB(client);

  const tables = [
    "users",
    "workers",
    "service_types",
    "service_requests",
    "connectivity_reports",
    "payments",
    "settlements",
    "platform_settings",
    "fuel_stations",
    "fuel_station_stock",
    "fuel_station_ledger",
    "cod_settlements",
    "activity_log",
    "audit_logs",
    "worker_bank_details",
    "worker_payouts",
    "payout_logs",
    "fuel_station_bank_details",
    "floating_cash_payments",
    "password_resets",
    "cod_settings",
    "service_prices",
    "worker_station_cache",
    "fuel_station_assignments",
  ];

  for (const name of tables) {
    const res = await createTable(tablesDB, databaseId, name);
    if (res) console.log(`Created table: ${name}`);
  }

  console.log("Appwrite table bootstrap complete.");
}

main().catch((err) => {
  console.error("Appwrite table bootstrap failed:", err?.message || err);
  process.exit(1);
});
