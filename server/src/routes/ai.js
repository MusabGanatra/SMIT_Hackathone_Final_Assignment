import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { ah } from '../utils/http.js';
import { isValidDate } from '../utils/dates.js';
import { requireRole } from '../middleware/roles.js';
import { chat, dashboardSummary, parseLeave } from '../services/ai.js';

const r = Router();
r.use(rateLimit({ windowMs: 60 * 1000, limit: 20, keyGenerator: (req) => String(req.user.id), standardHeaders: true, legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false }, message: { error: 'You are sending AI requests too quickly. Please wait a minute.' } }));

r.post('/chat', ah(async (req, res) => {
  const { messages } = z.object({ messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(2000) })).min(1).max(20) }).parse(req.body);
  if (messages.at(-1).role !== 'user') return res.status(400).json({ error: 'Last message must be from the user' });
  res.json(await chat(req.user, messages));
}));

r.post('/summary', requireRole('admin', 'hr'), ah(async (req, res) => {
  const d = z.object({ from: z.string().refine(isValidDate).optional(), to: z.string().refine(isValidDate).optional(), department_id: z.number().int().optional() }).parse(req.body);
  res.json(await dashboardSummary(req.user, { from: d.from, to: d.to, deptId: d.department_id ?? null }));
}));

r.post('/parse-leave', requireRole('employee'), ah(async (req, res) => {
  const { text } = z.object({ text: z.string().trim().min(3).max(500) }).parse(req.body);
  res.json(await parseLeave(req.user, text));
}));

export default r;
