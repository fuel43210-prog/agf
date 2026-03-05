// Full schema bootstrap for AGF across Postgres/MySQL/SQLite.
// Run: node database/setup-all.js

const { getDB } = require("./db");

const db = getDB();
const isPostgres = db.type === "postgres";
const isMySQL = db.type === "mysql";

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this || {});
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

function closeDB() {
  return new Promise((resolve) => {
    if (typeof db.close !== "function") return resolve();
    db.close(() => resolve());
  });
}

function idPrimaryKey() {
  if (isPostgres) return "BIGSERIAL PRIMARY KEY";
  if (isMySQL) return "BIGINT PRIMARY KEY AUTO_INCREMENT";
  return "INTEGER PRIMARY KEY AUTOINCREMENT";
}

function isDuplicateColumnError(err) {
  return /(duplicate column|already exists|42701|ER_DUP_FIELDNAME)/i.test(String(err?.message || ""));
}

async function addColumnIfMissing(table, columnDef) {
  try {
    await run(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch (err) {
    if (!isDuplicateColumnError(err)) {
      throw err;
    }
  }
}

async function createCoreTables() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id ${idPrimaryKey()},
      email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      first_name VARCHAR(100) NOT NULL,
      last_name VARCHAR(100) NOT NULL,
      phone_number VARCHAR(20) NOT NULL,
      driving_licence VARCHAR(100),
      role VARCHAR(20) DEFAULT 'User',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS workers (
      id ${idPrimaryKey()},
      email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      first_name VARCHAR(100) NOT NULL,
      last_name VARCHAR(100) NOT NULL,
      phone_number VARCHAR(20),
      status VARCHAR(20) DEFAULT 'Available',
      service_type VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS service_types (
      id ${idPrimaryKey()},
      code VARCHAR(50) UNIQUE NOT NULL,
      label VARCHAR(100) NOT NULL,
      amount INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const serviceTypes = [
    ["petrol", "Petrol", 100],
    ["diesel", "Diesel", 150],
    ["crane", "Crane", 200],
    ["mechanic_bike", "Mechanic (Bike)", 300],
    ["mechanic_car", "Mechanic (Car)", 300],
  ];
  for (const [code, label, amount] of serviceTypes) {
    const clause = isPostgres
      ? "ON CONFLICT (code) DO NOTHING"
      : isMySQL
        ? "ON DUPLICATE KEY UPDATE code = code"
        : "ON CONFLICT DO NOTHING";
    await run(
      `INSERT INTO service_types (code, label, amount) VALUES (?, ?, ?) ${clause}`,
      [code, label, amount]
    );
  }

  await run(`
    CREATE TABLE IF NOT EXISTS service_requests (
      id ${idPrimaryKey()},
      user_id INTEGER,
      vehicle_number VARCHAR(50) NOT NULL,
      driving_licence VARCHAR(100) NOT NULL,
      phone_number VARCHAR(20) NOT NULL,
      service_type VARCHAR(50) NOT NULL,
      amount INTEGER NOT NULL,
      status VARCHAR(20) DEFAULT 'Pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS connectivity_reports (
      id ${idPrimaryKey()},
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      severity VARCHAR(20) NOT NULL,
      effective_type VARCHAR(50),
      downlink REAL,
      rtt INTEGER,
      failures INTEGER DEFAULT 0,
      offline INTEGER DEFAULT 0,
      reported_at TIMESTAMP NOT NULL
    )
  `);
}

async function createFinanceAndStationTables() {
  await run(`
    CREATE TABLE IF NOT EXISTS payments (
      id ${idPrimaryKey()},
      service_request_id INTEGER NOT NULL,
      provider VARCHAR(50) NOT NULL,
      provider_payment_id VARCHAR(128),
      amount INTEGER NOT NULL,
      currency VARCHAR(10) DEFAULT 'INR',
      status VARCHAR(30) DEFAULT 'created',
      metadata TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (service_request_id) REFERENCES service_requests(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS settlements (
      id ${idPrimaryKey()},
      service_request_id INTEGER,
      worker_id INTEGER,
      fuel_station_id INTEGER,
      settlement_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      customer_amount INTEGER NOT NULL,
      fuel_cost INTEGER NOT NULL,
      delivery_fee INTEGER NOT NULL,
      platform_service_fee INTEGER NOT NULL,
      surge_fee INTEGER DEFAULT 0,
      fuel_station_payout INTEGER NOT NULL,
      worker_payout REAL NOT NULL,
      platform_profit INTEGER NOT NULL,
      worker_base_pay REAL DEFAULT 0,
      worker_distance_km REAL DEFAULT 0,
      worker_distance_pay REAL DEFAULT 0,
      worker_surge_bonus REAL DEFAULT 0,
      worker_waiting_time_bonus REAL DEFAULT 0,
      worker_incentive_bonus REAL DEFAULT 0,
      worker_penalty REAL DEFAULT 0,
      worker_minimum_guarantee REAL DEFAULT 0,
      status VARCHAR(30) DEFAULT 'calculated',
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (service_request_id) REFERENCES service_requests(id),
      FOREIGN KEY (worker_id) REFERENCES workers(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      id INTEGER PRIMARY KEY,
      delivery_fee_base INTEGER DEFAULT 50,
      platform_service_fee_percentage REAL DEFAULT 5,
      surge_enabled INTEGER DEFAULT 1,
      surge_night_start VARCHAR(5) DEFAULT '21:00',
      surge_night_end VARCHAR(5) DEFAULT '06:00',
      surge_night_multiplier REAL DEFAULT 1.5,
      surge_rain_multiplier REAL DEFAULT 1.3,
      surge_emergency_multiplier REAL DEFAULT 2.0,
      platform_margin_target_percentage REAL DEFAULT 15,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const settings = await get("SELECT id FROM platform_settings WHERE id = 1");
  if (!settings) await run("INSERT INTO platform_settings (id) VALUES (1)");

  await run(`
    CREATE TABLE IF NOT EXISTS fuel_stations (
      id ${idPrimaryKey()},
      user_id INTEGER UNIQUE,
      station_name VARCHAR(255),
      email VARCHAR(255) UNIQUE,
      phone_number VARCHAR(20),
      address TEXT,
      latitude REAL,
      longitude REAL,
      cod_enabled INTEGER DEFAULT 1,
      cod_current_balance REAL DEFAULT 0,
      cod_balance_limit REAL DEFAULT 50000,
      is_verified INTEGER DEFAULT 0,
      is_open INTEGER DEFAULT 1,
      platform_trust_flag INTEGER DEFAULT 0,
      total_earnings REAL DEFAULT 0,
      pending_payout REAL DEFAULT 0,
      last_stock_update TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS fuel_station_stock (
      id ${idPrimaryKey()},
      fuel_station_id INTEGER NOT NULL,
      fuel_type VARCHAR(50) NOT NULL,
      stock_litres REAL DEFAULT 0,
      last_refilled_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(fuel_station_id, fuel_type),
      FOREIGN KEY (fuel_station_id) REFERENCES fuel_stations(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS fuel_station_ledger (
      id ${idPrimaryKey()},
      fuel_station_id INTEGER NOT NULL,
      settlement_id INTEGER,
      transaction_type VARCHAR(50) NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      running_balance REAL DEFAULT 0,
      status VARCHAR(30) DEFAULT 'pending',
      reference_id VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (fuel_station_id) REFERENCES fuel_stations(id),
      FOREIGN KEY (settlement_id) REFERENCES settlements(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS cod_settlements (
      id ${idPrimaryKey()},
      service_request_id INTEGER NOT NULL,
      fuel_station_id INTEGER NOT NULL,
      worker_id INTEGER NOT NULL,
      customer_paid_amount REAL NOT NULL,
      fuel_cost REAL NOT NULL,
      fuel_station_payout REAL NOT NULL,
      platform_fee REAL DEFAULT 0,
      collection_method VARCHAR(50) DEFAULT 'pending',
      payment_status VARCHAR(30) DEFAULT 'pending',
      collected_at TIMESTAMP,
      settled_at TIMESTAMP,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (service_request_id) REFERENCES service_requests(id),
      FOREIGN KEY (fuel_station_id) REFERENCES fuel_stations(id),
      FOREIGN KEY (worker_id) REFERENCES workers(id)
    )
  `);
}

async function createOpsTables() {
  await run(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id ${idPrimaryKey()},
      type VARCHAR(50) NOT NULL,
      message TEXT,
      entity_type VARCHAR(50),
      entity_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id ${idPrimaryKey()},
      action VARCHAR(100) NOT NULL,
      entity_type VARCHAR(50) NOT NULL,
      entity_id INTEGER NOT NULL,
      user_id INTEGER,
      user_role VARCHAR(50),
      old_values TEXT,
      new_values TEXT,
      ip_address VARCHAR(50),
      user_agent TEXT,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS worker_bank_details (
      id ${idPrimaryKey()},
      worker_id INTEGER NOT NULL UNIQUE,
      account_holder_name TEXT,
      account_number TEXT,
      ifsc_code TEXT,
      bank_name TEXT,
      is_bank_verified INTEGER DEFAULT 0,
      razorpay_contact_id TEXT,
      razorpay_fund_account_id TEXT,
      rejection_reason TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (worker_id) REFERENCES workers(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS worker_payouts (
      id ${idPrimaryKey()},
      worker_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      reference_id VARCHAR(100),
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (worker_id) REFERENCES workers(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS payout_logs (
      id ${idPrimaryKey()},
      worker_id INTEGER NOT NULL,
      payout_id VARCHAR(100),
      amount REAL NOT NULL,
      currency VARCHAR(10) DEFAULT 'INR',
      status VARCHAR(50) DEFAULT 'processing',
      error_message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (worker_id) REFERENCES workers(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS fuel_station_bank_details (
      id ${idPrimaryKey()},
      fuel_station_id INTEGER NOT NULL UNIQUE,
      account_holder_name TEXT NOT NULL,
      account_number TEXT NOT NULL,
      ifsc_code TEXT NOT NULL,
      bank_name TEXT NOT NULL,
      razorpay_contact_id TEXT,
      razorpay_fund_account_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (fuel_station_id) REFERENCES fuel_stations(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS floating_cash_payments (
      id ${idPrimaryKey()},
      worker_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      amount_paise INTEGER NOT NULL,
      purpose VARCHAR(50) NOT NULL DEFAULT 'FLOATING_CASH_CLEAR',
      razorpay_order_id VARCHAR(128) UNIQUE,
      razorpay_payment_id VARCHAR(128),
      razorpay_signature TEXT,
      status VARCHAR(30) NOT NULL DEFAULT 'created',
      failure_reason TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (worker_id) REFERENCES workers(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id ${idPrimaryKey()},
      user_id INTEGER,
      account_type VARCHAR(20) DEFAULT 'users',
      account_id INTEGER,
      token VARCHAR(128) NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      consumed_at TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS cod_settings (
      id INTEGER PRIMARY KEY,
      cod_limit INTEGER DEFAULT 500,
      trust_threshold REAL DEFAULT 50,
      max_failures INTEGER DEFAULT 3,
      disable_days INTEGER DEFAULT 7
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS service_prices (
      id ${idPrimaryKey()},
      service_type VARCHAR(50) UNIQUE NOT NULL,
      amount INTEGER NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const priceDefaults = [
    ["petrol", 100],
    ["diesel", 100],
    ["crane", 1500],
    ["mechanic_bike", 500],
    ["mechanic_car", 1200],
  ];
  for (const [serviceType, amount] of priceDefaults) {
    const clause = isPostgres
      ? "ON CONFLICT (service_type) DO NOTHING"
      : isMySQL
        ? "ON DUPLICATE KEY UPDATE service_type = service_type"
        : "ON CONFLICT DO NOTHING";
    await run(
      `INSERT INTO service_prices (service_type, amount, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ${clause}`,
      [serviceType, amount]
    );
  }

  await run(`
    CREATE TABLE IF NOT EXISTS worker_station_cache (
      id ${idPrimaryKey()},
      worker_id INTEGER NOT NULL,
      service_request_id INTEGER NOT NULL,
      fuel_station_id INTEGER NOT NULL,
      assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      worker_lat REAL,
      worker_lng REAL,
      distance_km REAL,
      is_valid INTEGER DEFAULT 1,
      invalidated_at TIMESTAMP,
      FOREIGN KEY (worker_id) REFERENCES workers(id),
      FOREIGN KEY (service_request_id) REFERENCES service_requests(id),
      FOREIGN KEY (fuel_station_id) REFERENCES fuel_stations(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS fuel_station_assignments (
      id ${idPrimaryKey()},
      service_request_id INTEGER NOT NULL,
      worker_id INTEGER NOT NULL,
      fuel_station_id INTEGER NOT NULL,
      fuel_type VARCHAR(50) NOT NULL,
      litres REAL NOT NULL,
      distance_km REAL NOT NULL,
      is_cod INTEGER DEFAULT 0,
      supports_cod INTEGER DEFAULT 0,
      assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      picked_up_at TIMESTAMP,
      status VARCHAR(30) DEFAULT 'assigned',
      rejection_reason VARCHAR(200),
      reassignment_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (service_request_id) REFERENCES service_requests(id),
      FOREIGN KEY (worker_id) REFERENCES workers(id),
      FOREIGN KEY (fuel_station_id) REFERENCES fuel_stations(id)
    )
  `);
}

async function addCompatibilityColumns() {
  const userCols = [
    "trust_score REAL DEFAULT 50",
    "cod_success_count INTEGER DEFAULT 0",
    "cod_failure_count INTEGER DEFAULT 0",
    "cod_last_failure_reason VARCHAR(200)",
    "cod_disabled INTEGER DEFAULT 0",
    "cod_disabled_until TIMESTAMP",
  ];
  for (const col of userCols) await addColumnIfMissing("users", col);

  const workerCols = [
    "latitude REAL",
    "longitude REAL",
    "verified INTEGER DEFAULT 0",
    "status_locked INTEGER DEFAULT 0",
    "floater_cash REAL DEFAULT 0",
    "last_cash_collection_at TIMESTAMP",
    "lock_reason TEXT",
    "license_photo TEXT",
    "self_photo TEXT",
    "docs_submitted_at TIMESTAMP",
    "pending_balance REAL DEFAULT 0",
    "last_payout_at TIMESTAMP",
  ];
  for (const col of workerCols) await addColumnIfMissing("workers", col);

  const serviceRequestCols = [
    "fuel_station_id INTEGER",
    "fuel_price_per_litre REAL",
    "litres REAL",
    "settlement_id INTEGER",
    "distance_km REAL",
    "waiting_time_minutes INTEGER DEFAULT 0",
    "delivery_fee_override INTEGER",
    "platform_service_fee_override INTEGER",
    "surge_fee_override INTEGER",
    "completed_delivery_count INTEGER DEFAULT 0",
    "payment_method VARCHAR(20) DEFAULT 'ONLINE'",
    "payment_status VARCHAR(30) DEFAULT 'PAID'",
    "cod_failure_reason VARCHAR(200)",
    "payment_id VARCHAR(100)",
    "payment_details TEXT",
    "user_lat REAL",
    "user_lon REAL",
    "assigned_worker INTEGER",
    "assigned_at TIMESTAMP",
    "in_progress_at TIMESTAMP",
    "completed_at TIMESTAMP",
    "cancelled_at TIMESTAMP",
    "rating INTEGER",
    "review_comment TEXT",
  ];
  for (const col of serviceRequestCols) await addColumnIfMissing("service_requests", col);

  const fuelStationCols = [
    "cod_supported INTEGER DEFAULT 1",
    "cod_delivery_allowed INTEGER DEFAULT 1",
    "max_queue_time_minutes INTEGER DEFAULT 30",
    "average_service_time_minutes INTEGER DEFAULT 5",
  ];
  for (const col of fuelStationCols) await addColumnIfMissing("fuel_stations", col);
}

async function createIndexes() {
  const indexes = [
    ["idx_users_email", "users", "email"],
    ["idx_workers_email", "workers", "email"],
    ["idx_workers_status", "workers", "status"],
    ["idx_connectivity_reports_time", "connectivity_reports", "reported_at"],
    ["idx_connectivity_reports_latlng", "connectivity_reports", "lat, lng"],
    ["idx_service_types_code", "service_types", "code"],
    ["idx_service_requests_user_id", "service_requests", "user_id"],
    ["idx_service_requests_status", "service_requests", "status"],
    ["idx_service_requests_created_at", "service_requests", "created_at"],
    ["idx_fuel_stations_user_id", "fuel_stations", "user_id"],
    ["idx_fuel_station_stock_station", "fuel_station_stock", "fuel_station_id"],
    ["idx_fuel_station_ledger_station", "fuel_station_ledger", "fuel_station_id"],
    ["idx_payments_status", "payments", "status"],
    ["idx_settlements_worker", "settlements", "worker_id"],
    ["idx_settlements_station", "settlements", "fuel_station_id"],
    ["idx_worker_payouts_worker", "worker_payouts", "worker_id"],
    ["idx_payout_logs_worker", "payout_logs", "worker_id"],
    ["idx_activity_log_created", "activity_log", "created_at"],
  ];
  for (const [name, table, cols] of indexes) {
    try {
      await run(`CREATE INDEX IF NOT EXISTS ${name} ON ${table}(${cols})`);
    } catch {
      // Skip index errors for cross-engine compatibility.
    }
  }
}

async function setupAll() {
  try {
    await createCoreTables();
    await createFinanceAndStationTables();
    await createOpsTables();
    await addCompatibilityColumns();
    await createIndexes();
    console.log(`Full database bootstrap complete using ${db.type}.`);
  } catch (err) {
    console.error("Full database bootstrap failed:", err.message);
    process.exitCode = 1;
  } finally {
    await closeDB();
  }
}

setupAll();
