/**
 * migrate-from-json.js
 * ย้ายข้อมูลจาก data/db.json เดิมไปยัง PostgreSQL
 *
 * รันครั้งเดียว หลังจากตั้งค่า DATABASE_URL ใน .env แล้ว:
 *   node migrate-from-json.js
 */

require("dotenv").config();
const fs   = require("fs");
const path = require("path");
const { initDb, pool } = require("./src/utils/db");

const DB_FILE = path.join(__dirname, "data", "db.json");

async function migrate() {
  if (!fs.existsSync(DB_FILE)) {
    console.log("ไม่พบ data/db.json — ไม่มีข้อมูลเก่าที่ต้องย้าย เสร็จแล้ว");
    await pool.end();
    return;
  }

  const json = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  await initDb(); // สร้างตารางก่อน

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. api_keys
    for (const [key, rec] of Object.entries(json.apiKeys || {})) {
      await client.query(
        `INSERT INTO api_keys (api_key, name, created_at, daily_budget_usd, monthly_budget_usd, requests_per_minute)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (api_key) DO NOTHING`,
        [key, rec.name || "unnamed", rec.createdAt || new Date().toISOString(),
         rec.dailyBudgetUSD ?? 1, rec.monthlyBudgetUSD ?? 10, rec.requestsPerMinute ?? 10]
      );

      // 2. usage_log ของ key นี้
      for (const u of rec.usage || []) {
        await client.query(
          `INSERT INTO usage_log (api_key, ts, provider, model, input_tokens, output_tokens, usd_total)
           VALUES ($1, to_timestamp($2/1000.0), $3, $4, $5, $6, $7)`,
          [key, u.ts || Date.now(), u.provider || null, u.model || null,
           u.inputTokens || 0, u.outputTokens || 0, u.usdTotal || 0]
        );
      }
    }

    // 3. users
    for (const [, u] of Object.entries(json.users || {})) {
      await client.query(
        `INSERT INTO users (username, password_hash, salt, api_key, created_at)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (username) DO NOTHING`,
        [u.username, u.passwordHash, u.salt, u.apiKey, u.createdAt || new Date().toISOString()]
      );
    }

    // 4. conversations (messages เก็บเป็น JSONB)
    for (const [id, conv] of Object.entries(json.conversations || {})) {
      await client.query(
        `INSERT INTO conversations (id, api_key, provider, model, title, created_at, updated_at, messages)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [id, conv.apiKey, conv.provider || null, conv.model || null,
         conv.title || "แชทใหม่", conv.createdAt || new Date().toISOString(),
         conv.updatedAt || new Date().toISOString(), JSON.stringify(conv.messages || [])]
      );
    }

    await client.query("COMMIT");
    console.log("migrate สำเร็จ!");
    console.log(`  api_keys:      ${Object.keys(json.apiKeys  || {}).length} rows`);
    console.log(`  users:         ${Object.keys(json.users    || {}).length} rows`);
    console.log(`  conversations: ${Object.keys(json.conversations || {}).length} rows`);
    const totalUsage = Object.values(json.apiKeys || {}).reduce((s, r) => s + (r.usage?.length || 0), 0);
    console.log(`  usage_log:     ${totalUsage} rows`);
    console.log("\nสำรอง data/db.json ไว้ที่ data/db.json.bak แล้ว");
    fs.copyFileSync(DB_FILE, DB_FILE + ".bak");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("migrate ล้มเหลว (rollback แล้ว):", e.message);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();