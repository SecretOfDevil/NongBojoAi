const express = require("express");
const { requireApiKey } = require("../middleware/auth");
const { sumUsageSince } = require("../utils/db");

const router = express.Router();
const USD_TO_THB = Number(process.env.USD_TO_THB || 36.5);

// GET /v1/usage — เช็คว่าใช้ไปเท่าไหร่แล้ว เหลือ budget เท่าไหร่
router.get("/usage", requireApiKey, async (req, res, next) => {
  try {
  const rec = req.keyRecord;
  const now = Date.now();

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now);
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const day = await sumUsageSince(req.apiKey, startOfDay.getTime());
  const month = await sumUsageSince(req.apiKey, startOfMonth.getTime());

  res.json({
    name: rec.name,
    limits: {
      dailyBudgetUSD: rec.dailyBudgetUSD,
      monthlyBudgetUSD: rec.monthlyBudgetUSD,
      requestsPerMinute: rec.requestsPerMinute,
    },
    today: {
      usedUSD: Math.round(day.usdTotal * 1e6) / 1e6,
      usedTHB: Math.round(day.usdTotal * USD_TO_THB * 100) / 100,
      remainingUSD: Math.max(0, Math.round((rec.dailyBudgetUSD - day.usdTotal) * 1e6) / 1e6),
      requests: day.requests,
    },
    thisMonth: {
      usedUSD: Math.round(month.usdTotal * 1e6) / 1e6,
      usedTHB: Math.round(month.usdTotal * USD_TO_THB * 100) / 100,
      remainingUSD: Math.max(0, Math.round((rec.monthlyBudgetUSD - month.usdTotal) * 1e6) / 1e6),
      requests: month.requests,
    },
    recentUsage: [],
  });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
