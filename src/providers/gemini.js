// เรียก Gemini API ตรงๆ ผ่าน REST (generateContent)

function toGeminiParts(blocks) {
  return blocks.map((b) => {
    if (b.type === "text") return { text: b.text };
    if (b.type === "image" || b.type === "document")
      return { inlineData: { mimeType: b.mimetype, data: b.base64 } };
    throw new Error(`unsupported block type for gemini: ${b.type}`);
  });
}

/**
 * @param {string} apiKey
 * @param {string} model
 * @param {Array} history - universal message history (role: user/assistant)
 * @param {{system?:string, maxTokens:number}} opts
 */
async function call(apiKey, model, history, opts) {
  if (!apiKey) throw new Error("missing API key for this provider (ตั้งค่าใน .env)");

  const contents = history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: toGeminiParts(m.content),
  }));

  const body = {
    contents,
    generationConfig: { maxOutputTokens: opts.maxTokens },
  };
  if (opts.system) {
    body.systemInstruction = { parts: [{ text: opts.system }] };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `provider error (${res.status})`);
  }

  const text = (data.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || "")
    .join("\n");

  return {
    text,
    inputTokens: data.usageMetadata?.promptTokenCount || 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
  };
}

module.exports = { call };
