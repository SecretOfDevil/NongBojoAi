const { getKeyRecord, logAuditEvent } = require("../utils/db");

function getClientIp(req) {
  return req.ip || req.socket?.remoteAddress || null;
}

// ตรวจ API key ของ "เว็บเรา" (ส่งมาทาง header: x-api-key)
// นี่คนละอันกับ ANTHROPIC_API_KEY ที่เก็บไว้ใน .env — key ตรงนี้คือ key ที่เราแจกให้ลูกค้า/ผู้ใช้แต่ละคน
async function requireApiKey(req, res, next) {
  const apiKey = req.header("x-api-key");
  if (!apiKey) {
    return res.status(401).json({ error: "missing x-api-key header" });
  }
  try {
    const record = await getKeyRecord(apiKey);
    if (!record) {
      void logAuditEvent({ eventType: "api_key_rejected", severity: "warning", ipAddress: getClientIp(req), method: req.method, path: req.path, statusCode: 401 });
      return res.status(401).json({ error: "invalid api key" });
    }
    req.apiKey = apiKey;
    req.keyRecord = record;
    next();
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, res, next) {
  const adminKey = req.header("x-admin-key");
  if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
    void logAuditEvent({ eventType: "admin_access_denied", severity: "warning", ipAddress: getClientIp(req), method: req.method, path: req.path, statusCode: 403 });
    return res.status(403).json({ error: "forbidden: invalid admin key" });
  }
  if (req.path !== "/audit-logs") {
    void logAuditEvent({ eventType: "admin_access_granted", username: req.header("x-admin-username") || null, ipAddress: getClientIp(req), method: req.method, path: req.path, statusCode: 200 });
  }
  next();
}

module.exports = { requireApiKey, requireAdmin };
