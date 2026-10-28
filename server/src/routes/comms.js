import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db.js';
import { ah, HttpError } from '../utils/http.js';
import { requireRole } from '../middleware/roles.js';
import { audit } from '../utils/audit.js';

const r = Router();

r.get('/announcements', ah(async (_req, res) => res.json((await q(
  `SELECT a.id,a.title,a.body,a.created_at,u.display_name AS author FROM announcements a LEFT JOIN users u ON u.id=a.created_by ORDER BY a.created_at DESC LIMIT 50`)).rows)));

r.post('/announcements', requireRole('admin', 'hr'), ah(async (req, res) => {
  const d = z.object({ title: z.string().trim().min(3).max(150), body: z.string().trim().min(3).max(3000) }).strict().parse(req.body);
  const { rows: [a] } = await q('INSERT INTO announcements (title, body, created_by) VALUES ($1,$2,$3) RETURNING *', [d.title, d.body, req.user.id]);
  await audit(null, req.user, 'create', 'announcement', a.id, null, a);
  res.status(201).json(a);
}));

r.delete('/announcements/:id', requireRole('admin'), ah(async (req, res) => {
  const { rows: [a] } = await q('DELETE FROM announcements WHERE id=$1 RETURNING *', [req.params.id]);
  if (!a) throw new HttpError(404, 'Announcement not found');
  await audit(null, req.user, 'delete', 'announcement', a.id, a, null);
  res.json({ ok: true });
}));

r.get('/notifications', ah(async (req, res) => {
  const { rows } = await q('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [req.user.id]);
  res.json({ unread: rows.filter((n) => !n.read).length, items: rows });
}));
r.post('/notifications/read-all', ah(async (req, res) => { await q('UPDATE notifications SET read=TRUE WHERE user_id=$1', [req.user.id]); res.json({ ok: true }); }));
r.post('/notifications/:id/read', ah(async (req, res) => { await q('UPDATE notifications SET read=TRUE WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]); res.json({ ok: true }); }));

r.get('/audit-logs', requireRole('admin'), ah(async (req, res) => {
  const p = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), entity: z.string().max(50).optional() }).parse(req.query);
  const { rows } = await q(
    `SELECT *, count(*) OVER() AS total FROM audit_logs WHERE ($1::text IS NULL OR entity=$1) ORDER BY id DESC LIMIT $2 OFFSET $3`,
    [p.entity ?? null, p.pageSize, (p.page - 1) * p.pageSize]);
  res.json({ total: rows[0]?.total || 0, page: p.page, rows: rows.map(({ total, ...x }) => x) }); // read-only: no write endpoints exist
}));

export default r;
