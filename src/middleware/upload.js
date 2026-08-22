const multer = require("multer");
const path = require("path");

const MAX_FILE_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB || 20);

// ใช้ memory storage สำหรับ Vercel (serverless ไม่มี persistent disk)
const storage = multer.memoryStorage();

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
]);

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return cb(new Error(`unsupported file type: ${file.mimetype}`));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024, files: 5 },
});

module.exports = { upload, ALLOWED_MIME };