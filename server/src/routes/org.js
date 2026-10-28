import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { q, tx } from '../db.js';
import { ah, HttpError } from '../utils/http.js';
import { requireRole } from '../middleware/roles.js';
import { audit } from '../utils/audit.js';
import { getSettings } from '../services/settings.js';
import { tempPassword } from '../services/employees.js';
import { isValidDate } from '../utils/dates.js';

const r = Router();
const admin = requireRole('admin');

/* ---- Company settings (admin writes; hr/employee can read what they need) ---- */
r.get('/settings', ah(async (req, res) => {
  const s = await getSettings();
  if (req.user.role !== 'admin') { delete s.office_lat; delete s.office_lng; delete s.tax_slabs; }
  res.json(s);
}));

const slab = z.object({ upTo: z.number().positive().nullable(), rate: z.number().min(0).max(1) });
const settingsSchema = z.object({
  name: z.string().min(2).max(120), timezone: z.string().refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }, 'Invalid timezone'),
  office_start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), grace_minutes: z.number().int().min(0).max(120),
  halfday_hours: z.number().min(1).max(12), weekends: z.array(z.number().int().min(0).max(6)).max(6),
  office_lat: z.number().min(-90).max(90).nullable(), office_lng: z.number().min(-180).max(180).nullable(),
  radius_m: z.number().int().min(10).max(50000).nullable(),
  tax_slabs: z.array(slab).min(1).refine((a) => a.every((x, i) => i === 0 || a[i - 1].upTo != null && (x.upTo == null || x.upTo > a[i - 1].upTo)), 'Slabs must ascend; only the last may be open-ended'),
}).strict();

r.put('/settings', admin, ah(async (req, res) => {
  const d = settingsSchema.parse(req.body);
  const before = await getSettings();
  const { rows: [after] } = await q(
    `UPDATE company_settings SET name=$1, timezone=$2, office_start=$3, grace_minutes=$4, halfday_hours=$5, weekends=$6,
       office_lat=$7, office_lng=$8, radius_m=$9, tax_slabs=$10, updated_at=now() WHERE id=1 RETURNING *`,
    [d.name, d.timezone, d.office_start, d.grace_minutes, d.halfday_hours, d.weekends, d.office_lat, d.office_lng, d.radius_m, JSON.stringify(d.tax_slabs)]);
  await audit(null, req.user, 'update', 'company_settings', 1, before, after);
  res.json(after);
}));

/* ---- Generic CRUD for simple lookup tables: anyone signed-in reads, admin writes ---- */
function crud(path, table, schema, cols, order) {
  r.get(path, ah(async (_req, res) => res.json((await q(`SELECT * FROM ${table} ORDER BY ${order}`)).rows)));
  r.post(path, admin, ah(async (req, res) => {
    const d = schema.parse(req.body);
    const { rows: [row] } = await q(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, cols.map((c) => d[c] ?? null))
      .catch(dupe);
    await audit(null, req.user, 'create', table, row.id, null, row);
    res.status(201).json(row);
  }));
  r.put(path + '/:id', admin, ah(async (req, res) => {
    const d = schema.parse(req.body);
    const { rows: [before] } = await q(`SELECT * FROM ${table} WHERE id=$1`, [req.params.id]);
    if (!before) throw new HttpError(404, 'Not found');
    const { rows: [row] } = await q(`UPDATE ${table} SET ${cols.map((c, i) => `${c}=$${i + 1}`).join(',')} WHERE id=$${cols.length + 1} RETURNING *`,
      [...cols.map((c) => d[c] ?? null), req.params.id]).catch(dupe);
    await audit(null, req.user, 'update', table, row.id, before, row);
    res.json(row);
  }));
  r.delete(path + '/:id', admin, ah(async (req, res) => {
    const { rows: [before] } = await q(`DELETE FROM ${table} WHERE id=$1 RETURNING *`, [req.params.id])
      .catch(() => { throw new HttpError(409, 'This item is in use and cannot be deleted'); });
    if (!before) throw new HttpError(404, 'Not found');
    await audit(null, req.user, 'delete', table, before.id, before, null);
    res.json({ ok: true });
  }));
}
const dupe = (e) => { throw new HttpError(e.code === '23505' ? 409 : 400, e.code === '23505' ? 'That entry already exists' : 'Invalid data'); };
const name = z.object({ name: z.string().trim().min(2).max(80) });
crud('/departments', 'departments', name, ['name'], 'name');
crud('/designations', 'designations', name, ['name'], 'name');
crud('/leave-types', 'leave_types', z.object({
  code: z.string().trim().regex(/^[a-z_]{2,20}$/, 'Code: lowercase letters/underscore'), name: z.string().trim().min(2).max(60),
  annual_quota: z.number().int().min(0).max(366).nullable(), paid: z.boolean(),
}), ['code', 'name', 'annual_quota', 'paid'], 'id');
crud('/holidays', 'holidays', z.object({ date: z.string().refine(isValidDate, 'Invalid date'), name: z.string().trim().min(2).max(100) }), ['date', 'name'], 'date');

/* ---- Staff logins (admin): create HR, deactivate, reset ---- */
r.get('/users', admin, ah(async (_req, res) =>
  res.json((await q('SELECT id,email,role,display_name,active,must_change_password,created_at FROM users ORDER BY id')).rows)));

r.post('/users', admin, ah(async (req, res) => {
  const d = z.object({ email: z.string().email(), name: z.string().min(2).max(100), role: z.enum(['hr', 'admin']) }).parse(req.body);
  const pw = tempPassword();
  const { rows: [u] } = await q(
    `INSERT INTO users (email, password_hash, role, display_name, must_change_password) VALUES ($1,$2,$3,$4,TRUE) RETURNING id,email,role,display_name`,
    [d.email.toLowerCase(), await bcrypt.hash(pw, 10), d.role, d.name]).catch(dupe);
  await audit(null, req.user, 'create', 'user', u.id, null, u);
  res.status(201).json({ user: u, temp_password: pw });
}));

r.patch('/users/:id/active', admin, ah(async (req, res) => {
  const { active } = z.object({ active: z.boolean() }).parse(req.body);
  if (Number(req.params.id) === req.user.id) throw new HttpError(400, 'You cannot deactivate your own account');
  const { rows: [u] } = await q('UPDATE users SET active=$1 WHERE id=$2 RETURNING id,email,role,active', [active, req.params.id]);
  if (!u) throw new HttpError(404, 'User not found');
  await audit(null, req.user, active ? 'activate' : 'deactivate', 'user', u.id, null, u);
  res.json(u);
}));

r.post('/users/:id/reset-password', admin, ah(async (req, res) => {
  const pw = tempPassword();
  const { rows: [u] } = await q('UPDATE users SET password_hash=$1, must_change_password=TRUE WHERE id=$2 RETURNING id,email',
    [await bcrypt.hash(pw, 10), req.params.id]);
  if (!u) throw new HttpError(404, 'User not found');
  await audit(null, req.user, 'reset_password', 'user', u.id);
  res.json({ email: u.email, temp_password: pw });
}));

export default r;
