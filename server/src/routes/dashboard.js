import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db.js';
import { ah } from '../utils/http.js';
import { requireRole } from '../middleware/roles.js';
import { isValidDate, addDays, dow } from '../utils/dates.js';
import { getSettings } from '../services/settings.js';
import { todayLocal } from '../services/attendance.js';
import * as A from '../services/analytics.js';

const r = Router();
const date = z.string().refine(isValidDate).optional();
const filters = z.object({ from: date, to: date, department_id: z.coerce.number().int().optional() });

async function pending() {
  const [{ rows: [l] }, { rows: [c] }] = await Promise.all([
    q(`SELECT count(*) AS n FROM leave_requests WHERE status='pending'`), q(`SELECT count(*) AS n FROM attendance_corrections WHERE status='pending'`)]);
  return { leave: l.n, corrections: c.n };
}

r.get('/admin', requireRole('admin'), ah(async (req, res) => {
  const f = filters.parse(req.query); const s = await getSettings();
  const range = A.defaultRange(s, f.from, f.to); const deptId = f.department_id ?? null;
  const [hc, attr, att, pay, deptStats, audits] = await Promise.all([
    A.headcount(deptId), A.attrition(range.from, range.to), A.attendanceSummary({ ...range, deptId }), A.payrollSummary(null),
    q(`SELECT COALESCE(d.name,'Unassigned') AS department, count(*) AS headcount, COALESCE(round(avg(sa.basic*1.5)),0) AS avg_gross
         FROM employees e LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN salary_structures sa ON sa.employee_id=e.id
        WHERE e.status='active' AND ($1::int IS NULL OR e.department_id=$1) GROUP BY d.name ORDER BY headcount DESC`, [deptId]),
    q('SELECT id, actor_email, action, entity, created_at FROM audit_logs ORDER BY id DESC LIMIT 8'),
  ]);
  res.json({ range, headcount: hc, attrition: attr, attendance: att, payroll: pay, departments: deptStats.rows, recent_audit: audits.rows });
}));

r.get('/hr', requireRole('admin', 'hr'), ah(async (req, res) => {
  const f = filters.parse(req.query); const s = await getSettings();
  const range = A.defaultRange(s, f.from, f.to); const deptId = f.department_id ?? null;
  const today = todayLocal(s);
  const [todaySum, att, late, p, depts] = await Promise.all([
    A.attendanceSummary({ from: today, to: today, deptId }), A.attendanceSummary({ ...range, deptId }),
    A.lateComers({ ...range, deptId }), pending(),
    q(`SELECT COALESCE(d.name,'Unassigned') AS department, count(*) AS headcount FROM employees e LEFT JOIN departments d ON d.id=e.department_id
        WHERE e.status='active' GROUP BY d.name ORDER BY headcount DESC`),
  ]);
  const { daily, ...rangeSum } = att;
  res.json({ range, today: { date: today, present: todaySum.present, late: todaySum.late, absent: todaySum.absent, on_leave: todaySum.on_leave },
    pending: p, attendance: rangeSum, trend: daily, late_comers: late, departments: depts.rows });
}));

r.get('/employee', requireRole('employee'), ah(async (req, res) => {
  const s = await getSettings(); const today = todayLocal(s); const empId = req.user.employee_id;
  const monthStart = today.slice(0, 8) + '01';
  let weekStart = today; while (dow(weekStart) !== 1) weekStart = addDays(weekStart, -1); // Monday
  const [rec, week, lateCount, balance, payslip, notes] = await Promise.all([
    q('SELECT * FROM attendance WHERE employee_id=$1 AND work_date=$2', [empId, today]),
    q(`SELECT COALESCE(sum(EXTRACT(EPOCH FROM (COALESCE(check_out, now()) - check_in))/3600),0) AS hours
         FROM attendance WHERE employee_id=$1 AND work_date BETWEEN $2 AND $3`, [empId, weekStart, today]),
    q('SELECT count(*) AS n FROM attendance WHERE employee_id=$1 AND is_late AND work_date BETWEEN $2 AND $3', [empId, monthStart, today]),
    A.leaveBalance(empId, Number(today.slice(0, 4))),
    q(`SELECT p.*, r.month FROM payslips p JOIN payroll_runs r ON r.id=p.run_id WHERE p.employee_id=$1 AND r.status='finalized' ORDER BY r.month DESC LIMIT 1`, [empId]),
    q('SELECT id,title,body,created_at FROM announcements ORDER BY created_at DESC LIMIT 5'),
  ]);
  res.json({ today: { date: today, record: rec.rows[0] || null }, week_hours: Math.round(week.rows[0].hours * 10) / 10, week_target: 40,
    late_this_month: lateCount.rows[0].n, leave_balance: balance, latest_payslip: payslip.rows[0] || null, announcements: notes.rows });
}));

export default r;
