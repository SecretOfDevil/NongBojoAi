// ตั้งค่า provider ทั้งหมดไว้ที่เดียว: ราคา, ความสามารถ (รับไฟล์ชนิดไหนได้), env var ของ API key
// ราคาต่อ 1,000,000 token (USD) อัปเดตล่าสุดเดือนสิงหาคม 2026 อ้างอิง:
//   Claude   -> https://platform.claude.com/docs/en/about-claude/pricing
//   OpenAI   -> https://developers.openai.com/api/docs/pricing
//   Gemini   -> https://ai.google.dev/gemini-api/docs/pricing
//   DeepSeek -> https://api-docs.deepseek.com/quick_start/pricing/
const PROVIDERS = {
  anthropic: {
    label: "Claude (Anthropic)",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-5",
    capabilities: { image: true, document: true },
    models: {
      "claude-opus-4-8": { label: "Claude Opus 4.8", input: 5.0, output: 25.0 },
      "claude-sonnet-5": { label: "Claude Sonnet 5", input: 2.0, output: 10.0 },
      "claude-haiku-4-5-20251001": { label: "Claude Haiku 4.5", input: 1.0, output: 5.0 },
      "claude-fable-5": { label: "Claude Fable 5", input: 10.0, output: 50.0 },
    },
  },
  openai: {
    label: "GPT (OpenAI)",
    apiKeyEnv: "OPENAI_API_KEY",
    defaultModel: "gpt-5-nano",
    capabilities: { image: true, document: false },
    models: {
      "gpt-5-nano": { label: "GPT-5 Nano (ประหยัดสุด)", input: 0.05, output: 0.4 },
      "gpt-5-mini": { label: "GPT-5 Mini", input: 0.25, output: 2.0 },
      "gpt-4.1-nano": { label: "GPT-4.1 Nano", input: 0.1, output: 0.4 },
      "gpt-4.1-mini": { label: "GPT-4.1 Mini", input: 0.4, output: 1.6 },
      "gpt-4o-mini": { label: "GPT-4o Mini", input: 0.15, output: 0.6 },
      "gpt-5.6-sol": { label: "GPT-5.6 Sol", input: 5.0, output: 30.0 },
      "gpt-5.6-terra": { label: "GPT-5.6 Terra", input: 2.0, output: 12.0 },
      "gpt-5.6-luna": { label: "GPT-5.6 Luna", input: 0.2, output: 1.2 },
    },
  },
  gemini: {
    label: "Gemini (Google)",
    apiKeyEnv: "GOOGLE_API_KEY",
    defaultModel: "gemini-2.5-flash-lite",
    capabilities: { image: true, document: true },
    models: {
      "gemini-2.5-flash-lite": { label: "Gemini 2.5 Flash-Lite (ประหยัดสุด)", input: 0.1, output: 0.4 },
      "gemini-2.5-flash": { label: "Gemini 2.5 Flash", input: 0.3, output: 2.5 },
      "gemini-3.1-pro": { label: "Gemini 3.1 Pro", input: 2.0, output: 12.0 },
      "gemini-3.7-flash": { label: "Gemini 3.7 Flash", input: 0.75, output: 3.75 },
      "gemini-3.1-flash-lite": { label: "Gemini 3.1 Flash-Lite", input: 0.25, output: 1.5 },
    },
  },
  deepseek: {
    label: "DeepSeek",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    defaultModel: "deepseek-v4-flash",
    capabilities: { image: false, document: false },
    models: {
      "deepseek-v4-flash": { label: "DeepSeek V4 Flash", input: 0.14, output: 0.28 },
      "deepseek-v4-pro": { label: "DeepSeek V4 Pro", input: 0.435, output: 0.87 },
    },
  },

  // ===== ฟรี 100% จริง (verified จาก openrouter.ai/collections/free-models 20 ส.ค. 2026) =====
  // ราคา $0/$0 จริง ไม่ใช่แค่ free-tier — จำกัดแค่ rate limit (20 req/นาที, 50-1000 req/วัน)
  // หมายเหตุ: รายชื่อโมเดลฟรีของ OpenRouter เปลี่ยนบ่อยมาก ถ้า error "model not found"
  // ให้เข้าไปเช็ครายชื่อล่าสุดที่ https://openrouter.ai/collections/free-models ก่อนแก้ model id
  openrouter: {
    label: "OpenRouter (ฟรี $0/$0 จริง)",
    apiKeyEnv: "OPENROUTER_API_KEY", // สมัครฟรีที่ https://openrouter.ai/keys ไม่ต้องใส่บัตร
    defaultModel: "nvidia/nemotron-nano-9b-v2:free",
    capabilities: { image: false, document: false },
    models: {
      "nvidia/nemotron-nano-9b-v2:free": { label: "Nemotron Nano 9B (free, เล็ก/เร็ว)", input: 0, output: 0 },
      "google/gemma-4-26b-a4b-it:free": { label: "Gemma 4 26B (free)", input: 0, output: 0 },
      "nvidia/nemotron-3-nano-30b-a3b:free": { label: "Nemotron 3 Nano 30B (free)", input: 0, output: 0 },
      "nvidia/nemotron-3-super-120b-a12b:free": { label: "Nemotron 3 Super 120B (free, แรงสุด)", input: 0, output: 0 },
      "cohere/north-mini-code:free": { label: "Cohere North Mini Code (free, coding)", input: 0, output: 0 },
    },
  },
  // Groq ไม่ได้ฟรีจริง — เป็นราคาปกติ (ถูกมาก) แค่มี free-tier ให้โควต้าใช้ฟรีถ้าไม่เกิน
  // 30 req/นาที และ 14,400 req/วัน (ต่อ model) เกินโควต้านี้ถึงจะเริ่มมีบิลจริง
  groq: {
    label: "Groq (มี free-tier โควต้า ไม่ใช่ $0 ถาวร)",
    apiKeyEnv: "GROQ_API_KEY", // สมัครฟรีที่ https://console.groq.com/keys ไม่ต้องใส่บัตร
    defaultModel: "llama-3.1-8b-instant",
    capabilities: { image: false, document: false },
    models: {
      "llama-3.1-8b-instant": { label: "Llama 3.1 8B (เร็วสุด, ถูกสุด)", input: 0.05, output: 0.08 },
      "openai/gpt-oss-20b": { label: "GPT-OSS 20B", input: 0.075, output: 0.3 },
      "llama-3.3-70b-versatile": { label: "Llama 3.3 70B", input: 0.59, output: 0.79 },
    },
  },
};

const DEFAULT_PROVIDER = "anthropic";

function getProvider(provider) {
  return PROVIDERS[provider] || null;
}

function getPricing(provider, model) {
  return PROVIDERS[provider]?.models?.[model] || null;
}

function isValidModel(provider, model) {
  return !!getPricing(provider, model);
}
function getModelTier(provider, model) {
  if (provider === "openrouter") return "free";
  const budgetOpenAI = ["gpt-5-nano", "gpt-5-mini", "gpt-4.1-nano", "gpt-4.1-mini", "gpt-4o-mini", "gpt-5.6-luna"];
  if ((provider === "anthropic" && !model.includes("haiku")) || (provider === "openai" && !budgetOpenAI.includes(model)) || (provider === "gemini" && model.includes("pro"))) return "max";
  return "plus";
}

function calcCostUSD(provider, model, inputTokens, outputTokens) {
  const p = getPricing(provider, model) || getPricing(DEFAULT_PROVIDER, PROVIDERS[DEFAULT_PROVIDER].defaultModel);
  const usdInput = (inputTokens / 1_000_000) * p.input;
  const usdOutput = (outputTokens / 1_000_000) * p.output;
  return {
    usdInput: round(usdInput),
    usdOutput: round(usdOutput),
    usdTotal: round(usdInput + usdOutput),
  };
}

function round(n) {
  return Math.round(n * 1e6) / 1e6;
}

module.exports = {
  PROVIDERS,
  DEFAULT_PROVIDER,
  getProvider,
  getPricing,
  isValidModel,
  getModelTier,
  calcCostUSD,
  round,
};
