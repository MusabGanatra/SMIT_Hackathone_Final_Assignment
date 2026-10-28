import { Router } from 'express';
import { z } from 'zod';
import { q, tx } from '../db.js';
import { ah, HttpError } from '../utils/http.js';
import { requireRole } from '../middleware/roles.js';
import { audit, notify } from '../utils/audit.js';
import { isValidDate } from '../utils/dates.js';
import { validateLeave } from '../services/leave.js';
import { leaveBalance } from '../services/analytics.js';
import { getSettings } from '../services/settings.js';
import { todayLocal } from '../services/attendance.js';

const r = Router();
const staff = requireRole('admin', 'hr');
const emp = requireRole('employee');
const date = z.string().refine(isValidDate, 'Invalid date');

r.get('/balance', emp, ah(async (req, res) => {
  const s = await getSettings();
  res.json(await leaveBalance(req.user.employee_id, Number(todayLocal(s).slice(0, 4))));
}));

r.get('/mine', emp, ah(async (req, res) =>
  res.json((await q(`SELECT l.*, t.name AS leave_type FROM leave_requests l JOIN leave_types t ON t.id=l.leave_type_id WHERE l.employee_id=$1 ORDER BY l.created_at DESC`, [req.user.employee_id])).rows)));

r.get('/', staff, ah(async (req, res) => {
  const status = z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional().parse(req.query.status);
  const { rows } = await q(
    `SELECT l.*, t.name AS leave_type, e.full_name, e.emp_code FROM leave_requests l JOIN leave_types t ON t.id=l.leave_type_id
       JOIN employees e ON e.id=l.employee_id WHERE ($1::text IS NULL OR l.status=$1) ORDER BY l.created_at DESC LIMIT 200`, [status ?? null]);
  res.json(rows);
}));

/** Dry-run check used by the form to show days + validation before submit. */
r.post('/check', emp, ah(async (req, res) => {
  const d = z.object({ leave_type_id: z.number().int(), start_date: date, end_date: date }).parse(req.body);
  const v = await validateLeave({ query: q }, { empId: req.user.employee_id, leaveTypeId: d.leave_type_id, start: d.start_date, end: d.end_date });
  res.json({ days: v.days });
}));

r.post('/', emp, ah(async (req, res) => {
  const d = z.object({ leave_type_id: z.number().int(), start_date: date, end_date: date, reason: z.string().trim().max(500).optional() }).strict().parse(req.body);
  const row = await tx(async (db) => {
    await db.query('SELECT id FROM employees WHERE id=$1 FOR UPDATE', [req.user.employee_id]); // serialise per-employee requests
    const v = await validateLeave(db, { empId: req.user.employee_id, leaveTypeId: d.leave_type_id, start: d.start_date, end: d.end_date });
    const { rows: [x] } = await db.query(
      `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days, reason) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.employee_id, d.leave_type_id, d.start_date, d.end_date, v.days, d.reason || null]);
    await audit(db, req.user, 'create', 'leave_request', x.id, null, x);
    return x;
  });
  res.status(201).json(row);
}));

r.post('/:id/cancel', emp, ah(async (req, res) => {
  const s = await getSettings();
  const out = await tx(async (db) => {
    const { rows: [l] } = await db.query('SELECT * FROM leave_requests WHERE id=$1 AND employee_id=$2 FOR UPDATE', [req.params.id, req.user.employee_id]);
    if (!l) throw new HttpError(404, 'Leave request not found');
    if (!['pending', 'approved'].includes(l.status)) throw new HttpError(409, `A ${l.status} request cannot be cancelled`);
    if (l.status === 'approved' && l.start_date <= todayLocal(s)) throw new HttpError(409, 'Approved leave that has already started cannot be cancelled');
    const { rows: [after] } = await db.query(`UPDATE leave_requests SET status='cancelled' WHERE id=$1 RETURNING *`, [l.id]);
    await audit(db, req.user, 'cancel', 'leave_request', l.id, l, after);
    return after;
  });
  res.json(out);
}));

r.post('/:id/decision', staff, ah(async (req, res) => {
  const d = z.object({ approve: z.boolean(), comment: z.string().trim().max(500).optional() }).strict().parse(req.body);
  if (!d.approve && !d.comment) throw new HttpError(400, 'A comment is required when rejecting');
  const out = await tx(async (db) => {
    const { rows: [l] } = await db.query('SELECT * FROM leave_requests WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!l) throw new HttpError(404, 'Leave request not found');
    if (l.status !== 'pending') throw new HttpError(409, 'This request was already decided');
    if (d.approve) await validateLeave(db, { empId: l.employee_id, leaveTypeId: l.leave_type_id, start: l.start_date, end: l.end_date, excludeId: l.id }); // re-check at approval time
    const { rows: [after] } = await db.query(
      `UPDATE leave_requests SET status=$1, reviewed_by=$2, review_comment=$3, reviewed_at=now() WHERE id=$4 RETURNING *`,
      [d.approve ? 'approved' : 'rejected', req.user.id, d.comment || null, l.id]);
    await audit(db, req.user, d.approve ? 'approve' : 'reject', 'leave_request', l.id, l, after);
    const { rows: [e] } = await db.query('SELECT user_id FROM employees WHERE id=$1', [l.employee_id]);
    await notify(db, e.user_id, `Leave ${after.status}`, `${l.start_date} to ${l.end_date}. ${d.comment || ''}`.trim());
    return after;
  });
  res.json(out);
}));

export default r;
