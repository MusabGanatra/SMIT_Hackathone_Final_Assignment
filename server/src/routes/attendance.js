import { Router } from 'express';
import { z } from 'zod';
import { q, tx } from '../db.js';
import { ah, HttpError } from '../utils/http.js';
import { requireRole, assertEmployeeScope } from '../middleware/roles.js';
import { audit, notify } from '../utils/audit.js';
import { isValidDate, monthRange } from '../utils/dates.js';
import { getSettings } from '../services/settings.js';
import { checkIn, checkOut, employeeDays, todayLocal, upsertFromTimes } from '../services/attendance.js';

const r = Router();
const staff = requireRole('admin', 'hr');
const emp = requireRole('employee');
const date = z.string().refine(isValidDate, 'Invalid date');
const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

r.post('/check-in', emp, ah(async (req, res) => res.status(201).json(await checkIn(req.user.employee_id))));
r.post('/check-out', emp, ah(async (req, res) => res.json(await checkOut(req.user.employee_id))));

r.get('/today', emp, ah(async (req, res) => {
  const s = await getSettings();
  const { rows: [rec] } = await q('SELECT * FROM attendance WHERE employee_id=$1 AND work_date=$2', [req.user.employee_id, todayLocal(s)]);
  res.json({ date: todayLocal(s), record: rec || null });
}));

r.get('/calendar', ah(async (req, res) => {
  const p = z.object({ month: month.optional(), employee_id: z.coerce.number().int().optional() }).parse(req.query);
  const empId = req.user.role === 'employee' ? req.user.employee_id : p.employee_id;
  if (!empId) throw new HttpError(400, 'employee_id is required');
  assertEmployeeScope(req.user, empId);
  const s = await getSettings();
  const { from, to } = monthRange(p.month || todayLocal(s).slice(0, 7));
  res.json({ month: from.slice(0, 7), days: await employeeDays({ query: q }, empId, from, to, s) });
}));

/** Daily board for HR/Admin: every active employee's status on one date. */
r.get('/board', staff, ah(async (req, res) => {
  const p = z.object({ date: date.optional(), department_id: z.coerce.number().int().optional() }).parse(req.query);
  const s = await getSettings();
  const d = p.date || todayLocal(s);
  const { rows: emps } = await q(
    `SELECT e.id, e.emp_code, e.full_name, dp.name AS department FROM employees e LEFT JOIN departments dp ON dp.id=e.department_id
      WHERE e.join_date <= $1 AND (e.leave_date IS NULL OR e.leave_date >= $1) AND ($2::int IS NULL OR e.department_id=$2) ORDER BY e.full_name`, [d, p.department_id ?? null]);
  const rows = [];
  for (const e of emps) {
    const [day] = await employeeDays({ query: q }, e.id, d, d, s);
    rows.push({ ...e, status: day.status, check_in: day.check_in, check_out: day.check_out });
  }
  res.json({ date: d, rows });
}));

/** HR/Admin can correct a record directly (audited, with before/after). */
r.put('/record', staff, ah(async (req, res) => {
  const d = z.object({ employee_id: z.number().int(), work_date: date, check_in: hm, check_out: hm.nullable().optional() }).strict().parse(req.body);
  const s = await getSettings();
  const out = await tx(async (db) => {
    const x = await upsertFromTimes(db, d.employee_id, d.work_date, d.check_in, d.check_out || null, s);
    await audit(db, req.user, 'correct_attendance', 'attendance', x.after.id, x.before, x.after);
    return x.after;
  });
  res.json(out);
}));

/* ---- Correction requests ---- */
r.post('/corrections', emp, ah(async (req, res) => {
  const d = z.object({ work_date: date, check_in: hm, check_out: hm.nullable().optional(), reason: z.string().trim().min(5).max(500) }).strict().parse(req.body);
  const s = await getSettings();
  if (d.work_date > todayLocal(s)) throw new HttpError(400, 'You cannot request a correction for a future date');
  const { rows: [dup] } = await q(`SELECT 1 FROM attendance_corrections WHERE employee_id=$1 AND work_date=$2 AND status='pending'`, [req.user.employee_id, d.work_date]);
  if (dup) throw new HttpError(409, 'A pending correction already exists for that date');
  const { rows: [row] } = await q(
    `INSERT INTO attendance_corrections (employee_id, work_date, requested_check_in, requested_check_out, reason) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.user.employee_id, d.work_date, d.check_in, d.check_out || null, d.reason]);
  await audit(null, req.user, 'create', 'attendance_correction', row.id, null, row);
  res.status(201).json(row);
}));

r.get('/corrections', ah(async (req, res) => {
  const status = z.enum(['pending', 'approved', 'rejected']).optional().parse(req.query.status);
  const own = req.user.role === 'employee';
  const { rows } = await q(
    `SELECT c.*, e.full_name, e.emp_code FROM attendance_corrections c JOIN employees e ON e.id=c.employee_id
      WHERE ($1::int IS NULL OR c.employee_id=$1) AND ($2::text IS NULL OR c.status=$2) ORDER BY c.created_at DESC LIMIT 200`,
    [own ? req.user.employee_id : null, status ?? null]);
  res.json(rows);
}));

r.post('/corrections/:id/decision', staff, ah(async (req, res) => {
  const d = z.object({ approve: z.boolean(), comment: z.string().trim().max(500).optional() }).strict().parse(req.body);
  if (!d.approve && !d.comment) throw new HttpError(400, 'A comment is required when rejecting');
  const s = await getSettings();
  const out = await tx(async (db) => {
    const { rows: [c] } = await db.query('SELECT * FROM attendance_corrections WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!c) throw new HttpError(404, 'Correction not found');
    if (c.status !== 'pending') throw new HttpError(409, 'This request was already decided');
    if (d.approve) {
      const x = await upsertFromTimes(db, c.employee_id, c.work_date, c.requested_check_in, c.requested_check_out, s);
      await audit(db, req.user, 'approve_correction', 'attendance', x.after.id, x.before, x.after);
    }
    const { rows: [after] } = await db.query(
      `UPDATE attendance_corrections SET status=$1, reviewed_by=$2, review_comment=$3, reviewed_at=now() WHERE id=$4 RETURNING *`,
      [d.approve ? 'approved' : 'rejected', req.user.id, d.comment || null, c.id]);
    await audit(db, req.user, d.approve ? 'approve' : 'reject', 'attendance_correction', c.id, c, after);
    const { rows: [e] } = await db.query('SELECT user_id FROM employees WHERE id=$1', [c.employee_id]);
    await notify(db, e.user_id, `Attendance correction ${after.status}`, `Date ${c.work_date}. ${d.comment || ''}`.trim());
    return after;
  });
  res.json(out);
}));

export default r;
