const anthropicProvider = require("./anthropic");
const openaiCompatible = require("./openaiCompatible");
const geminiProvider = require("./gemini");
const { getProvider } = require("../config/pricing");

/**
 * เรียกโมเดลของ provider ที่เลือก ด้วย interface กลางเดียวกันทุกค่าย
 * @param {string} provider - 'anthropic' | 'openai' | 'gemini' | 'deepseek' | 'qwen'
 * @param {string} model
 * @param {Array} history - universal message history [{role, content:[{type,...}]}]
 * @param {{system?:string, maxTokens:number}} opts
 * @returns {Promise<{text:string, inputTokens:number, outputTokens:number}>}
 */
async function callProvider(provider, model, history, opts) {
  switch (provider) {
    case "anthropic":
      return anthropicProvider.call(model, history, opts);
    case "openai":
      return openaiCompatible.call(
        "https://api.openai.com/v1",
        process.env.OPENAI_API_KEY,
        model,
        history,
        opts
      );
    case "deepseek":
      return openaiCompatible.call(
        "https://api.deepseek.com",
        process.env.DEEPSEEK_API_KEY,
        model,
        history,
        opts
      );
    case "gemini":
      return geminiProvider.call(process.env.GOOGLE_API_KEY, model, history, opts);
    case "openrouter":
      return openaiCompatible.call(
        "https://openrouter.ai/api/v1",
        process.env.OPENROUTER_API_KEY,
        model,
        history,
        opts
      );
    case "groq":
      return openaiCompatible.call(
        "https://api.groq.com/openai/v1",
        process.env.GROQ_API_KEY,
        model,
        history,
        opts
      );
    case "qwen":
      return openaiCompatible.call(
        process.env.QWEN_BASE_URL || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        process.env.QWEN_API_KEY,
        model,
        history,
        opts
      );
    default:
      throw new Error(`unknown provider: ${provider}`);
  }
}

// ตรวจว่าไฟล์ที่แนบมาชนิดนี้ ผู้ให้บริการที่เลือกรองรับไหม
function checkCapability(provider, blockType) {
  const p = getProvider(provider);
  if (!p) return false;
  if (blockType === "text") return true;
  return !!p.capabilities[blockType];
}

module.exports = { callProvider, checkCapability };
