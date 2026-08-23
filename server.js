require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const chatRoute = require("./src/routes/chat");
const usageRoute = require("./src/routes/usage");
const adminRoute = require("./src/routes/admin");
const conversationsRoute = require("./src/routes/conversations");
const downloadRoute = require("./src/routes/download");
const authRoutes = require("./src/routes/authRoutes");
const statsRoute = require("./src/routes/statsRoute");
const adminLogsRoute = require("./src/routes/adminLogsRoute");
const securityRoute = require("./src/routes/securityRoute");
const billingRoute = require("./src/routes/billingRoute");
const { requireApiKey } = require("./src/middleware/auth");
const { getModelStatuses } = require("./src/utils/db");
const { PROVIDERS } = require("./src/config/pricing");
const { initDb, logAuditEvent } = require("./src/utils/db");
const rateLimit = require("express-rate-limit");

// เตือนถ้ายังไม่ได้ตั้งค่า API key ของ provider ไหน (ไม่บังคับต้องมีครบทุกตัว
// ใช้แค่ provider ไหนก็ตั้งค่าแค่ตัวนั้น ที่เหลือจะ error ตอนเรียกใช้จริงเท่านั้น)
for (const [key, conf] of Object.entries(PROVIDERS)) {
  if (!process.env[conf.apiKeyEnv]) {
    console.warn(`⚠️  ยังไม่ได้ตั้งค่า ${conf.apiKeyEnv} ใน .env — provider "${key}" (${conf.label}) จะใช้งานไม่ได้จนกว่าจะตั้งค่า`);
  }
}

const app = express();
app.disable("x-powered-by");
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    void logAuditEvent({ eventType: "rate_limit_blocked", severity: "warning", ipAddress: req.ip, method: req.method, path: req.path, statusCode: 429 });
    res.status(429).json({ error: "too many requests; try again in a minute" });
  },
}));
app.use(cors());
app.use(express.json({ limit: "256kb" }));
app.use(express.static(path.join(__dirname, "public")));

// Vercel invokes this module per serverless instance. Ensure schema setup finishes
// before routes touch PostgreSQL, without opening a listening socket in Vercel.
const dbReady = initDb();
app.use(async (req, res, next) => {
  try {
    await dbReady;
    next();
  } catch (err) {
    console.error("PostgreSQL initialization failed:", err.message);
    res.status(500).json({ error: "database initialization failed" });
  }
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/v1/models", (req, res) => {
  // ส่งกลับเฉพาะข้อมูลที่ frontend ต้องใช้ (ไม่ต้องมี apiKeyEnv)
  const out = {};
  for (const [key, conf] of Object.entries(PROVIDERS)) {
    out[key] = { label: conf.label, defaultModel: conf.defaultModel, capabilities: conf.capabilities, models: conf.models };
  }
  res.json({ providers: out });
});
app.get("/v1/model-status", requireApiKey, async (req, res, next) => {
  try { res.json({ models: await getModelStatuses(), purchasedModels: req.keyRecord.purchasedModels }); } catch (e) { next(e); }
});

app.use("/v1", chatRoute);
app.use("/v1", usageRoute);
app.use("/v1", conversationsRoute);
app.use("/v1", downloadRoute);
app.use("/admin", adminRoute);
app.use("/admin", adminLogsRoute);
app.use("/auth", authRoutes);
app.use("/v1", statsRoute);
app.use("/v1", securityRoute);
app.use("/v1", billingRoute);

// error handler กลาง (จับ error จาก multer เช่นไฟล์ใหญ่เกิน/ชนิดไฟล์ผิด)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message || "unexpected error" });
});

app.get('/favicon.ico', (req, res) => res.status(204).end());

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  dbReady
    .then(() => app.listen(PORT, () => console.log(`claude-proxy running at http://localhost:${PORT}`)))
    .catch((err) => console.error("ไม่สามารถเชื่อมต่อ PostgreSQL ได้ เซิร์ฟเวอร์ไม่รัน:", err.message));
}

module.exports = app;
