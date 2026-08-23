/**
 * db.js — PostgreSQL edition
 * ใช้ pg (node-postgres) แทน JSON file เดิม
 * Export API เหมือนเดิมทุกฟังก์ชัน — ไฟล์อื่นไม่ต้องแก้
 *
 * .env ที่ต้องเพิ่ม:
 *   DATABASE_URL=postgresql://user:password@host:5432/dbname
 *   (หรือตั้งเป็น PGHOST/PGUSER/PGPASSWORD/PGDATABASE แยกก็ได้)
 */

const { Pool } = require("pg");
const crypto = require("crypto");
const { PROVIDERS } = require("../config/pricing");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on("error", (err) => console.error("pg pool error:", err));

async function q(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

function round(n) {
  return Math.round(n * 1e6) / 1e6;
}

// ===== Schema bootstrap =====
async function initDb() {
  await q(`
    CREATE TABLE IF NOT EXISTS api_keys (
      api_key             TEXT PRIMARY KEY,
      name                TEXT NOT NULL DEFAULT 'unnamed',
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      daily_budget_usd    NUMERIC(12,6) NOT NULL DEFAULT 1.0,
      monthly_budget_usd  NUMERIC(12,6) NOT NULL DEFAULT 10.0,
      requests_per_minute INT NOT NULL DEFAULT 10
    );

    CREATE TABLE IF NOT EXISTS usage_log (
      id              BIGSERIAL PRIMARY KEY,
      api_key         TEXT NOT NULL REFERENCES api_keys(api_key) ON DELETE CASCADE,
      ts              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      provider        TEXT,
      model           TEXT,
      input_tokens    INT NOT NULL DEFAULT 0,
      output_tokens   INT NOT NULL DEFAULT 0,
      usd_total       NUMERIC(14,8) NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS usage_log_api_key_ts ON usage_log (api_key, ts DESC);
    CREATE INDEX IF NOT EXISTS usage_log_ts         ON usage_log (ts DESC);

    CREATE TABLE IF NOT EXISTS conversations (
      id          TEXT PRIMARY KEY,
      api_key     TEXT NOT NULL REFERENCES api_keys(api_key) ON DELETE CASCADE,
      provider    TEXT,
      model       TEXT,
      title       TEXT NOT NULL DEFAULT 'แชทใหม่',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      messages    JSONB NOT NULL DEFAULT '[]'
    );

    CREATE INDEX IF NOT EXISTS conversations_api_key ON conversations (api_key, updated_at DESC);

    CREATE TABLE IF NOT EXISTS users (
      username      TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      salt          TEXT NOT NULL,
      api_key       TEXT NOT NULL REFERENCES api_keys(api_key) ON DELETE CASCADE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id            BIGSERIAL PRIMARY KEY,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      event_type    TEXT NOT NULL,
      severity      TEXT NOT NULL DEFAULT 'info',
      username      TEXT,
      ip_address    TEXT,
      method        TEXT,
      path          TEXT,
      status_code   INT,
      metadata      JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS audit_logs_created_at ON audit_logs (created_at DESC);
    CREATE INDEX IF NOT EXISTS audit_logs_event_type ON audit_logs (event_type, created_at DESC);

    CREATE TABLE IF NOT EXISTS purchase_orders (
      id TEXT PRIMARY KEY, api_key TEXT NOT NULL REFERENCES api_keys(api_key) ON DELETE CASCADE,
      kind TEXT NOT NULL, tier TEXT, provider TEXT, model TEXT,
      input_tokens BIGINT NOT NULL DEFAULT 0, output_tokens BIGINT NOT NULL DEFAULT 0,
      amount_usd NUMERIC(14,6) NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS model_status (
      provider TEXT NOT NULL, model TEXT NOT NULL, online BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (provider, model)
    );
    CREATE TABLE IF NOT EXISTS model_entitlements (
      api_key TEXT NOT NULL REFERENCES api_keys(api_key) ON DELETE CASCADE,
      provider TEXT NOT NULL, model TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (api_key, provider, model)
    );
    CREATE TABLE IF NOT EXISTS offer_claims (
      api_key TEXT NOT NULL REFERENCES api_keys(api_key) ON DELETE CASCADE,
      offer_code TEXT NOT NULL, decision TEXT NOT NULL, terms_accepted BOOLEAN NOT NULL DEFAULT FALSE,
      privacy_accepted BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (api_key, offer_code)
    );
    CREATE TABLE IF NOT EXISTS model_token_balances (
      api_key TEXT NOT NULL REFERENCES api_keys(api_key) ON DELETE CASCADE,
      provider TEXT NOT NULL, model TEXT NOT NULL, source TEXT NOT NULL,
      tokens BIGINT NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (api_key, provider, model, source)
    );
    CREATE INDEX IF NOT EXISTS purchase_orders_api_key_created_at ON purchase_orders (api_key, created_at DESC);
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS amount_thb NUMERIC(12,2) NOT NULL DEFAULT 0;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS slip_data BYTEA;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS slip_mime TEXT;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS review_note TEXT;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
    ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS account_tier TEXT NOT NULL DEFAULT 'free';
    ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS token_balance BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS token_plan_limit BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS token_plan_started_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_consent BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (LOWER(email)) WHERE email IS NOT NULL AND email <> '';
  `);

  for (const [provider, config] of Object.entries(PROVIDERS)) {
    for (const model of Object.keys(config.models)) {
      await q("INSERT INTO model_status (provider, model, online) VALUES ($1, $2, TRUE) ON CONFLICT DO NOTHING", [provider, model]);
    }
  }

  const { rowCount } = await q("SELECT 1 FROM api_keys LIMIT 1");
  if (rowCount === 0) {
    await q(`
      INSERT INTO api_keys (api_key, name, daily_budget_usd, monthly_budget_usd, requests_per_minute)
      VALUES ('demo-key-123', 'demo user', 1.0, 10.0, 10)
      ON CONFLICT DO NOTHING
    `);
    console.log("seeded demo-key-123");
  }
  console.log("PostgreSQL schema ready");
}

// ===== API Keys =====

async function getKeyRecord(apiKey) {
  const { rows } = await q("SELECT * FROM api_keys WHERE api_key = $1", [apiKey]);
  if (!rows[0]) return null;
  const r = rows[0];
  const { rows: entitlementRows } = await q("SELECT provider, model FROM model_entitlements WHERE api_key=$1", [apiKey]);
  return {
    name: r.name,
    createdAt: r.created_at,
    dailyBudgetUSD: Number(r.daily_budget_usd),
    monthlyBudgetUSD: Number(r.monthly_budget_usd),
    requestsPerMinute: r.requests_per_minute,
    tier: r.account_tier || "free",
    tokenBalance: Number(r.token_balance || 0),
    tokenPlanLimit: Number(r.token_plan_limit || 0),
    tokenPlanStartedAt: r.token_plan_started_at,
    purchasedModels: entitlementRows.map((row) => `${row.provider}/${row.model}`),
  };
}

async function createKey(apiKey, opts = {}) {
  const { rows } = await q(
    `INSERT INTO api_keys (api_key, name, daily_budget_usd, monthly_budget_usd, requests_per_minute)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [apiKey, opts.name || "unnamed", opts.dailyBudgetUSD ?? 1.0,
     opts.monthlyBudgetUSD ?? 10.0, opts.requestsPerMinute ?? 10]
  );
  return rows[0];
}

async function updateKeyLimits(apiKey, patch) {
  const sets = [];
  const vals = [apiKey];
  if (patch.name !== undefined)               { vals.push(patch.name);              sets.push(`name = $${vals.length}`); }
  if (patch.dailyBudgetUSD !== undefined)     { vals.push(patch.dailyBudgetUSD);    sets.push(`daily_budget_usd = $${vals.length}`); }
  if (patch.monthlyBudgetUSD !== undefined)   { vals.push(patch.monthlyBudgetUSD);  sets.push(`monthly_budget_usd = $${vals.length}`); }
  if (patch.requestsPerMinute !== undefined)  { vals.push(patch.requestsPerMinute); sets.push(`requests_per_minute = $${vals.length}`); }
  if (sets.length === 0) return null;
  const { rows } = await q(
    `UPDATE api_keys SET ${sets.join(", ")} WHERE api_key = $1 RETURNING *`,
    vals
  );
  return rows[0] || null;
}
async function listAccounts() {
  const { rows } = await q("SELECT api_key, name, account_tier, created_at FROM api_keys ORDER BY created_at DESC");
  return rows.map(r => ({ apiKey: r.api_key, name: r.name, tier: r.account_tier, createdAt: r.created_at }));
}
async function setAccountTier(apiKey, tier) {
  const { rows } = await q("UPDATE api_keys SET account_tier=$2 WHERE api_key=$1 RETURNING api_key,name,account_tier", [apiKey, tier]);
  return rows[0] || null;
}

async function deleteKey(apiKey) {
  const { rowCount } = await q("DELETE FROM api_keys WHERE api_key = $1", [apiKey]);
  return rowCount > 0;
}

// ===== Usage =====

async function recordUsage(apiKey, entry) {
  await q(
    `INSERT INTO usage_log (api_key, ts, provider, model, input_tokens, output_tokens, usd_total)
     VALUES ($1, to_timestamp($2 / 1000.0), $3, $4, $5, $6, $7)`,
    [apiKey, entry.ts || Date.now(), entry.provider || null, entry.model || null,
     entry.inputTokens || 0, entry.outputTokens || 0, entry.usdTotal || 0]
  );
}

async function consumeTokens(apiKey, amount, provider = null, model = null) {
  const tokens = Math.max(0, Math.floor(Number(amount) || 0));
  if (provider && model) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const grants = await client.query("SELECT source,tokens FROM model_token_balances WHERE api_key=$1 AND provider=$2 AND model=$3 AND tokens>0 ORDER BY CASE source WHEN 'offer' THEN 0 ELSE 1 END FOR UPDATE", [apiKey, provider, model]);
      let remaining = tokens;
      for (const grant of grants.rows) {
        const take = Math.min(remaining, Number(grant.tokens));
        if (take) { await client.query("UPDATE model_token_balances SET tokens=tokens-$5,updated_at=NOW() WHERE api_key=$1 AND provider=$2 AND model=$3 AND source=$4", [apiKey, provider, model, grant.source, take]); remaining -= take; }
        if (!remaining) break;
      }
      if (remaining) {
        const fallback = await client.query("UPDATE api_keys SET token_balance=token_balance-$2 WHERE api_key=$1 AND token_balance >= $2 RETURNING token_balance", [apiKey, remaining]);
        if (!fallback.rowCount) { await client.query("ROLLBACK"); return null; }
      }
      await client.query("COMMIT");
      return true;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  const { rows } = await q(
    "UPDATE api_keys SET token_balance=token_balance-$2 WHERE api_key=$1 AND token_balance >= $2 RETURNING token_balance",
    [apiKey, tokens]
  );
  return rows[0] ? Number(rows[0].token_balance) : null;
}

async function refundTokens(apiKey, amount, provider = null, model = null) {
  const tokens = Math.max(0, Math.floor(Number(amount) || 0));
  if (!tokens) return;
  if (provider && model) {
    const { rows } = await q("SELECT source FROM model_token_balances WHERE api_key=$1 AND provider=$2 AND model=$3 ORDER BY CASE source WHEN 'offer' THEN 0 ELSE 1 END LIMIT 1", [apiKey, provider, model]);
    if (rows[0]) { await q("UPDATE model_token_balances SET tokens=tokens+$5,updated_at=NOW() WHERE api_key=$1 AND provider=$2 AND model=$3 AND source=$4", [apiKey, provider, model, rows[0].source, tokens]); return; }
  }
  await q("UPDATE api_keys SET token_balance=token_balance+$2 WHERE api_key=$1", [apiKey, tokens]);
}

async function getOfferStatus(apiKey, offerCode) {
  const { rows } = await q("SELECT decision,terms_accepted,privacy_accepted,created_at FROM offer_claims WHERE api_key=$1 AND offer_code=$2", [apiKey, offerCode]);
  return rows[0] || null;
}

async function claimOffer(apiKey, offerCode, decision, termsAccepted = false, privacyAccepted = false) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT decision FROM offer_claims WHERE api_key=$1 AND offer_code=$2 FOR UPDATE", [apiKey, offerCode]);
    if (existing.rowCount) { await client.query("ROLLBACK"); return { decision: existing.rows[0].decision, alreadyDecided: true }; }
    await client.query("INSERT INTO offer_claims (api_key,offer_code,decision,terms_accepted,privacy_accepted) VALUES ($1,$2,$3,$4,$5)", [apiKey, offerCode, decision, termsAccepted, privacyAccepted]);
    if (decision === "accepted") {
      await client.query("INSERT INTO model_token_balances (api_key,provider,model,source,tokens) VALUES ($1,'openai','gpt-5.6-terra','offer',$2)", [apiKey, 100000]);
      await client.query("INSERT INTO model_entitlements (api_key,provider,model) VALUES ($1,'openai','gpt-5.6-terra') ON CONFLICT DO NOTHING", [apiKey]);
    }
    await client.query("COMMIT");
    return { decision, tokens: decision === "accepted" ? 100000 : 0 };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

async function getModelTokenBalances(apiKey) {
  const { rows } = await q("SELECT provider,model,source,tokens,updated_at FROM model_token_balances WHERE api_key=$1 AND tokens>0 ORDER BY provider,model,source", [apiKey]);
  return rows.map(row => ({ provider: row.provider, model: row.model, source: row.source, tokens: Number(row.tokens), updatedAt: row.updated_at }));
}

async function sumUsageSince(apiKey, sinceTs) {
  const { rows } = await q(
    `SELECT COALESCE(SUM(usd_total), 0) AS usd_total, COUNT(*) AS requests
     FROM usage_log WHERE api_key = $1 AND ts >= to_timestamp($2 / 1000.0)`,
    [apiKey, sinceTs]
  );
  return { usdTotal: round(Number(rows[0].usd_total)), requests: Number(rows[0].requests) };
}

// ===== Admin logs =====

function maskApiKey(key) {
  if (!key || key.length < 14) return "****";
  return key.slice(0, 10) + "..." + key.slice(-4);
}

async function getAllLogs({ limit = 100, offset = 0, apiKey, provider, model } = {}) {
  const clampedLimit  = Math.min(Math.max(Number(limit)  || 100, 1), 500);
  const clampedOffset = Math.max(Number(offset) || 0, 0);

  const wheres = [];
  const vals   = [];
  if (apiKey)   { vals.push(apiKey);           wheres.push(`u.api_key = $${vals.length}`); }
  if (provider) { vals.push(provider);         wheres.push(`u.provider = $${vals.length}`); }
  if (model)    { vals.push(`%${model}%`);     wheres.push(`u.model ILIKE $${vals.length}`); }
  const where = wheres.length ? "WHERE " + wheres.join(" AND ") : "";

  const countRes = await q(`SELECT COUNT(*) FROM usage_log u ${where}`, vals);
  const total = Number(countRes.rows[0].count);

  const dataVals = [...vals, clampedLimit, clampedOffset];
  const dataRes  = await q(
    `SELECT
       EXTRACT(EPOCH FROM u.ts) * 1000 AS ts,
       u.api_key, k.name, u.provider, u.model,
       u.input_tokens, u.output_tokens,
       (u.input_tokens + u.output_tokens) AS total_tokens, u.usd_total
     FROM usage_log u
     JOIN api_keys k ON k.api_key = u.api_key
     ${where}
     ORDER BY u.ts DESC
     LIMIT $${dataVals.length - 1} OFFSET $${dataVals.length}`,
    dataVals
  );

  return {
    logs: dataRes.rows.map((r) => ({
      ts:           Number(r.ts),
      apiKeyMasked: maskApiKey(r.api_key),
      name:         r.name || "unnamed",
      provider:     r.provider || "unknown",
      model:        r.model || "unknown",
      inputTokens:  Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      totalTokens:  Number(r.total_tokens),
      usdTotal:     round(Number(r.usd_total)),
    })),
    total, limit: clampedLimit, offset: clampedOffset,
  };
}

async function logAuditEvent({ eventType, severity = "info", username = null, ipAddress = null, method = null, path = null, statusCode = null, metadata = {} }) {
  await q(
    `INSERT INTO audit_logs (event_type, severity, username, ip_address, method, path, status_code, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [eventType, severity, username, ipAddress, method, path, statusCode, JSON.stringify(metadata)]
  );
}

async function getAuditLogs({ limit = 100, afterId = 0 } = {}) {
  const clampedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const { rows } = await q(
    `SELECT id, created_at, event_type, severity, username, ip_address, method, path, status_code, metadata
     FROM audit_logs
     WHERE id > $1
     ORDER BY id DESC
     LIMIT $2`,
    [Math.max(Number(afterId) || 0, 0), clampedLimit]
  );
  return rows.map((row) => ({
    id: Number(row.id), createdAt: row.created_at, eventType: row.event_type,
    severity: row.severity, username: row.username, ipAddress: row.ip_address,
    method: row.method, path: row.path, statusCode: row.status_code, metadata: row.metadata,
  }));
}

async function createPurchaseOrder(order) {
  const id = "ord_" + Date.now().toString(36) + crypto.randomBytes(4).toString("hex");
  const { rows } = await q(
    `INSERT INTO purchase_orders (id,api_key,kind,tier,provider,model,input_tokens,output_tokens,amount_usd,amount_thb,expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW() + INTERVAL '10 minutes') RETURNING *`,
    [id, order.apiKey, order.kind, order.tier || null, order.provider || null, order.model || null,
     order.inputTokens || 0, order.outputTokens || 0, order.amountUsd, order.amountThb || 0]
  );
  return rows[0];
}

async function submitPaymentSlip(id, apiKey, file) {
  const { rows } = await q(
    `UPDATE purchase_orders SET slip_data=$3, slip_mime=$4, submitted_at=NOW(), status='waiting_approval'
    WHERE id=$1 AND api_key=$2 AND status='pending' AND expires_at > NOW() RETURNING id,status,expires_at`,
    [id, apiKey, file.buffer, file.mimetype]
  );
  return rows[0] || null;
}
async function listPaymentApprovals() {
  const { rows } = await q(
    `SELECT o.id,o.kind,o.tier,o.provider,o.model,o.input_tokens,o.output_tokens,o.amount_thb,o.status,o.created_at,o.submitted_at,o.expires_at,o.slip_mime,k.name,k.token_balance,k.token_plan_limit
     FROM purchase_orders o JOIN api_keys k ON k.api_key=o.api_key
     WHERE o.status='waiting_approval' ORDER BY o.submitted_at ASC`
  );
  return rows.map(r => ({ id:r.id, kind:r.kind, tier:r.tier, provider:r.provider, model:r.model, tokens:Number(r.input_tokens || 0) + Number(r.output_tokens || 0), amountThb:Number(r.amount_thb), status:r.status, createdAt:r.created_at, submittedAt:r.submitted_at, expiresAt:r.expires_at, slipMime:r.slip_mime, name:r.name, tokenBalance:Number(r.token_balance || 0), tokenPlanLimit:Number(r.token_plan_limit || 0) }));
}
async function getPaymentSlip(id) {
  const { rows } = await q("SELECT slip_data,slip_mime FROM purchase_orders WHERE id=$1 AND status='waiting_approval'", [id]);
  return rows[0] || null;
}
async function reviewPaymentOrder(id, approved, note = "") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT * FROM purchase_orders WHERE id=$1 AND status='waiting_approval' AND expires_at > NOW() FOR UPDATE", [id]);
    const order = rows[0];
    if (!order) { await client.query("ROLLBACK"); return null; }
    if (approved && order.kind === "tier") {
      const planLimit = order.tier === "max" ? 1500000 : 400000;
      await client.query("UPDATE api_keys SET account_tier=$2, token_balance=$3, token_plan_limit=$3, token_plan_started_at=NOW() WHERE api_key=$1", [order.api_key, order.tier, planLimit]);
    }
    if (approved && order.kind === "token") {
      await client.query("INSERT INTO model_entitlements (api_key, provider, model) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [order.api_key, order.provider, order.model]);
      await client.query("INSERT INTO model_token_balances (api_key,provider,model,source,tokens) VALUES ($1,$2,$3,'topup',$4) ON CONFLICT (api_key,provider,model,source) DO UPDATE SET tokens=model_token_balances.tokens+$4,updated_at=NOW()", [order.api_key, order.provider, order.model, Number(order.input_tokens || 0) + Number(order.output_tokens || 0)]);
    }
    await client.query("UPDATE purchase_orders SET status=$2, reviewed_at=NOW(), review_note=$3, slip_data=NULL, slip_mime=NULL WHERE id=$1", [id, approved ? "approved" : "rejected", note]);
    await client.query("COMMIT");
    return { ...order, status: approved ? "approved" : "rejected" };
  } catch (err) { await client.query("ROLLBACK"); throw err; } finally { client.release(); }
}

async function getModelStatuses() {
  const { rows } = await q("SELECT provider, model, online, updated_at FROM model_status ORDER BY provider, model");
  return rows;
}
async function setModelStatus(provider, model, online) {
  const { rows } = await q("UPDATE model_status SET online=$3, updated_at=NOW() WHERE provider=$1 AND model=$2 RETURNING provider,model,online,updated_at", [provider, model, online]);
  return rows[0] || null;
}
async function isModelOnline(provider, model) {
  const { rows } = await q("SELECT online FROM model_status WHERE provider=$1 AND model=$2", [provider, model]);
  return rows.length === 0 || rows[0].online;
}

// ===== Usage stats (กราฟ) =====

async function getUsageStats(apiKey, days = 14) {
  const clampedDays = Math.min(Math.max(Number(days) || 14, 1), 90);
  const sinceTs = Date.now() - clampedDays * 86400000;

  const dailyRes = await q(
    `SELECT
       to_char(day, 'YYYY-MM-DD')           AS date,
       COALESCE(SUM(l.usd_total),     0)    AS usd_total,
       COALESCE(COUNT(l.id),          0)    AS requests,
       COALESCE(SUM(l.input_tokens),  0)    AS input_tokens,
       COALESCE(SUM(l.output_tokens), 0)    AS output_tokens
     FROM generate_series(
       (NOW() - ($1 || ' days')::INTERVAL)::DATE,
       NOW()::DATE,
       '1 day'::INTERVAL
     ) AS day
     LEFT JOIN usage_log l
       ON l.api_key = $2 AND l.ts::DATE = day::DATE
     GROUP BY day ORDER BY day`,
    [clampedDays - 1, apiKey]
  );

  const [byProviderRes, byModelRes] = await Promise.all([
    q(`SELECT provider, SUM(usd_total) AS usd_total, COUNT(*) AS requests
       FROM usage_log WHERE api_key = $1 AND ts >= to_timestamp($2 / 1000.0)
       GROUP BY provider ORDER BY usd_total DESC`, [apiKey, sinceTs]),
    q(`SELECT model, SUM(usd_total) AS usd_total, COUNT(*) AS requests
       FROM usage_log WHERE api_key = $1 AND ts >= to_timestamp($2 / 1000.0)
       GROUP BY model ORDER BY usd_total DESC`, [apiKey, sinceTs]),
  ]);

  return {
    days: clampedDays,
    daily: dailyRes.rows.map((r) => ({
      date: r.date, usdTotal: round(Number(r.usd_total)),
      requests: Number(r.requests), inputTokens: Number(r.input_tokens), outputTokens: Number(r.output_tokens),
    })),
    byProvider: byProviderRes.rows.map((r) => ({ provider: r.provider || "unknown", usdTotal: round(Number(r.usd_total)), requests: Number(r.requests) })),
    byModel:    byModelRes.rows.map((r)    => ({ model:    r.model    || "unknown", usdTotal: round(Number(r.usd_total)), requests: Number(r.requests) })),
  };
}

// ===== Self-service limits =====

const SELF_MAX_DAILY_BUDGET_USD    = Number(process.env.SELF_MAX_DAILY_BUDGET_USD    || 5);
const SELF_MAX_MONTHLY_BUDGET_USD  = Number(process.env.SELF_MAX_MONTHLY_BUDGET_USD  || 50);
const SELF_MAX_REQUESTS_PER_MINUTE = Number(process.env.SELF_MAX_REQUESTS_PER_MINUTE || 60);

async function updateOwnLimits(apiKey, patch) {
  const rec = await getKeyRecord(apiKey);
  if (!rec) return { error: "invalid api key" };
  const next = {};
  if (patch.dailyBudgetUSD !== undefined) {
    const v = Number(patch.dailyBudgetUSD);
    if (!Number.isFinite(v) || v < 0.01 || v > SELF_MAX_DAILY_BUDGET_USD)
      return { error: `dailyBudgetUSD ต้องอยู่ระหว่าง 0.01 ถึง ${SELF_MAX_DAILY_BUDGET_USD}` };
    next.dailyBudgetUSD = round(v);
  }
  if (patch.monthlyBudgetUSD !== undefined) {
    const v = Number(patch.monthlyBudgetUSD);
    if (!Number.isFinite(v) || v < 0.01 || v > SELF_MAX_MONTHLY_BUDGET_USD)
      return { error: `monthlyBudgetUSD ต้องอยู่ระหว่าง 0.01 ถึง ${SELF_MAX_MONTHLY_BUDGET_USD}` };
    next.monthlyBudgetUSD = round(v);
  }
  if (patch.requestsPerMinute !== undefined) {
    const v = Number(patch.requestsPerMinute);
    if (!Number.isInteger(v) || v < 1 || v > SELF_MAX_REQUESTS_PER_MINUTE)
      return { error: `requestsPerMinute ต้องเป็นจำนวนเต็มระหว่าง 1 ถึง ${SELF_MAX_REQUESTS_PER_MINUTE}` };
    next.requestsPerMinute = v;
  }
  if (Object.keys(next).length === 0) return { error: "ไม่มีค่าที่จะอัปเดต" };
  const updated = await updateKeyLimits(apiKey, next);
  return { record: updated, limits: { SELF_MAX_DAILY_BUDGET_USD, SELF_MAX_MONTHLY_BUDGET_USD, SELF_MAX_REQUESTS_PER_MINUTE } };
}

// ===== Conversations =====

async function createConversation(apiKey, provider, model, title) {
  const id = "conv_" + Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
  const { rows } = await q(
    `INSERT INTO conversations (id, api_key, provider, model, title)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [id, apiKey, provider, model, title || "แชทใหม่"]
  );
  return { ...rows[0], messages: [] };
}

async function getConversation(id, apiKey, tier) {
  const values = [id];
  let filter = "";
  if (apiKey) {
    values.push(apiKey);
    filter += ` AND api_key = $${values.length}`;
  }
  if (tier === "free") filter += " AND created_at > NOW() - INTERVAL '7 days'";
  const { rows } = await q(`SELECT * FROM conversations WHERE id = $1${filter}`, values);
  if (!rows[0]) return null;
  const row = rows[0];
  return { ...row, apiKey: row.api_key };
}

async function listConversations(apiKey) {
  const record = await getKeyRecord(apiKey);
  if (record?.tier === "free") {
    await q("DELETE FROM conversations WHERE api_key = $1 AND created_at <= NOW() - INTERVAL '7 days'", [apiKey]);
  }
  const { rows } = await q(
    `SELECT id, title, provider, model, updated_at, jsonb_array_length(messages) AS message_count
     FROM conversations WHERE api_key = $1 ORDER BY updated_at DESC`,
    [apiKey]
  );
  return rows.map((r) => ({
    id: r.id, title: r.title, provider: r.provider, model: r.model,
    updatedAt: r.updated_at, messageCount: Number(r.message_count),
  }));
}

async function appendMessage(id, role, content, textPreview) {
  const newMsg = JSON.stringify({ role, content, textPreview, ts: Date.now() });
  const { rows } = await q(
    `UPDATE conversations
     SET messages   = messages || $1::jsonb,
         updated_at = NOW(),
         title      = CASE
                        WHEN title = 'แชทใหม่' AND $2 = 'user' AND $3 <> ''
                        THEN LEFT($3, 40)
                        ELSE title
                      END
     WHERE id = $4 RETURNING *`,
    [newMsg, role, textPreview || "", id]
  );
  return rows[0] || null;
}

async function deleteConversation(id) {
  const { rowCount } = await q("DELETE FROM conversations WHERE id = $1", [id]);
  return rowCount > 0;
}

// ===== Users =====

const SIGNUP_DAILY_BUDGET_USD    = Number(process.env.SIGNUP_DAILY_BUDGET_USD    || 0.5);
const SIGNUP_MONTHLY_BUDGET_USD  = Number(process.env.SIGNUP_MONTHLY_BUDGET_USD  || 5.0);
const SIGNUP_REQUESTS_PER_MINUTE = Number(process.env.SIGNUP_REQUESTS_PER_MINUTE || 10);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const hash     = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, "hex");
  if (hash.length !== expected.length) return false;
  return crypto.timingSafeEqual(hash, expected);
}

function generateApiKey() {
  return "sk-proxy-" + crypto.randomBytes(20).toString("hex");
}

async function getUser(username) {
  const { rows } = await q("SELECT * FROM users WHERE username = $1", [username]);
  return rows[0] || null;
}

async function createUser(username, password, opts = {}) {
  if (await getUser(username)) {
    const err = new Error("username นี้ถูกใช้ไปแล้ว");
    err.code = "USERNAME_TAKEN";
    throw err;
  }
  const { salt, hash } = hashPassword(password);
  const apiKey = generateApiKey();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO api_keys (api_key, name, daily_budget_usd, monthly_budget_usd, requests_per_minute)
       VALUES ($1, $2, $3, $4, $5)`,
      [apiKey, opts.name || username, SIGNUP_DAILY_BUDGET_USD, SIGNUP_MONTHLY_BUDGET_USD, SIGNUP_REQUESTS_PER_MINUTE]
    );
    await client.query(
      `INSERT INTO users (username, password_hash, salt, api_key, marketing_consent, email) VALUES ($1, $2, $3, $4, $5, $6)`,
      [username, hash, salt, apiKey, Boolean(opts.marketingConsent), opts.email]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return { username, email: opts.email, apiKey };
}

async function authenticateUser(username, password) {
  const user = await getUser(username);
  if (!user) return null;
  if (!verifyPassword(password, user.salt, user.password_hash)) return null;
  return { username: user.username, apiKey: user.api_key };
}

async function getProfileByApiKey(apiKey) {
  const { rows } = await q("SELECT u.username,u.email FROM users u WHERE u.api_key=$1", [apiKey]);
  return rows[0] || null;
}

async function updateProfile(apiKey, patch) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT * FROM users WHERE api_key=$1 FOR UPDATE", [apiKey]);
    const user = rows[0];
    if (!user) { await client.query("ROLLBACK"); return null; }
    if (patch.email !== undefined) await client.query("UPDATE users SET email=$2 WHERE api_key=$1", [apiKey, patch.email || null]);
    if (patch.password) {
      const { salt, hash } = hashPassword(patch.password);
      await client.query("UPDATE users SET password_hash=$2,salt=$3 WHERE api_key=$1", [apiKey, hash, salt]);
    }
    await client.query("COMMIT");
    return { username: user.username, email: patch.email !== undefined ? (patch.email || null) : user.email };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

// ===== Legacy shims (ส่ง error ถ้า code เก่ายังเรียก raw readDb/writeDb อยู่) =====
function readDb()  { throw new Error("readDb() ถูก migrate ไป PostgreSQL แล้ว"); }
function writeDb() { throw new Error("writeDb() ถูก migrate ไป PostgreSQL แล้ว"); }

module.exports = {
  initDb, pool,
  readDb, writeDb,
  getKeyRecord, createKey, updateKeyLimits, deleteKey, listAccounts, setAccountTier,
  recordUsage, consumeTokens, refundTokens, sumUsageSince,
  getAllLogs, logAuditEvent, getAuditLogs, createPurchaseOrder, submitPaymentSlip, listPaymentApprovals, getPaymentSlip, reviewPaymentOrder, getModelStatuses, setModelStatus, isModelOnline, getOfferStatus, claimOffer, getModelTokenBalances, getUsageStats, updateOwnLimits,
  createConversation, getConversation, listConversations, appendMessage, deleteConversation,
  getUser, createUser, authenticateUser, getProfileByApiKey, updateProfile, verifyPassword,
};
