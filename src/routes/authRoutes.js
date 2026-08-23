const express = require("express");
const rateLimit = require("express-rate-limit");
const { createUser, authenticateUser, logAuditEvent } = require("../utils/db");

const router = express.Router();

// กัน brute-force: จำกัด 20 ครั้ง / 15 นาที ต่อ IP สำหรับ endpoint สมัคร/login
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "พยายามสมัคร/login บ่อยเกินไป ลองใหม่อีกครั้งใน 15 นาที" },
});

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateCredentials(username, password) {
  if (typeof username !== "string" || !USERNAME_RE.test(username)) {
    return "username ต้องเป็นตัวอักษร/ตัวเลข/._- ยาว 3-32 ตัวอักษร";
  }
  if (typeof password !== "string" || password.length < 8) {
    return "password ต้องยาวอย่างน้อย 8 ตัวอักษร";
  }
  return null;
}

// POST /auth/register  { username, password, name? }
// สร้างบัญชีใหม่ พร้อมสร้าง x-api-key ให้อัตโนมัติ (ใช้ยิง /v1/chat ได้ทันที)
router.post("/register", authRateLimiter, async (req, res) => {
  const { username, email, password, passwordConfirm, name, marketingConsent, termsAccepted } = req.body || {};
  const validationError = validateCredentials(username, password);
  if (validationError) return res.status(400).json({ error: validationError });
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) return res.status(400).json({ error: "กรุณาใส่ email ที่ถูกต้อง" });
  if (password !== passwordConfirm) return res.status(400).json({ error: "รหัสผ่านสองช่องไม่ตรงกัน" });
  if (!termsAccepted) return res.status(400).json({ error: "ต้องยอมรับข้อตกลงก่อนสมัครสมาชิก" });

  try {
    const { apiKey } = await createUser(username, password, { name, email: email.trim().toLowerCase(), marketingConsent: Boolean(marketingConsent) });
    res.status(201).json({
      username,
      apiKey,
      message: "สมัครสำเร็จ — เก็บ apiKey นี้ไว้ใช้เรียก /v1/chat (ระบบจะจำให้อัตโนมัติในหน้าเว็บ)",
    });
    await logAuditEvent({ eventType: "user_registered", username, ipAddress: req.ip, method: req.method, path: req.path, statusCode: 201 });
  } catch (e) {
    if (e.code === "USERNAME_TAKEN") {
      return res.status(409).json({ error: e.message, code: "USERNAME_TAKEN" });
    }
    if (e.code === "23505") return res.status(409).json({ error: "email นี้ถูกใช้แล้ว", code: "EMAIL_TAKEN" });
    console.error(e);
    await logAuditEvent({ eventType: "registration_failed", severity: "error", username, ipAddress: req.ip, method: req.method, path: req.path, statusCode: 500 });
    res.status(500).json({ error: "สมัครไม่สำเร็จ กรุณาลองใหม่" });
  }
});

// POST /auth/login  { username, password }
router.post("/login", authRateLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "กรุณาใส่ username และ password" });
  }

  const result = await authenticateUser(username, password);
  if (!result) {
    await logAuditEvent({ eventType: "login_failed", severity: "warning", username, ipAddress: req.ip, method: req.method, path: req.path, statusCode: 401 });
    return res.status(401).json({ error: "username หรือ password ไม่ถูกต้อง" });
  }

  await logAuditEvent({ eventType: "login_succeeded", username: result.username, ipAddress: req.ip, method: req.method, path: req.path, statusCode: 200 });
  res.json({ username: result.username, apiKey: result.apiKey });
});

module.exports = router;
