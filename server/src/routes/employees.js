import { Router } from 'express';
import { z } from 'zod';
import { q, tx } from '../db.js';
import { ah, HttpError } from '../utils/http.js';
import { requireRole, assertEmployeeScope } from '../middleware/roles.js';
import { audit } from '../utils/audit.js';
import { isValidDate, monthRange } from '../utils/dates.js';
import { createEmployee, parseCsv, csvEscape } from '../services/employees.js';
import { searchEmployees, leaveBalance } from '../services/analytics.js';
import { getSettings } from '../services/settings.js';
import { employeeDays, todayLocal } from '../services/attendance.js';

const r = Router();
const staff = requireRole('admin', 'hr');
const date = z.string().refine(isValidDate, 'Invalid date (use YYYY-MM-DD)');
const id = z.number().int().positive().nullable().optional();

const createSchema = z.object({
  full_name: z.string().trim().min(2).max(120), email: z.string().email(),
  phone: z.string().max(30).optional().nullable(), address: z.string().max(300).optional().nullable(),
  department_id: id, designation_id: id, join_date: date, basic: z.number().min(0).max(1e9).optional().nullable(),
}).strict();
const updateSchema = z.object({
  full_name: z.string().trim().min(2).max(120), phone: z.string().max(30).nullable().optional(), address: z.string().max(300).nullable().optional(),
  department_id: id, designation_id: id, join_date: date, leave_date: date.nullable().optional(), status: z.enum(['active', 'inactive']),
}).strict(); // .strict() blocks mass assignment (e.g. user_id, emp_code)

r.get('/', staff, ah(async (req, res) => {
  const p = z.object({ q: z.string().max(80).default(''), department_id: z.coerce.number().int().optional(),
    status: z.enum(['active', 'inactive']).optional(), page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(10) }).parse(req.query);
  const out = await searchEmployees({ query: p.q, deptId: p.department_id ?? null, status: p.status ?? null, limit: p.pageSize, offset: (p.page - 1) * p.pageSize });
  res.json({ ...out, page: p.page, pageSize: p.pageSize });
}));

r.post('/', staff, ah(async (req, res) => {
  const d = createSchema.parse(req.body);
  const out = await tx((db) => createEmployee(db, req.user, d));
  res.status(201).json(out); // temp_password is shown once to HR
}));

/* Employee self-service: phone + address only */
r.put('/me', requireRole('employee'), ah(async (req, res) => {
  const d = z.object({ phone: z.string().max(30).nullable(), address: z.string().max(300).nullable() }).strict().parse(req.body);
  const { rows: [before] } = await q('SELECT phone,address FROM employees WHERE id=$1', [req.user.employee_id]);
  const { rows: [after] } = await q('UPDATE employees SET phone=$1, address=$2, updated_at=now() WHERE id=$3 RETURNING phone,address', [d.phone, d.address, req.user.employee_id]);
  await audit(null, req.user, 'update_contact', 'employee', req.user.employee_id, before, after);
  res.json(after);
}));

r.get('/me', requireRole('employee'), ah(async (req, res) => {
  const { rows: [e] } = await q(
    `SELECT e.id, e.emp_code, e.full_name, u.email, e.phone, e.address, e.join_date, d.name AS department, g.name AS designation
       FROM employees e JOIN users u ON u.id=e.user_id LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN designations g ON g.id=e.designation_id
      WHERE e.id=$1`, [req.user.employee_id]);
  res.json(e);
}));

const COLS = ['full_name', 'email', 'phone', 'address', 'department', 'designation', 'join_date', 'basic_salary'];
r.get('/export', staff, ah(async (req, res) => {
  const { rows } = await q(
    `SELECT e.full_name, u.email, e.phone, e.address, d.name AS department, g.name AS designation, e.join_date,
            ${req.user.role === 'admin' || req.user.role === 'hr' ? 'sa.basic' : 'NULL'} AS basic_salary
       FROM employees e JOIN users u ON u.id=e.user_id LEFT JOIN departments d ON d.id=e.department_id
       LEFT JOIN designations g ON g.id=e.designation_id LEFT JOIN salary_structures sa ON sa.employee_id=e.id ORDER BY e.id`);
  const csv = [COLS.join(','), ...rows.map((x) => COLS.map((c) => csvEscape(x[c === 'basic_salary' ? 'basic_salary' : c])).join(','))].join('\n');
  res.type('text/csv').set('Content-Disposition', 'attachment; filename="employees.csv"').send(csv);
}));

/** CSV import. dryRun=true validates only and reports invalid rows; otherwise valid rows are imported atomically. */
r.post('/import', staff, ah(async (req, res) => {
  const { csv, dryRun } = z.object({ csv: z.string().min(1).max(2_000_000), dryRun: z.boolean().default(true) }).parse(req.body);
  const rows = parseCsv(csv);
  if (!rows.length) throw new HttpError(400, 'The CSV has no data rows');
  if (rows.length > 500) throw new HttpError(400, 'Maximum 500 rows per import');
  const [{ rows: depts }, { rows: desigs }, { rows: users }] = await Promise.all([
    q('SELECT id,name FROM departments'), q('SELECT id,name FROM designations'), q('SELECT email FROM users')]);
  const dMap = new Map(depts.map((x) => [x.name.toLowerCase(), x.id])), gMap = new Map(desigs.map((x) => [x.name.toLowerCase(), x.id]));
  const seen = new Set(users.map((u) => u.email.toLowerCase()));
  const valid = [], invalid = [];
  rows.forEach((row, i) => {
    const errors = [];
    if (!row.full_name || row.full_name.length < 2) errors.push('full_name is required');
    if (!z.string().email().safeParse(row.email).success) errors.push('email is invalid');
    else if (seen.has(row.email.toLowerCase())) errors.push('email already exists or is duplicated in the file');
    if (!isValidDate(row.join_date || '')) errors.push('join_date must be YYYY-MM-DD');
    if (row.department && !dMap.has(row.department.toLowerCase())) errors.push(`unknown department "${row.department}"`);
    if (row.designation && !gMap.has(row.designation.toLowerCase())) errors.push(`unknown designation "${row.designation}"`);
    if (row.basic_salary && !(Number(row.basic_salary) >= 0)) errors.push('basic_salary must be a number');
    if (errors.length) invalid.push({ row: i + 2, errors });
    else {
      seen.add(row.email.toLowerCase());
      valid.push({ full_name: row.full_name, email: row.email, phone: row.phone || null, address: row.address || null,
        department_id: row.department ? dMap.get(row.department.toLowerCase()) : null,
        designation_id: row.designation ? gMap.get(row.designation.toLowerCase()) : null,
        join_date: row.join_date, basic: row.basic_salary ? Number(row.basic_salary) : null });
    }
  });
  if (dryRun) return res.json({ dryRun: true, total: rows.length, valid: valid.length, invalid });
  const created = await tx(async (db) => { const out = []; for (const v of valid) { const c = await createEmployee(db, req.user, v); out.push({ email: c.email, temp_password: c.temp_password }); } return out; });
  res.status(201).json({ dryRun: false, imported: created.length, skipped: invalid, logins: created });
}));

async function loadEmployee(user, empId) {
  assertEmployeeScope(user, empId);
  const { rows: [e] } = await q(
    `SELECT e.*, u.email, u.active AS login_active, d.name AS department, g.name AS designation
       FROM employees e JOIN users u ON u.id=e.user_id LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN designations g ON g.id=e.designation_id
      WHERE e.id=$1`, [empId]);
  if (!e) throw new HttpError(404, 'Employee not found');
  return e;
}

/** Employee 360: profile, salary (staff only), this month's attendance, leave balance, recent leave. */
r.get('/:id/360', ah(async (req, res) => {
  const e = await loadEmployee(req.user, req.params.id);
  const s = await getSettings();
  const today = todayLocal(s);
  const { from, to } = monthRange(today.slice(0, 7));
  const days = await employeeDays({ query: q }, e.id, from, to, s);
  const count = (st) => days.filter((d) => d.status === st).length;
  const out = {
    profile: e,
    attendance_this_month: { present: count('present'), late: count('late'), half_day: count('half_day'), absent: count('absent'), on_leave: count('on_leave') },
    leave_balance: await leaveBalance(e.id, Number(today.slice(0, 4))),
    recent_leaves: (await q(`SELECT l.*, t.name AS leave_type FROM leave_requests l JOIN leave_types t ON t.id=l.leave_type_id WHERE l.employee_id=$1 ORDER BY l.created_at DESC LIMIT 5`, [e.id])).rows,
  };
  if (req.user.role !== 'employee') out.salary = (await q('SELECT basic FROM salary_structures WHERE employee_id=$1', [e.id])).rows[0] || null;
  res.json(out);
}));

r.put('/:id', staff, ah(async (req, res) => {
  const d = updateSchema.parse(req.body);
  const before = await loadEmployee(req.user, req.params.id);
  const { rows: [after] } = await q(
    `UPDATE employees SET full_name=$1, phone=$2, address=$3, department_id=$4, designation_id=$5, join_date=$6, leave_date=$7, status=$8, updated_at=now()
      WHERE id=$9 RETURNING *`,
    [d.full_name, d.phone ?? null, d.address ?? null, d.department_id ?? null, d.designation_id ?? null, d.join_date, d.leave_date ?? null, d.status, before.id]);
  await audit(null, req.user, 'update', 'employee', before.id, before, after);
  res.json(after);
}));

/* Salary structure (admin + hr). Finalized payslips are snapshots, so editing does not alter locked payroll. */
r.put('/:id/salary', staff, ah(async (req, res) => {
  const { basic } = z.object({ basic: z.number().min(0).max(1e9) }).strict().parse(req.body);
  const e = await loadEmployee(req.user, req.params.id);
  const { rows: [before] } = await q('SELECT basic FROM salary_structures WHERE employee_id=$1', [e.id]);
  const { rows: [after] } = await q(
    `INSERT INTO salary_structures (employee_id, basic) VALUES ($1,$2)
     ON CONFLICT (employee_id) DO UPDATE SET basic=$2, updated_at=now() RETURNING basic`, [e.id, basic]);
  await audit(null, req.user, 'update_salary', 'salary_structure', e.id, before, after);
  res.json({ ...after, hra: basic * 0.4, medical: basic * 0.1, gross: basic * 1.5 });
}));

export default r;
