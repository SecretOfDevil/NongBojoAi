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
    const conv = await getConversation(req.params.id, req.apiKey, req.keyRecord.tier);
    if (!conv) {
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
    const conv = await getConversation(req.params.id, req.apiKey, req.keyRecord.tier);
    if (!conv) {
      return res.status(404).json({ error: "conversation not found" });
    }
    await deleteConversation(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// GET /v1/conversations/:id/download.txt — ส่งออกแชทเป็นข้อความธรรมดา
router.get("/conversations/:id/download.txt", requireApiKey, async (req, res, next) => {
  try {
    const conv = await getConversation(req.params.id, req.apiKey, req.keyRecord.tier);
    if (!conv) return res.status(404).json({ error: "conversation not found" });
    const text = conv.messages.map((message) => {
      const body = message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
      const attachments = message.content.filter((block) => block.type !== "text").map((block) => `[attachment: ${block.filename || block.mimetype || block.type}]`).join("\n");
      return `${message.role.toUpperCase()}\n${body}${attachments ? `\n${attachments}` : ""}`;
    }).join("\n\n---\n\n");
    res.type("text/plain; charset=utf-8").attachment(`${conv.id}.txt`).send(`# ${conv.title}\n\n${text}\n`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
