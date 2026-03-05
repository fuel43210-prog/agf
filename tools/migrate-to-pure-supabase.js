#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const rootDir = process.cwd();
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const dryRun = !apply;
const now = new Date().toISOString().replace(/[:.]/g, "-");

const filesToDelete = [
  "database/connectivity-db.js",
  "database/setup-connectivity.js",
  "database/schema.sql",
  "database/schema-mysql.sql",
  "database/migrate-worker-payouts.js",
  "database/migrate-service-requests.js",
  "database/migrate-payments-settlement.js",
  "database/migrate-fuel-stations.js",
  "database/migrate-fuel-station-stock.js",
  "database/fix_fuel_stations_schema.js",
  "database/fix-settlements-schema.js",
  "database/connectivity.db",
  "database/agf_database.db",
];

const pureSupabaseDbJs = `const { Pool } = require("pg");

let dbAdapter;

function readEnv(name) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return "";
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

function assertSupabaseConfig() {
  const hasUrl = Boolean(readEnv("DATABASE_URL"));
  const hasParts = Boolean(readEnv("DB_HOST") && readEnv("DB_USER") && readEnv("DB_NAME"));
  if (hasUrl || hasParts) return;
  throw new Error(
    "Supabase Postgres config missing. Set DATABASE_URL or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME/DB_PORT."
  );
}

function parseQueryArgs(paramsOrCb, cb) {
  const params = typeof paramsOrCb === "function"
    ? []
    : Array.isArray(paramsOrCb)
      ? paramsOrCb
      : paramsOrCb == null
        ? []
        : [paramsOrCb];
  const callback = typeof paramsOrCb === "function"
    ? paramsOrCb
    : typeof cb === "function"
      ? cb
      : () => {};
  return { params, callback };
}

function toPgPlaceholders(sql) {
  let index = 0;
  return String(sql).replace(/\\?/g, () => {
    index += 1;
    return \`$\${index}\`;
  });
}

function stripWrappingQuotes(value) {
  const v = String(value || "").trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'")) ||
    (v.startsWith("\`") && v.endsWith("\`"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

function parsePragmaTableInfo(sql) {
  const m = String(sql).match(/^\\s*PRAGMA\\s+table_info\\(([^)]+)\\)\\s*;?\\s*$/i);
  if (!m) return null;
  const raw = stripWrappingQuotes(m[1]);
  const [schemaPart, tablePart] = raw.includes(".") ? raw.split(".", 2) : ["public", raw];
  return {
    schema: stripWrappingQuotes(schemaPart) || "public",
    table: stripWrappingQuotes(tablePart),
  };
}

function normalizeSqlForPostgres(sql) {
  let text = String(sql || "");
  let convertedInsertIgnore = false;

  text = text.replace(/\\bINTEGER\\s+PRIMARY\\s+KEY\\s+AUTOINCREMENT\\b/gi, "BIGSERIAL PRIMARY KEY");
  text = text.replace(/\\bAUTOINCREMENT\\b/gi, "");
  text = text.replace(/\\bDATETIME\\b/gi, "TIMESTAMP");
  text = text.replace(/\\bdatetime\\('now'\\)\\b/gi, "CURRENT_TIMESTAMP");
  text = text.replace(/\\bINSERT\\s+OR\\s+IGNORE\\s+INTO\\b/gi, () => {
    convertedInsertIgnore = true;
    return "INSERT INTO";
  });

  if (convertedInsertIgnore && !/\\bON\\s+CONFLICT\\b/i.test(text)) {
    const trimmed = text.trim();
    text = trimmed.endsWith(";")
      ? \`\${trimmed.slice(0, -1)} ON CONFLICT DO NOTHING;\`
      : \`\${trimmed} ON CONFLICT DO NOTHING\`;
  }

  return text;
}

function maybeAddReturningClause(sql) {
  const text = String(sql || "");
  if (!/^\\s*INSERT\\s+INTO\\b/i.test(text)) return text;
  if (/\\bRETURNING\\b/i.test(text)) return text;
  const trimmed = text.trim();
  return trimmed.endsWith(";")
    ? \`\${trimmed.slice(0, -1)} RETURNING *;\`
    : \`\${trimmed} RETURNING *\`;
}

function createSupabasePostgresAdapter() {
  assertSupabaseConfig();
  const dbUrlRaw = readEnv("DATABASE_URL");
  const dbHost = readEnv("DB_HOST");
  const isSupabase = /supabase\\.com/i.test(dbUrlRaw) || /supabase\\.com/i.test(dbHost);
  const urlSslMode = (() => {
    try {
      if (!dbUrlRaw) return "";
      return new URL(dbUrlRaw).searchParams.get("sslmode") || "";
    } catch {
      return "";
    }
  })().toLowerCase();

  const sslEnabled =
    readEnv("DB_SSL").toLowerCase() === "true" ||
    /sslmode=require/i.test(dbUrlRaw) ||
    isSupabase ||
    urlSslMode === "require" ||
    urlSslMode === "verify-ca" ||
    urlSslMode === "verify-full" ||
    urlSslMode === "no-verify";

  const rejectUnauthorizedEnv = readEnv("DB_SSL_REJECT_UNAUTHORIZED").toLowerCase();
  const sslCa = readEnv("DB_SSL_CA");
  const strictSsl = readEnv("DB_SSL_STRICT").toLowerCase() === "true";
  const rejectUnauthorized = rejectUnauthorizedEnv
    ? rejectUnauthorizedEnv !== "false"
    : (strictSsl || Boolean(sslCa) ? true : false);
  const ssl = sslEnabled
    ? (sslCa
      ? { rejectUnauthorized, ca: sslCa.replace(/\\\\n/g, "\\n") }
      : { rejectUnauthorized })
    : undefined;

  if (sslEnabled) {
    process.env.PGSSLMODE = rejectUnauthorized ? "verify-full" : "no-verify";
    if (!rejectUnauthorized) {
      delete process.env.PGSSLROOTCERT;
      delete process.env.PGSSLCERT;
      delete process.env.PGSSLKEY;
    }
  }

  const baseConfig = {
    max: Number(readEnv("DB_POOL_SIZE") || 10),
    ssl,
  };

  let poolConfig = null;
  if (dbUrlRaw) {
    try {
      const parsed = new URL(dbUrlRaw);
      poolConfig = {
        ...baseConfig,
        host: parsed.hostname,
        port: Number(parsed.port || 5432),
        user: decodeURIComponent(parsed.username || ""),
        password: decodeURIComponent(parsed.password || ""),
        database: decodeURIComponent((parsed.pathname || "/").replace(/^\\//, "")) || "postgres",
      };
    } catch {
      throw new Error("Invalid DATABASE_URL format. Please provide a valid postgres connection URL.");
    }
  }

  const pool = new Pool(
    poolConfig || {
      ...baseConfig,
      host: readEnv("DB_HOST"),
      user: readEnv("DB_USER"),
      password: readEnv("DB_PASSWORD") || "",
      database: readEnv("DB_NAME"),
      port: Number(readEnv("DB_PORT") || 5432),
    }
  );
  console.log("Connected to Supabase PostgreSQL");

  const adapter = {
    type: "postgres",
    serialize(fn) {
      if (typeof fn === "function") fn();
    },
    prepare(sql) {
      return {
        run(paramsOrCb, cb) {
          return adapter.run(sql, paramsOrCb, cb);
        },
        finalize(cb2) {
          if (typeof cb2 === "function") cb2(null);
        },
      };
    },
    exec(sql, cb) {
      return adapter.run(sql, [], cb);
    },
    run(sql, paramsOrCb, cb) {
      const { params, callback } = parseQueryArgs(paramsOrCb, cb);
      const normalized = normalizeSqlForPostgres(sql);
      const withReturning = maybeAddReturningClause(normalized);
      const text = toPgPlaceholders(withReturning);
      pool.query(text, params)
        .then((result) => {
          const ctx = {
            lastID: result && result.rows && result.rows[0] ? result.rows[0].id : undefined,
            changes: result && typeof result.rowCount === "number" ? result.rowCount : 0,
          };
          callback.call(ctx, null);
        })
        .catch((err) => callback(err));
      return adapter;
    },
    get(sql, paramsOrCb, cb) {
      const { params, callback } = parseQueryArgs(paramsOrCb, cb);
      const pragma = parsePragmaTableInfo(sql);
      if (pragma) {
        const pragmaSql = \`
          SELECT
            (cols.ordinal_position - 1) AS cid,
            cols.column_name AS name,
            cols.data_type AS type,
            CASE WHEN cols.is_nullable = 'NO' THEN 1 ELSE 0 END AS notnull,
            cols.column_default AS dflt_value,
            CASE WHEN tc.constraint_type = 'PRIMARY KEY' THEN 1 ELSE 0 END AS pk
          FROM information_schema.columns cols
          LEFT JOIN information_schema.key_column_usage kcu
            ON kcu.table_schema = cols.table_schema
           AND kcu.table_name = cols.table_name
           AND kcu.column_name = cols.column_name
          LEFT JOIN information_schema.table_constraints tc
            ON tc.constraint_schema = kcu.constraint_schema
           AND tc.table_name = kcu.table_name
           AND tc.constraint_name = kcu.constraint_name
          WHERE cols.table_schema = $1
            AND cols.table_name = $2
          ORDER BY cols.ordinal_position
        \`;
        pool.query(pragmaSql, [pragma.schema, pragma.table])
          .then((result) => callback(null, result.rows && result.rows[0] ? result.rows[0] : undefined))
          .catch((err) => callback(err));
        return adapter;
      }
      const normalized = normalizeSqlForPostgres(sql);
      const text = toPgPlaceholders(normalized);
      pool.query(text, params)
        .then((result) => callback(null, result.rows && result.rows[0] ? result.rows[0] : undefined))
        .catch((err) => callback(err));
      return adapter;
    },
    all(sql, paramsOrCb, cb) {
      const { params, callback } = parseQueryArgs(paramsOrCb, cb);
      const pragma = parsePragmaTableInfo(sql);
      if (pragma) {
        const pragmaSql = \`
          SELECT
            (cols.ordinal_position - 1) AS cid,
            cols.column_name AS name,
            cols.data_type AS type,
            CASE WHEN cols.is_nullable = 'NO' THEN 1 ELSE 0 END AS notnull,
            cols.column_default AS dflt_value,
            CASE WHEN tc.constraint_type = 'PRIMARY KEY' THEN 1 ELSE 0 END AS pk
          FROM information_schema.columns cols
          LEFT JOIN information_schema.key_column_usage kcu
            ON kcu.table_schema = cols.table_schema
           AND kcu.table_name = cols.table_name
           AND kcu.column_name = cols.column_name
          LEFT JOIN information_schema.table_constraints tc
            ON tc.constraint_schema = kcu.constraint_schema
           AND tc.table_name = kcu.table_name
           AND tc.constraint_name = kcu.constraint_name
          WHERE cols.table_schema = $1
            AND cols.table_name = $2
          ORDER BY cols.ordinal_position
        \`;
        pool.query(pragmaSql, [pragma.schema, pragma.table])
          .then((result) => callback(null, result.rows || []))
          .catch((err) => callback(err));
        return adapter;
      }
      const normalized = normalizeSqlForPostgres(sql);
      const text = toPgPlaceholders(normalized);
      pool.query(text, params)
        .then((result) => callback(null, result.rows || []))
        .catch((err) => callback(err));
      return adapter;
    },
    close(cb) {
      pool.end()
        .then(() => {
          if (typeof cb === "function") cb(null);
        })
        .catch((err) => {
          if (typeof cb === "function") cb(err);
        });
    },
  };

  return adapter;
}

function getDB() {
  if (!dbAdapter) {
    dbAdapter = createSupabasePostgresAdapter();
  }
  return dbAdapter;
}

function getLocalDateTimeString(dateObj = new Date()) {
  const d = dateObj;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return \`\${y}-\${m}-\${day} \${h}:\${min}:\${s}\`;
}

function getUTCDateTimeString(dateObj = new Date()) {
  const d = dateObj;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  return \`\${y}-\${m}-\${day} \${h}:\${min}:\${s}\`;
}

module.exports = {
  getDB,
  getLocalDateTimeString,
  getUTCDateTimeString,
};
`;

function ensureDir(dirPath) {
  if (dryRun) return;
  fs.mkdirSync(dirPath, { recursive: true });
}

function readText(relPath) {
  return fs.readFileSync(path.join(rootDir, relPath), "utf8");
}

function writeText(relPath, value) {
  if (dryRun) return;
  fs.writeFileSync(path.join(rootDir, relPath), value, "utf8");
}

function exists(relPath) {
  return fs.existsSync(path.join(rootDir, relPath));
}

function copyFileToBackup(relPath, backupDir) {
  if (!exists(relPath)) return;
  if (dryRun) return;
  const src = path.join(rootDir, relPath);
  const dest = path.join(backupDir, relPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function removeFile(relPath) {
  if (!exists(relPath)) return false;
  if (!dryRun) fs.rmSync(path.join(rootDir, relPath), { force: true });
  return true;
}

function updatePackageJson() {
  const packagePath = "package.json";
  const pkg = JSON.parse(readText(packagePath));
  const deps = { ...(pkg.dependencies || {}) };

  const removed = [];
  ["mysql2", "sqlite3"].forEach((name) => {
    if (deps[name]) {
      delete deps[name];
      removed.push(name);
    }
  });

  pkg.dependencies = deps;
  pkg.scripts = {
    ...(pkg.scripts || {}),
    "db:migrate:supabase:dry": "node tools/migrate-to-pure-supabase.js",
    "db:migrate:supabase": "node tools/migrate-to-pure-supabase.js --apply",
  };

  writeText(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  return removed;
}

function buildReport(changes) {
  const lines = [
    "# Pure Supabase Migration Report",
    "",
    `- Mode: ${dryRun ? "dry-run" : "apply"}`,
    `- Generated at: ${new Date().toISOString()}`,
    "",
    "## Updated files",
    "",
  ];

  if (changes.updated.length === 0) {
    lines.push("- None");
  } else {
    changes.updated.forEach((f) => lines.push(`- ${f}`));
  }

  lines.push("", "## Deleted files", "");
  if (changes.deleted.length === 0) {
    lines.push("- None");
  } else {
    changes.deleted.forEach((f) => lines.push(`- ${f}`));
  }

  lines.push("", "## Removed dependencies", "");
  if (changes.removedDeps.length === 0) {
    lines.push("- None");
  } else {
    changes.removedDeps.forEach((d) => lines.push(`- ${d}`));
  }

  lines.push(
    "",
    "## Notes",
    "",
    "- `database/db.js` is now Postgres-only and intended for Supabase.",
    "- Existing API routes continue using `getDB()` with the same run/get/all interface.",
    "- Review and remove route-level `CREATE TABLE` / `ALTER TABLE` logic later if schema is fully managed in Supabase migrations.",
    ""
  );

  return lines.join("\n");
}

function main() {
  const changes = {
    updated: [],
    deleted: [],
    removedDeps: [],
  };

  const backupDir = path.join(rootDir, "database", "migrations", "backup", now);
  if (!dryRun) ensureDir(backupDir);

  if (exists("database/db.js")) {
    copyFileToBackup("database/db.js", backupDir);
    writeText("database/db.js", pureSupabaseDbJs);
    changes.updated.push("database/db.js");
  }

  copyFileToBackup("package.json", backupDir);
  changes.removedDeps = updatePackageJson();
  changes.updated.push("package.json");

  filesToDelete.forEach((relPath) => {
    if (exists(relPath)) copyFileToBackup(relPath, backupDir);
    const removed = removeFile(relPath);
    if (removed) changes.deleted.push(relPath);
  });

  const report = buildReport(changes);
  writeText("SUPABASE_MIGRATION_REPORT.md", report);
  changes.updated.push("SUPABASE_MIGRATION_REPORT.md");

  console.log(report);
  if (dryRun) {
    console.log("Dry run only. Re-run with --apply to execute changes.");
  } else {
    console.log(`Applied. Backups saved under: ${path.relative(rootDir, backupDir)}`);
  }
}

main();
