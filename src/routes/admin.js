const express = require("express");
const { requireAdmin } = require("../middleware/auth");
const { listAccounts, setAccountTier } = require("../utils/db");

const router = express.Router();

// GET /admin/keys — ดู key ทั้งหมด (ต้องมี x-admin-key header)
router.get("/accounts", requireAdmin, async (req, res, next) => {
  try { res.json({ accounts: await listAccounts() }); } catch (e) { next(e); }
});

// POST /admin/keys — สร้าง key ใหม่ พร้อมตั้ง limit
// body: { name, dailyBudgetUSD, monthlyBudgetUSD, requestsPerMinute }
router.patch("/accounts/:apiKey/tier", requireAdmin, async (req, res, next) => {
  try { const tier = req.body?.tier; if (!['free','plus','max'].includes(tier)) return res.status(400).json({error:'invalid tier'}); const account=await setAccountTier(req.params.apiKey,tier); if(!account)return res.status(404).json({error:'account not found'}); res.json({account}); } catch(e){next(e);}
});

module.exports = router;
