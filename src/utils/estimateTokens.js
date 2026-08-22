// ประมาณจำนวน input token แบบระแวดระวัง (overestimate ไว้ก่อน) เพื่อใช้เช็ค budget
// ก่อนยิง request จริง — ไม่ต้องแม่นเป๊ะ แค่ต้อง "ไม่ประเมินต่ำกว่าความจริง" เพื่อกันไม่ให้เกิน limit
function estimateInputTokens(historyBlocks) {
  let total = 0;
  for (const block of historyBlocks) {
    if (block.type === "text") {
      total += Math.ceil(block.text.length / 3); // ~3 ตัวอักษรต่อ token (safety buffer)
    } else if (block.type === "image") {
      total += 1600; // ค่าประมาณสูงสุดของรูปภาพทั่วไปตาม vision tokenizer
    } else if (block.type === "document") {
      total += 3000; // ค่าประมาณสำหรับ PDF ไม่กี่หน้า (safety buffer)
    }
  }
  return total;
}

function estimateHistoryInputTokens(history) {
  return history.reduce((sum, m) => sum + estimateInputTokens(m.content), 0);
}

module.exports = { estimateInputTokens, estimateHistoryInputTokens };
