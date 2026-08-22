const express = require("express");
const fs = require("fs");
const path = require("path");
const { requireApiKey } = require("../middleware/auth");

const router = express.Router();
const RESPONSES_DIR = path.join(__dirname, "..", "..", "data", "responses");

// GET /v1/download/:responseId — โหลดคำตอบของ AI ที่บันทึกไว้เป็นไฟล์ .md
// ต้องแนบ x-api-key (กันคนอื่นสุ่มโหลดไฟล์ของคนอื่น แม้ id จะเดายาก)
router.get("/download/:responseId", requireApiKey, (req, res) => {
  const id = req.params.responseId;
  if (!/^resp_[a-z0-9]+$/i.test(id)) return res.status(400).json({ error: "invalid response id" });

  const filePath = path.join(RESPONSES_DIR, `${id}.md`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "response file not found" });

  res.download(filePath, `claude-proxy-${id}.md`);
});

module.exports = router;
