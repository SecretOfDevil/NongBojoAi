const express = require("express");
const { requireApiKey } = require("../middleware/auth");
const { listConversations, getConversation, deleteConversation } = require("../utils/db");

const router = express.Router();

// GET /v1/conversations — รายชื่อแชททั้งหมดของ key นี้ (สำหรับ sidebar)
router.get("/conversations", requireApiKey, async (req, res, next) => {
  try {
    res.json({ conversations: await listConversations(req.apiKey) });
  } catch (err) {
    next(err);
  }
});

// GET /v1/conversations/:id — ดึงประวัติข้อความเต็มของแชทหนึ่งอัน
router.get("/conversations/:id", requireApiKey, async (req, res, next) => {
  try {
    const conv = await getConversation(req.params.id);
    if (!conv || conv.apiKey !== req.apiKey) {
      return res.status(404).json({ error: "conversation not found" });
    }
  // ไม่ส่ง base64 ของไฟล์แนบกลับ (หนักเกินไป) ส่งแค่ metadata + ข้อความ
  const messages = conv.messages.map((m) => ({
    role: m.role,
    text: m.content.filter((b) => b.type === "text").map((b) => b.text).join("\n"),
    attachments: m.content.filter((b) => b.type !== "text").map((b) => ({ type: b.type, filename: b.filename, mimetype: b.mimetype })),
    ts: m.ts,
  }));
    res.json({ id: conv.id, title: conv.title, provider: conv.provider, model: conv.model, messages });
  } catch (err) {
    next(err);
  }
});

// DELETE /v1/conversations/:id
router.delete("/conversations/:id", requireApiKey, async (req, res, next) => {
  try {
    const conv = await getConversation(req.params.id);
    if (!conv || conv.apiKey !== req.apiKey) {
      return res.status(404).json({ error: "conversation not found" });
    }
    await deleteConversation(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
