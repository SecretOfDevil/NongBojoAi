const express = require("express");
const fs = require("fs");
const path = require("path");
const { upload } = require("../middleware/upload");
const { requireApiKey } = require("../middleware/auth");
const { requestRateLimiter } = require("../middleware/rateLimiter");
const { getProvider, calcCostUSD, DEFAULT_PROVIDER, round, getModelTier } = require("../config/pricing");
const { recordUsage, sumUsageSince, createConversation, getConversation, appendMessage } = require("../utils/db");
const { fileToContentBlock, cleanupFiles } = require("../utils/fileToContentBlock");
const { callProvider, checkCapability } = require("../providers");
const { estimateHistoryInputTokens } = require("../utils/estimateTokens");

const router = express.Router();
const USD_TO_THB = Number(process.env.USD_TO_THB || 36.5);

const RESPONSES_DIR = path.join(__dirname, "..", "..", "data", "responses");
if (!fs.existsSync(RESPONSES_DIR)) fs.mkdirSync(RESPONSES_DIR, { recursive: true });

function startOfDayTs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function startOfMonthTs() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// เช็คว่า "ถ้ายิง request นี้ไปจริง" ค่าใช้จ่ายสูงสุดที่เป็นไปได้ (ประเมินแบบ overestimate)
// จะทำให้เกินงบวัน/เดือนไหม — ถ้าเกิน บล็อกทันที ไม่ยิงไป provider เลย (hard cutoff)
async function checkHardBudgetCutoff(apiKey, keyRecord, provider, model, estInputTokens, maxTokens) {
  const pricing = getProvider(provider).models[model];
  const estMaxCost = round((estInputTokens / 1_000_000) * pricing.input + (maxTokens / 1_000_000) * pricing.output);

  const day = await sumUsageSince(apiKey, startOfDayTs());
  const month = await sumUsageSince(apiKey, startOfMonthTs());

  if (day.usdTotal + estMaxCost > keyRecord.dailyBudgetUSD) {
    return {
      blocked: true,
      reason: "daily",
      usedUSD: day.usdTotal,
      estimatedRequestCostUSD: estMaxCost,
      budgetUSD: keyRecord.dailyBudgetUSD,
    };
  }
  if (month.usdTotal + estMaxCost > keyRecord.monthlyBudgetUSD) {
    return {
      blocked: true,
      reason: "monthly",
      usedUSD: month.usdTotal,
      estimatedRequestCostUSD: estMaxCost,
      budgetUSD: keyRecord.monthlyBudgetUSD,
    };
  }
  return { blocked: false, estimatedRequestCostUSD: estMaxCost };
}

function saveResponseAsFile(conversationId, provider, model, text) {
  const id = "resp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const header = `# คำตอบจาก ${provider}/${model}\n> วันที่: ${new Date().toLocaleString("th-TH")}\n\n---\n\n`;
  fs.writeFileSync(path.join(RESPONSES_DIR, `${id}.md`), header + text, "utf-8");
  return id;
}

/**
 * POST /v1/chat
 * multipart/form-data:
 *   message, provider (default anthropic), model, max_tokens, system,
 *   conversationId (ถ้าไม่ส่งมา = เริ่มแชทใหม่), files[]
 * headers: x-api-key
 */
router.post("/chat", requireApiKey, requestRateLimiter, upload.array("files", 5), async (req, res) => {
  const files = req.files || [];
  try {
    const {
      message,
      provider = DEFAULT_PROVIDER,
      model,
      max_tokens = 1024,
      system,
      conversationId,
    } = req.body;

    const providerConf = getProvider(provider);
    if (!providerConf) {
      return res.status(400).json({ error: `unknown provider "${provider}"`, available: Object.keys(require("../config/pricing").PROVIDERS) });
    }
    const chosenModel = model || providerConf.defaultModel;
    if (!providerConf.models[chosenModel]) {
      return res.status(400).json({
        error: `unknown model "${chosenModel}" for provider "${provider}"`,
        availableModels: Object.keys(providerConf.models),
      });
    }
    const ranks = { free: 0, plus: 1, max: 2 };
    const requiredTier = getModelTier(provider, chosenModel);
    if (ranks[req.keyRecord.tier] < ranks[requiredTier]) {
      return res.status(403).json({ error: `โมเดลนี้ต้องใช้ ${requiredTier.toUpperCase()} tier`, code: "MODEL_TIER_LOCKED", requiredTier });
    }
    if (!message && files.length === 0) {
      return res.status(400).json({ error: "ต้องมี message หรือแนบไฟล์อย่างน้อย 1 อย่าง" });
    }

    // สร้าง content blocks จากไฟล์แนบ + ตรวจว่า provider นี้รองรับชนิดไฟล์นี้ไหม
    const newBlocks = [];
    for (const f of files) {
      const block = fileToContentBlock(f);
      if (!checkCapability(provider, block.type)) {
        return res.status(400).json({
          error: `${providerConf.label} ไม่รองรับไฟล์ชนิดนี้ (${block.type}) — ลองสลับไปใช้ Claude หรือ Gemini แทนสำหรับไฟล์ประเภทนี้`,
        });
      }
      newBlocks.push(block);
    }
    if (message) newBlocks.push({ type: "text", text: message });

    // โหลด/สร้าง conversation
    let conv;
    if (conversationId) {
      conv = await getConversation(conversationId);
      if (!conv || conv.apiKey !== req.apiKey) {
        return res.status(404).json({ error: "conversation not found" });
      }
    } else {
      conv = await createConversation(req.apiKey, provider, chosenModel);
    }

    const history = [...conv.messages.map((m) => ({ role: m.role, content: m.content })), { role: "user", content: newBlocks }];

    // ===== HARD BUDGET CUTOFF: เช็คก่อนยิงไป provider จริง ห้ามเกิน limit เด็ดขาด =====
    const estInputTokens = estimateHistoryInputTokens(history);
    const cutoff = await checkHardBudgetCutoff(req.apiKey, req.keyRecord, provider, chosenModel, estInputTokens, Number(max_tokens));
    if (cutoff.blocked) {
      return res.status(429).json({
        error:
          cutoff.reason === "daily"
            ? `ตัดจบ: งบประมาณรายวันไม่พอสำหรับ request นี้ (ใช้ไปแล้ว $${cutoff.usedUSD} จากงบ $${cutoff.budgetUSD}/วัน, request นี้ประเมินสูงสุด $${cutoff.estimatedRequestCostUSD})`
            : `ตัดจบ: งบประมาณรายเดือนไม่พอสำหรับ request นี้ (ใช้ไปแล้ว $${cutoff.usedUSD} จากงบ $${cutoff.budgetUSD}/เดือน, request นี้ประเมินสูงสุด $${cutoff.estimatedRequestCostUSD})`,
        code: "BUDGET_LIMIT_REACHED",
        ...cutoff,
      });
    }

    // ===== เรียก provider จริง =====
    const result = await callProvider(provider, chosenModel, history, {
      system: system || undefined,
      maxTokens: Number(max_tokens),
    });

    const cost = calcCostUSD(provider, chosenModel, result.inputTokens, result.outputTokens);
    await recordUsage(req.apiKey, {
      provider,
      model: chosenModel,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      usdTotal: cost.usdTotal,
    });

    // บันทึกทั้ง user message และคำตอบของ AI ลง history ของ conversation
    await appendMessage(conv.id, "user", newBlocks, message || `[แนบไฟล์ ${files.length} ไฟล์]`);
    await appendMessage(conv.id, "assistant", [{ type: "text", text: result.text }], result.text);

    // สร้างไฟล์คำตอบให้โหลดกลับไปเสมอ ตามที่ผู้ใช้ขอ
    const responseId = saveResponseAsFile(conv.id, provider, chosenModel, result.text);

    res.json({
      conversationId: conv.id,
      reply: result.text,
      provider,
      model: chosenModel,
      usage: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        totalTokens: result.inputTokens + result.outputTokens,
      },
      cost: {
        usd: cost.usdTotal,
        usdInput: cost.usdInput,
        usdOutput: cost.usdOutput,
        thb: Math.round(cost.usdTotal * USD_TO_THB * 100) / 100,
      },
      download: {
        responseId,
        url: `/v1/download/${responseId}`,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "internal error" });
  } finally {
    cleanupFiles(files);
  }
});

module.exports = router;
