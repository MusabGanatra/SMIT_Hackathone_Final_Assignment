import { HttpError } from '../utils/http.js';
import { monthRange, countWorkingDays } from '../utils/dates.js';
import { getSettings, getHolidaySet } from './settings.js';
import { employeeDays } from './attendance.js';
import { computePayslip } from './payrollCalc.js';
import { audit } from '../utils/audit.js';

/** Creates/refreshes the DRAFT payroll for a month. Finalized runs are locked. Runs in a transaction. */
export async function generateDraft(db, actor, month) {
  const s = await getSettings(db);
  const { from, to } = monthRange(month);
  const { rows: [existing] } = await db.query('SELECT * FROM payroll_runs WHERE month=$1 FOR UPDATE', [month]);
  if (existing?.status === 'finalized') throw new HttpError(409, 'This payroll run is finalized and locked');
  const run = existing || (await db.query('INSERT INTO payroll_runs (month, created_by) VALUES ($1,$2) RETURNING *', [month, actor.id])).rows[0];
  await db.query('DELETE FROM payslips WHERE run_id=$1', [run.id]);

  const holidays = await getHolidaySet(db, from, to);
  const workingDays = countWorkingDays(from, to, s.weekends, holidays);
  const { rows: emps } = await db.query(
    `SELECT e.id, e.join_date, e.leave_date, sa.basic FROM employees e JOIN salary_structures sa ON sa.employee_id=e.id
      WHERE e.join_date <= $2 AND (e.leave_date IS NULL OR e.leave_date >= $1)`, [from, to]);

  let count = 0;
  for (const e of emps) {
    const start = e.join_date > from ? e.join_date : from;
    const end = e.leave_date && e.leave_date < to ? e.leave_date : to;
    const activeDays = countWorkingDays(start, end, s.weekends, holidays);
    const days = await employeeDays(db, e.id, start, end, s);
    const n = (st) => days.filter((d) => d.status === st).length;
    const p = computePayslip({
      basic: e.basic, workingDays, activeDays,
      absentDays: n('absent'), unpaidDays: n('unpaid_leave'), halfDays: n('half_day'), slabs: s.tax_slabs,
    });
    await db.query(
      `INSERT INTO payslips (run_id, employee_id, basic, hra, medical, gross, working_days, active_days,
         absent_days, unpaid_days, half_days, deductions, tax, net)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [run.id, e.id, p.basic, p.hra, p.medical, p.gross, p.working_days, p.active_days,
       p.absent_days, p.unpaid_days, p.half_days, p.deductions, p.tax, p.net]);
    count++;
  }
  await audit(db, actor, existing ? 'regenerate_draft' : 'create_draft', 'payroll_run', run.id, null, { month, payslips: count });
  return { run, payslips: count };
}
