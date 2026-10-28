import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import { q, tx } from '../db.js';
import { ah, HttpError } from '../utils/http.js';
import { requireRole } from '../middleware/roles.js';
import { audit, notify } from '../utils/audit.js';
import { generateDraft } from '../services/payroll.js';
import { getSettings } from '../services/settings.js';

const r = Router();
const staff = requireRole('admin', 'hr');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be YYYY-MM');

r.get('/runs', staff, ah(async (_req, res) => res.json((await q(
  `SELECT r.*, (SELECT count(*) FROM payslips p WHERE p.run_id=r.id) AS payslips,
          (SELECT COALESCE(sum(net),0) FROM payslips p WHERE p.run_id=r.id) AS total_net FROM payroll_runs r ORDER BY month DESC`)).rows)));

// HR and Admin may create/refresh DRAFTS.
r.post('/runs', staff, ah(async (req, res) => {
  const { month: m } = z.object({ month }).strict().parse(req.body);
  const out = await tx((db) => generateDraft(db, req.user, m));
  res.status(201).json(out);
}));

r.get('/runs/:id', staff, ah(async (req, res) => {
  const { rows: [run] } = await q('SELECT * FROM payroll_runs WHERE id=$1', [req.params.id]);
  if (!run) throw new HttpError(404, 'Payroll run not found');
  const { rows } = await q(
    `SELECT p.*, e.full_name, e.emp_code FROM payslips p JOIN employees e ON e.id=p.employee_id WHERE p.run_id=$1 ORDER BY e.full_name`, [run.id]);
  res.json({ run, payslips: rows });
}));

// ONLY Admin can finalize. Locking is enforced here and in generateDraft().
r.post('/runs/:id/finalize', requireRole('admin'), ah(async (req, res) => {
  const out = await tx(async (db) => {
    const { rows: [run] } = await db.query('SELECT * FROM payroll_runs WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!run) throw new HttpError(404, 'Payroll run not found');
    if (run.status === 'finalized') throw new HttpError(409, 'Already finalized');
    const { rows: [{ n }] } = await db.query('SELECT count(*) AS n FROM payslips WHERE run_id=$1', [run.id]);
    if (n === 0) throw new HttpError(400, 'Cannot finalize an empty payroll run');
    const { rows: [after] } = await db.query(
      `UPDATE payroll_runs SET status='finalized', finalized_by=$1, finalized_at=now() WHERE id=$2 RETURNING *`, [req.user.id, run.id]);
    await audit(db, req.user, 'finalize', 'payroll_run', run.id, run, after);
    await db.query(
      `INSERT INTO notifications (user_id, title, body)
       SELECT e.user_id, 'Payslip available', 'Your payslip for ${run.month} is ready to download.'
         FROM payslips p JOIN employees e ON e.id=p.employee_id WHERE p.run_id=$1`, [run.id]);
    return after;
  });
  res.json(out);
}));

// Employees only see FINALIZED payslips of their own.
r.get('/payslips/mine', requireRole('employee'), ah(async (req, res) => res.json((await q(
  `SELECT p.*, r.month FROM payslips p JOIN payroll_runs r ON r.id=p.run_id
    WHERE p.employee_id=$1 AND r.status='finalized' ORDER BY r.month DESC`, [req.user.employee_id])).rows)));

r.get('/payslips/:id/pdf', ah(async (req, res) => {
  const { rows: [p] } = await q(
    `SELECT p.*, r.month, r.status, e.full_name, e.emp_code, d.name AS department, g.name AS designation
       FROM payslips p JOIN payroll_runs r ON r.id=p.run_id JOIN employees e ON e.id=p.employee_id
       LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN designations g ON g.id=e.designation_id WHERE p.id=$1`, [req.params.id]);
  // Same 404 for "missing" and "not yours" so ids cannot be probed.
  if (!p || (req.user.role === 'employee' && (p.employee_id !== req.user.employee_id || p.status !== 'finalized')))
    throw new HttpError(404, 'Payslip not found');
  const s = await getSettings();
  const money = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  res.type('application/pdf').set('Content-Disposition', `attachment; filename="payslip-${p.emp_code}-${p.month}.pdf"`);
  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);
  doc.fontSize(20).text(s.name, { align: 'center' }).fontSize(13).text(`Payslip - ${p.month}`, { align: 'center' });
  if (p.status !== 'finalized') doc.fillColor('red').fontSize(10).text('DRAFT - not final', { align: 'center' }).fillColor('black');
  doc.moveDown().fontSize(11)
    .text(`Employee: ${p.full_name} (${p.emp_code})`).text(`Department: ${p.department || '-'}   Designation: ${p.designation || '-'}`).moveDown();
  const row = (k, v) => { const y = doc.y; doc.text(k, 50, y).text(v, 350, y, { width: 190, align: 'right' }); doc.moveDown(0.3); };
  doc.fontSize(12).text('Earnings', 50).fontSize(11);
  row('Basic', money(p.basic)); row('House rent allowance (40%)', money(p.hra)); row('Medical allowance (10%)', money(p.medical));
  row(`Gross payable (${p.active_days}/${p.working_days} working days)`, money(p.gross));
  doc.moveDown().fontSize(12).text('Deductions', 50).fontSize(11);
  row(`Absent ${p.absent_days}d / unpaid leave ${p.unpaid_days}d / half-days ${p.half_days}`, money(p.deductions));
  row('Income tax', money(p.tax));
  doc.moveDown().fontSize(13).text(`Net salary: ${money(p.net)}`, 50);
  doc.end();
}));

export default r;
