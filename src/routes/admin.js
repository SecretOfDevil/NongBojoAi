const express = require("express");
const { requireAdmin } = require("../middleware/auth");
const { listAccounts, setAccountTier, listPaymentApprovals, getPaymentSlip, reviewPaymentOrder, logAuditEvent, getModelStatuses, setModelStatus } = require("../utils/db");

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
router.get("/models", requireAdmin, async (req, res, next) => { try { res.json({ models: await getModelStatuses() }); } catch (e) { next(e); } });
router.patch("/models/status", requireAdmin, async (req, res, next) => {
  try {
    if (typeof req.body?.provider !== "string" || typeof req.body?.model !== "string" || typeof req.body?.online !== "boolean") return res.status(400).json({ error: "provider, model and online are required" });
    const model = await setModelStatus(req.body.provider, req.body.model, req.body.online);
    if (!model) return res.status(404).json({ error: "model not found" });
    res.json({ model });
  } catch (e) { next(e); }
});
router.patch("/models/:provider/:model/status", requireAdmin, async (req, res, next) => {
  try {
    if (typeof req.body?.online !== "boolean") return res.status(400).json({ error: "online must be boolean" });
    const model = await setModelStatus(req.params.provider, req.params.model, req.body.online);
    if (!model) return res.status(404).json({ error: "model not found" });
    res.json({ model });
  } catch (e) { next(e); }
});
router.get("/payment-approvals", requireAdmin, async (req,res,next) => { try { res.json({ orders: await listPaymentApprovals() }); } catch(e){next(e)} });
router.get("/payment-approvals/:id/slip", requireAdmin, async (req,res,next) => { try { const slip=await getPaymentSlip(req.params.id); if(!slip)return res.status(404).json({error:"slip not found"}); res.type(slip.slip_mime).send(slip.slip_data); } catch(e){next(e)} });
router.post("/payment-approvals/:id/review", requireAdmin, async (req,res,next) => { try { const approved=req.body?.action === "approve"; if(!approved && req.body?.action !== "reject") return res.status(400).json({error:"invalid action"}); const order=await reviewPaymentOrder(req.params.id,approved,req.body?.note || ""); if(!order)return res.status(404).json({error:"order not found or already reviewed"}); await logAuditEvent({eventType:approved?"payment_approved":"payment_rejected",username:req.header("x-admin-username")||null,ipAddress:req.ip,method:req.method,path:req.path,statusCode:200,metadata:{orderId:order.id,tier:order.tier}}); res.json({order}); } catch(e){next(e)} });

module.exports = router;
