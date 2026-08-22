
// แปลงไฟล์ที่อัปโหลด (จาก multer) ให้เป็น "universal content block"
// รูปแบบกลางที่ provider adapter ทุกตัว (anthropic / openai / gemini) รู้จัก:
//   { type: 'text', text }
//   { type: 'image', mimetype, base64 }
//   { type: 'document', mimetype, base64 }
function fileToContentBlock(file) {
  if (file.mimetype.startsWith("image/")) {
    const base64 = file.buffer.toString("base64");
    return { type: "image", mimetype: file.mimetype, base64, filename: file.originalname };
  }

  if (file.mimetype === "application/pdf") {
    const base64 = file.buffer.toString("base64");
    return { type: "document", mimetype: file.mimetype, base64, filename: file.originalname };
  }

  if (file.mimetype === "text/plain" || file.mimetype === "text/csv") {
    const text = file.buffer.toString("utf-8");
    return { type: "text", text: `[ไฟล์แนบ: ${file.originalname}]\n${text}` };
  }

  throw new Error(`cannot convert file type ${file.mimetype} to content block`);
}

function cleanupFiles() {}

module.exports = { fileToContentBlock, cleanupFiles };
