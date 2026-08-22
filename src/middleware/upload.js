const multer = require("multer");

const maxBytes = Math.max(1, Number(process.env.MAX_FILE_SIZE_MB || 20)) * 1024 * 1024;
const allowedTypes = new Set(["application/pdf", "text/plain", "text/csv"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxBytes, files: 5 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/") || allowedTypes.has(file.mimetype)) return cb(null, true);
    cb(new Error("ไม่รองรับประเภทไฟล์นี้"));
  },
});

module.exports = { upload };
