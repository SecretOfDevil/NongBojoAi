# Claude Proxy — เว็บแชท AI หลายค่าย พร้อมคิดเงิน/limit/ไฟล์แนบ

เว็บเซิร์ฟเวอร์ (Node.js/Express) ที่ครอบ API ของ **Claude, GPT (OpenAI), Gemini (Google), DeepSeek และ Qwen (Alibaba DashScope)**
ไว้อีกชั้น ให้คุณแจก **API key ของตัวเอง** ให้ผู้ใช้แต่ละคน โดยระบบจะ:

- แชทแบบมี **ประวัติ (multi-turn history)** เหมือนแอปแชทจริง มี sidebar เลือกแชทเก่าได้
- สลับเรียกโมเดลได้ 5 ค่าย: Claude / GPT / Gemini / DeepSeek / Qwen จากเมนูเดียว
- คำนวณค่าใช้จ่ายเป็นเงิน USD + THB จาก token จริงที่แต่ละค่ายใช้
- **ตัดจบทันทีห้ามเกิน limit** — เช็คงบประมาณ "ก่อน" ยิงไปจริงเสมอ (hard cutoff แบบ pre-flight)
- จำกัด request/นาที ต่อ API key
- รับไฟล์แนบ: รูปภาพ, PDF, txt/csv (แต่ละค่ายรองรับไฟล์ไม่เท่ากัน ระบบเช็คให้อัตโนมัติ)
- ตอบกลับมาพร้อม**ไฟล์ดาวน์โหลด (.md)** ของคำตอบทุกครั้ง
- มี **animation ตอน AI กำลังตอบ** (typing dots + พิมพ์ทีละตัวอักษร) ให้รู้ว่าเว็บไม่ตาย

## 1. ติดตั้ง

```bash
cd claude-proxy
npm install
cp .env.example .env
```

แก้ไฟล์ `.env` — ใส่ API key ของค่ายที่จะใช้ (ใส่แค่ตัวที่จะเปิดใช้งานก็พอ ตัวที่ไม่ใส่จะ error เฉพาะตอนเลือกใช้ค่ายนั้น):

```
ANTHROPIC_API_KEY=sk-ant-...   # https://console.anthropic.com
OPENAI_API_KEY=sk-...          # https://platform.openai.com/api-keys
GOOGLE_API_KEY=AIza...         # https://aistudio.google.com/apikey
DEEPSEEK_API_KEY=sk-...        # https://platform.deepseek.com/api_keys
QWEN_API_KEY=sk-...            # https://bailian.console.aliyun.com/
# QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
ADMIN_KEY=ตั้งรหัสลับของคุณเอง
```

## 2. รันเซิร์ฟเวอร์

```bash
npm start
```

เปิด `http://localhost:3000` จะเจอหน้าแชท (มี API key ตัวอย่าง `demo-key-123` งบ $1/วัน, $10/เดือน เตรียมไว้ให้)

## 3. โครงสร้างโปรเจกต์

```
claude-proxy/
├── server.js
├── src/
│   ├── config/pricing.js       # ราคา + ความสามารถของแต่ละ provider (ที่เดียวจบ)
│   ├── providers/
│   │   ├── index.js            # ตัวกลาง เลือกยิงไป provider ที่ถูกต้อง
│   │   ├── anthropic.js        # Claude
│   │   ├── gemini.js           # Gemini (เรียก REST ตรง)
│   │   └── openaiCompatible.js # ใช้ร่วมกันได้ทั้ง OpenAI และ DeepSeek (API เข้ากันได้)
│   ├── middleware/
│   │   ├── auth.js             # ตรวจ x-api-key / x-admin-key
│   │   ├── rateLimiter.js      # limit จำนวน request/นาที
│   │   └── upload.js           # multer รับไฟล์อัปโหลด
│   ├── routes/
│   │   ├── chat.js             # POST /v1/chat — endpoint หลัก + hard budget cutoff
│   │   ├── conversations.js    # GET/DELETE ประวัติแชท
│   │   ├── download.js         # โหลดคำตอบ AI เป็นไฟล์ .md
│   │   ├── usage.js            # เช็คงบเหลือ
│   │   └── admin.js            # จัดการ API key
│   └── utils/
│       ├── db.js               # เก็บ key + usage + conversations (data/db.json)
│       ├── estimateTokens.js   # ประมาณ token คร่าวๆ ก่อนยิงจริง (ใช้กัน budget เกิน)
│       └── fileToContentBlock.js
└── public/index.html           # หน้าแชท (sidebar + provider selector + gauge)
```

## 4. การใช้งาน API

### เริ่มแชทใหม่ / คุยต่อในแชทเดิม

```bash
curl -X POST http://localhost:3000/v1/chat \
  -H "x-api-key: demo-key-123" \
  -F "message=สวัสดี ช่วยแนะนำตัวหน่อย" \
  -F "provider=anthropic" \
  -F "model=claude-sonnet-5" \
  -F "max_tokens=512"
```

Response จะมี `conversationId` — ส่งกลับมาในการเรียกครั้งถัดไปเพื่อคุยต่อในแชทเดิม (มี memory):

```bash
curl -X POST http://localhost:3000/v1/chat \
  -H "x-api-key: demo-key-123" \
  -F "message=ขยายความข้อ 2 หน่อย" \
  -F "conversationId=conv_xxxxxxxx" \
  -F "provider=anthropic" \
  -F "model=claude-sonnet-5"
```

Response:
```json
{
  "conversationId": "conv_xxxxxxxx",
  "reply": "...",
  "provider": "anthropic",
  "model": "claude-sonnet-5",
  "usage": { "inputTokens": 512, "outputTokens": 180, "totalTokens": 692 },
  "cost": { "usd": 0.002824, "usdInput": 0.001024, "usdOutput": 0.0018, "thb": 0.1 },
  "download": { "responseId": "resp_xxxxxxxx", "url": "/v1/download/resp_xxxxxxxx" }
}
```

### โหลดคำตอบเป็นไฟล์

```bash
curl -O -J http://localhost:3000/v1/download/resp_xxxxxxxx -H "x-api-key: demo-key-123"
```

### สลับไปใช้ค่ายอื่น (GPT / Gemini / DeepSeek)

```bash
curl -X POST http://localhost:3000/v1/chat \
  -H "x-api-key: demo-key-123" \
  -F "message=Hello" \
  -F "provider=openai" \
  -F "model=gpt-5.6-terra"
```

รายชื่อ provider/model + ความสามารถ (รับไฟล์ชนิดไหนได้บ้าง):
```bash
curl http://localhost:3000/v1/models
```

### ประวัติแชท

```bash
curl http://localhost:3000/v1/conversations -H "x-api-key: demo-key-123"
curl http://localhost:3000/v1/conversations/conv_xxxxxxxx -H "x-api-key: demo-key-123"
curl -X DELETE http://localhost:3000/v1/conversations/conv_xxxxxxxx -H "x-api-key: demo-key-123"
```

### เช็คงบประมาณคงเหลือ

```bash
curl http://localhost:3000/v1/usage -H "x-api-key: demo-key-123"
```

## 5. ระบบตัดจบไม่ให้เกิน limit ทำงานยังไง

ก่อนยิง request ไปยัง provider จริงทุกครั้ง ระบบจะ:

1. ประมาณ token ของข้อความ (แบบ over-estimate เผื่อไว้) + `max_tokens` ที่ขอ
2. คำนวณ **ค่าใช้จ่ายสูงสุดที่เป็นไปได้** ของ request นี้
3. เช็คว่า (ยอดที่ใช้ไปแล้ววันนี้/เดือนนี้ + ค่าใช้จ่ายสูงสุดที่ประเมิน) เกินงบที่ตั้งไว้ไหม
4. **ถ้าเกิน → บล็อกทันที ไม่ยิงไป provider เลย** ตอบกลับ `429` พร้อม `code: "BUDGET_LIMIT_REACHED"`

วิธีนี้ทำให้ request เดียวไม่มีทางทำให้ยอดรวมเกิน budget ที่ตั้งไว้ (ต่างจากการเช็คหลังยิงเสร็จ ซึ่งอาจปล่อยให้เกินไปแล้วค่อยรู้)

## 6. จัดการ API key (แอดมิน)

ต้องแนบ header `x-admin-key: <ADMIN_KEY ที่ตั้งใน .env>`

```bash
# สร้าง key ใหม่
curl -X POST http://localhost:3000/admin/keys \
  -H "x-admin-key: change-me-admin-secret" -H "Content-Type: application/json" \
  -d '{ "name": "ลูกค้า A", "dailyBudgetUSD": 2, "monthlyBudgetUSD": 30, "requestsPerMinute": 20 }'

# แก้ limit
curl -X PATCH http://localhost:3000/admin/keys/sk-proxy-xxxxxx \
  -H "x-admin-key: change-me-admin-secret" -H "Content-Type: application/json" \
  -d '{ "dailyBudgetUSD": 5 }'

# ลบ key
curl -X DELETE http://localhost:3000/admin/keys/sk-proxy-xxxxxx -H "x-admin-key: change-me-admin-secret"

# ดู key ทั้งหมด
curl http://localhost:3000/admin/keys -H "x-admin-key: change-me-admin-secret"
```

## 7. ราคาโมเดล (USD ต่อ 1M token, สิงหาคม 2026)

| Provider | โมเดล | Input | Output |
|---|---|---|---|
| Claude | claude-haiku-4-5-20251001 | $1 | $5 |
| Claude | claude-sonnet-5 | $2 | $10 |
| Claude | claude-opus-4-8 | $5 | $25 |
| Claude | claude-fable-5 | $10 | $50 |
| OpenAI | gpt-5.6-luna | $0.2 | $1.2 |
| OpenAI | gpt-5-nano | $0.05 | $0.40 |
| OpenAI | gpt-5-mini | $0.25 | $2 |
| OpenAI | gpt-4.1-nano | $0.10 | $0.40 |
| OpenAI | gpt-4.1-mini | $0.40 | $1.60 |
| OpenAI | gpt-4o-mini | $0.15 | $0.60 |
| OpenAI | gpt-5.6-terra | $2 | $12 |
| OpenAI | gpt-5.6-sol | $5 | $30 |
| Gemini | gemini-2.5-flash-lite | $0.10 | $0.40 |
| Gemini | gemini-2.5-flash | $0.30 | $2.50 |
| Gemini | gemini-3.1-flash-lite | $0.25 | $1.5 |
| Gemini | gemini-3.7-flash | $0.75 | $3.75 |
| Gemini | gemini-3.1-pro | $2 | $12 |
| DeepSeek | deepseek-v4-flash | $0.14 | $0.28 |
| DeepSeek | deepseek-v4-pro | $0.435 | $0.87 |

ราคาจริงเปลี่ยนได้ ตรวจสอบล่าสุดแล้วแก้ในไฟล์ `src/config/pricing.js`

## 8. ไฟล์แนบ — ค่ายไหนรับอะไรได้บ้าง

| Provider | รูปภาพ | PDF/เอกสาร |
|---|---|---|
| Claude | ✅ | ✅ |
| GPT | ✅ | ❌ |
| Gemini | ✅ | ✅ |
| DeepSeek | ❌ | ❌ |

ถ้าแนบไฟล์ที่ค่ายนั้นไม่รองรับ ระบบจะตอบ error กลับมาทันทีก่อนยิงจริง (ไม่เสียเงินฟรี)

## 9. ก่อนใช้งานจริง (production) ควรทำเพิ่ม

- [ ] ใส่ HTTPS (reverse proxy ผ่าน nginx/Caddy)
- [ ] ย้ายจาก `data/db.json` ไปเป็นฐานข้อมูลจริง (Postgres/Redis) ถ้ามีผู้ใช้เยอะ
- [ ] เพิ่ม authentication ที่แข็งแรงกว่า static API key ถ้าเปิดให้คนนอกใช้
- [ ] ตั้ง `helmet` middleware กัน header attack พื้นฐาน
- [ ] backup ไฟล์ `data/db.json` เป็นประจำ
- [ ] ลบไฟล์เก่าใน `data/responses/` เป็นระยะ (cron job) กันดิสก์เต็ม
