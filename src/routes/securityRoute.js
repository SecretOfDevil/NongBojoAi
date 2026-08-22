const express = require("express");
const { requireApiKey } = require("../middleware/auth");
const { logAuditEvent } = require("../utils/db");

const router = express.Router();
const ALLOWED_EVENTS = new Set(["devtools_shortcut", "context_menu"]);

// Client signals are a deterrent/audit aid only, never proof of misuse.
router.post("/security/client-event", requireApiKey, async (req, res, next) => {
  try {
    const eventType = req.body?.eventType;
    if (!ALLOWED_EVENTS.has(eventType)) return res.status(400).json({ error: "unknown security event" });
    await logAuditEvent({
      eventType, severity: "warning", username: req.keyRecord.name, ipAddress: req.ip,
      method: req.method, path: req.path, statusCode: 204,
      metadata: { userAgent: String(req.get("user-agent") || "").slice(0, 300) },
    });
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
