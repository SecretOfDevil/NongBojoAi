const express = require("express");
const { requireAdmin } = require("../middleware/auth");
const { getAllLogs, getAuditLogs } = require("../utils/db");

const router = express.Router();

// GET /admin/logs — ดูประวัติการใช้งานทั้งหมด (ต้องมี x-admin-key)
router.get("/usage-logs", requireAdmin, async (req, res, next) => {
  try {
    const logs = await getAllLogs({
      limit: req.query.limit,
      offset: req.query.offset,
      apiKey: req.query.apiKey,
      provider: req.query.provider,
      model: req.query.model,
    });
    res.json(logs);
  } catch (err) {
    next(err);
  }
});

// GET /admin/audit-logs — security/login/admin events; poll with afterId for live updates
router.get("/audit-logs", requireAdmin, async (req, res, next) => {
  try {
    const logs = await getAuditLogs({ limit: req.query.limit, afterId: req.query.afterId });
    res.json({ logs });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
