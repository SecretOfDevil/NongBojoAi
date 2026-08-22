const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// แปลง content block กลาง (universal) -> รูปแบบของ Anthropic
function toAnthropicContent(blocks) {
  return blocks.map((b) => {
    if (b.type === "text") return { type: "text", text: b.text };
    if (b.type === "image")
      return { type: "image", source: { type: "base64", media_type: b.mimetype, data: b.base64 } };
    if (b.type === "document")
      return { type: "document", source: { type: "base64", media_type: b.mimetype, data: b.base64 } };
    throw new Error(`unsupported block type for anthropic: ${b.type}`);
  });
}

/**
 * @param {string} model
 * @param {Array<{role:'user'|'assistant', content:Array}>} history - universal message history
 * @param {{system?:string, maxTokens:number}} opts
 * @returns {Promise<{text:string, inputTokens:number, outputTokens:number}>}
 */
async function call(model, history, opts) {
  const messages = history.map((m) => ({
    role: m.role,
    content: toAnthropicContent(m.content),
  }));

  const res = await client.messages.create({
    model,
    max_tokens: opts.maxTokens,
    system: opts.system || undefined,
    messages,
  });

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return {
    text,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  };
}

module.exports = { call };
