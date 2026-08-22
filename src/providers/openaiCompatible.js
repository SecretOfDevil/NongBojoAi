// ใช้ fetch แบบ built-in ของ Node 18+ เรียก REST API ตรงๆ
// รองรับทั้ง OpenAI และ DeepSeek เพราะ DeepSeek ทำ API ให้เข้ากันได้กับ OpenAI (OpenAI-compatible)

function toOpenAIContent(blocks) {
  return blocks.map((b) => {
    if (b.type === "text") return { type: "text", text: b.text };
    if (b.type === "image")
      return { type: "image_url", image_url: { url: `data:${b.mimetype};base64,${b.base64}` } };
    throw new Error(`unsupported block type for openai-compatible: ${b.type}`);
  });
}

/**
 * @param {string} baseUrl - เช่น https://api.openai.com/v1 หรือ https://api.deepseek.com
 * @param {string} apiKey
 * @param {string} model
 * @param {Array} history - universal message history
 * @param {{system?:string, maxTokens:number}} opts
 */
async function call(baseUrl, apiKey, model, history, opts) {
  if (!apiKey) throw new Error("missing API key for this provider (ตั้งค่าใน .env)");

  const messages = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  for (const m of history) {
    messages.push({ role: m.role, content: toOpenAIContent(m.content) });
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: opts.maxTokens,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `provider error (${res.status})`);
  }

  return {
    text: data.choices?.[0]?.message?.content || "",
    inputTokens: data.usage?.prompt_tokens || 0,
    outputTokens: data.usage?.completion_tokens || 0,
  };
}

module.exports = { call };
