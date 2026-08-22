const express = require("express");
const { requireApiKey } = require("../middleware/auth");
const { getUsageStats, updateOwnLimits, getKeyRecord } = require("../utils/db");

const router = express.Router();

// GET /v1/usage/stats?days=14
// ข้อมูลสรุปสำหรับกราฟ: รายวัน + แยกตาม provider + แยกตาม model
router.get("/usage/stats", requireApiKey, async (req, res, next) => {
  try {
  const days = req.query.days ? Number(req.query.days) : 14;
  const stats = await getUsageStats(req.apiKey, days);
  res.json(stats);
  } catch (err) {
    next(err);
  }
});

// PATCH /v1/settings  { dailyBudgetUSD?, monthlyBudgetUSD?, requestsPerMinute? }
// ให้ user ปรับ budget/limit ของตัวเองได้ผ่านหน้าเว็บ (มีเพดานสูงสุดกันตั้งงบเกินควบคุม กำหนดได้ผ่าน .env)
router.patch("/settings", requireApiKey, async (req, res, next) => {
  try {
  const result = await updateOwnLimits(req.apiKey, req.body || {});
  if (result.error) {
    return res.status(400).json({ error: result.error, maxAllowed: result.limits });
  }
  res.json({ ok: true, record: result.record });
  } catch (err) {
    next(err);
  }
});

// GET /v1/settings — ค่า limit ปัจจุบัน + เพดานสูงสุดที่ปรับเองได้ (ใช้เติมค่าเริ่มต้นในฟอร์ม)
router.get("/settings", requireApiKey, async (req, res, next) => {
  try {
  const rec = await getKeyRecord(req.apiKey);
  if (!rec) return res.status(401).json({ error: "invalid api key" });
  res.json({
    dailyBudgetUSD: rec.dailyBudgetUSD,
    monthlyBudgetUSD: rec.monthlyBudgetUSD,
    requestsPerMinute: rec.requestsPerMinute,
    maxAllowed: {
      dailyBudgetUSD: Number(process.env.SELF_MAX_DAILY_BUDGET_USD || 5),
      monthlyBudgetUSD: Number(process.env.SELF_MAX_MONTHLY_BUDGET_USD || 50),
      requestsPerMinute: Number(process.env.SELF_MAX_REQUESTS_PER_MINUTE || 60),
    },
  });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
