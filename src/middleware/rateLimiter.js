const rateLimit = require("express-rate-limit");
const { sumUsageSince } = require("../utils/db");

// จำกัดจำนวน "ครั้ง" ของ request ต่อนาที — แยก bucket ตาม apiKey ของแต่ละคน
// requestsPerMinute ของแต่ละ key เก็บอยู่ใน req.keyRecord (มาจาก requireApiKey middleware ก่อนหน้า)
const requestRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  keyGenerator: (req) => req.apiKey || req.ip,
  max: (req) => req.keyRecord?.requestsPerMinute || 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate limit exceeded: too many requests per minute, ลองใหม่อีกครั้งใน 1 นาที" },
});

// จำกัด "งบประมาณ" เป็นเงิน USD ต่อวัน / ต่อเดือน ต่อ apiKey
// เช็คก่อนยิงไป Claude API จริง เพื่อกันไม่ให้เกินงบที่ตั้งไว้
function budgetGuard(req, res, next) {
  const rec = req.keyRecord;
  if (!rec) return res.status(401).json({ error: "invalid api key" });

  const now = Date.now();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now);
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const dayUsage = sumUsageSince(req.apiKey, startOfDay.getTime());
  const monthUsage = sumUsageSince(req.apiKey, startOfMonth.getTime());

  if (dayUsage.usdTotal >= rec.dailyBudgetUSD) {
    return res.status(429).json({
      error: "daily budget exceeded",
      dailyBudgetUSD: rec.dailyBudgetUSD,
      usedTodayUSD: dayUsage.usdTotal,
    });
  }
  if (monthUsage.usdTotal >= rec.monthlyBudgetUSD) {
    return res.status(429).json({
      error: "monthly budget exceeded",
      monthlyBudgetUSD: rec.monthlyBudgetUSD,
      usedThisMonthUSD: monthUsage.usdTotal,
    });
  }

  req.budgetStatus = { dayUsage, monthUsage };
  next();
}

module.exports = { requestRateLimiter, budgetGuard };
