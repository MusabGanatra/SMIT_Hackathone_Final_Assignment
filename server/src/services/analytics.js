import { q } from '../db.js';
import { getSettings } from './settings.js';
import { todayLocal } from './attendance.js';
import { monthRange } from '../utils/dates.js';

export const defaultRange = (s, from, to) => {
  const today = todayLocal(s);
  return { from: from || today.slice(0, 8) + '01', to: to || today };
};

export async function headcount(deptId = null) {
  const { rows } = await q(
    `SELECT d.name AS department, count(*) AS count
       FROM employees e LEFT JOIN departments d ON d.id=e.department_id
      WHERE e.status='active' AND ($1::int IS NULL OR e.department_id=$1)
      GROUP BY d.name ORDER BY count DESC`, [deptId]);
  return { total: rows.reduce((a, r) => a + r.count, 0), by_department: rows.map((r) => ({ department: r.department || 'Unassigned', count: r.count })) };
}

export async function attrition(from, to) {
  const { rows: [r] } = await q(
    `SELECT count(*) FILTER (WHERE leave_date BETWEEN $1 AND $2) AS left_count,
            count(*) FILTER (WHERE join_date <= $2 AND (leave_date IS NULL OR leave_date >= $1)) AS avg_base
       FROM employees`, [from, to]);
  return { left: r.left_count, rate_percent: r.avg_base ? Math.round((r.left_count / r.avg_base) * 1000) / 10 : 0 };
}

/**
 * Per-day attendance aggregation from real rows. Expected = active employees on a working day (<= today).
 * employeeId limits to one employee (used for employee-scoped queries).
 */
export async function attendanceByDay({ from, to, deptId = null, employeeId = null }) {
  const s = await getSettings();
  const { rows } = await q(
    `SELECT d::date::text AS date,
            count(*) FILTER (WHERE a.id IS NOT NULL) AS present_total,
            count(*) FILTER (WHERE a.status='present') AS on_time,
            count(*) FILTER (WHERE a.is_late) AS late,
            count(*) FILTER (WHERE a.status='half_day') AS half_day,
            count(*) FILTER (WHERE a.id IS NULL AND l.id IS NOT NULL) AS on_leave,
            count(*) FILTER (WHERE a.id IS NULL AND l.id IS NULL) AS absent
       FROM generate_series($1::date, LEAST($2::date, $5::date), '1 day') d
       JOIN employees e ON e.join_date <= d AND (e.leave_date IS NULL OR e.leave_date >= d)
            AND ($3::int IS NULL OR e.department_id=$3) AND ($4::int IS NULL OR e.id=$4)
       LEFT JOIN attendance a ON a.employee_id=e.id AND a.work_date=d
       LEFT JOIN leave_requests l ON l.employee_id=e.id AND l.status='approved' AND d BETWEEN l.start_date AND l.end_date
      WHERE NOT (extract(dow FROM d)::int = ANY($6::int[]))
        AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date=d)
      GROUP BY d ORDER BY d`, [from, to, deptId, employeeId, todayLocal(s), s.weekends]);
  return rows;
}

export async function attendanceSummary(args) {
  const days = await attendanceByDay(args);
  const sum = (k) => days.reduce((a, r) => a + r[k], 0);
  const expected = sum('present_total') + sum('on_leave') + sum('absent');
  return {
    from: args.from, to: args.to, working_days: days.length,
    present: sum('present_total'), on_time: sum('on_time'), late: sum('late'), half_day: sum('half_day'),
    on_leave: sum('on_leave'), absent: sum('absent'),
    absenteeism_percent: expected ? Math.round((sum('absent') / expected) * 1000) / 10 : 0,
    daily: days,
  };
}

export async function lateComers({ from, to, deptId = null, limit = 10 }) {
  const { rows } = await q(
    `SELECT e.id AS employee_id, e.emp_code, e.full_name, d.name AS department, count(*) AS late_count
       FROM attendance a JOIN employees e ON e.id=a.employee_id LEFT JOIN departments d ON d.id=e.department_id
      WHERE a.is_late AND a.work_date BETWEEN $1 AND $2 AND ($3::int IS NULL OR e.department_id=$3)
      GROUP BY e.id, d.name ORDER BY late_count DESC, e.full_name LIMIT $4`, [from, to, deptId, limit]);
  return rows;
}

export async function leaveSummary({ from, to, deptId = null, employeeId = null }) {
  const { rows } = await q(
    `SELECT t.name AS leave_type, l.status, count(*) AS requests, COALESCE(sum(l.days),0) AS days
       FROM leave_requests l JOIN leave_types t ON t.id=l.leave_type_id JOIN employees e ON e.id=l.employee_id
      WHERE l.start_date <= $2 AND l.end_date >= $1
        AND ($3::int IS NULL OR e.department_id=$3) AND ($4::int IS NULL OR e.id=$4)
      GROUP BY t.name, l.status ORDER BY t.name`, [from, to, deptId, employeeId]);
  return rows;
}

export async function leaveBalance(empId, year) {
  const { rows } = await q(
    `SELECT t.id AS leave_type_id, t.code, t.name, t.annual_quota AS quota, t.paid,
            COALESCE(sum(l.days) FILTER (WHERE l.status='approved'),0) AS used,
            COALESCE(sum(l.days) FILTER (WHERE l.status='pending'),0) AS pending
       FROM leave_types t
       LEFT JOIN leave_requests l ON l.leave_type_id=t.id AND l.employee_id=$1
            AND extract(year FROM l.start_date)=$2 AND l.status IN ('approved','pending')
      GROUP BY t.id ORDER BY t.id`, [empId, year]);
  return rows.map((r) => ({ ...r, remaining: r.quota == null ? null : r.quota - r.used - r.pending }));
}

export async function payrollSummary(month) {
  const { rows: [run] } = month
    ? await q('SELECT * FROM payroll_runs WHERE month=$1', [month])
    : await q('SELECT * FROM payroll_runs ORDER BY month DESC LIMIT 1');
  if (!run) return { message: 'No payroll run exists yet' };
  const { rows: [t] } = await q(
    `SELECT count(*) AS employees, COALESCE(sum(net),0) AS total_net, COALESCE(sum(gross),0) AS total_gross,
            COALESCE(avg(gross),0) AS avg_gross, COALESCE(sum(tax),0) AS total_tax
       FROM payslips WHERE run_id=$1`, [run.id]);
  const { rows: byDept } = await q(
    `SELECT COALESCE(d.name,'Unassigned') AS department, sum(p.net) AS total_net, avg(p.gross) AS avg_gross
       FROM payslips p JOIN employees e ON e.id=p.employee_id LEFT JOIN departments d ON d.id=e.department_id
      WHERE p.run_id=$1 GROUP BY d.name ORDER BY total_net DESC`, [run.id]);
  return { month: run.month, status: run.status, ...t, by_department: byDept };
}

export async function searchEmployees({ query = '', deptId = null, status = null, limit = 10, offset = 0 }) {
  const like = `%${query}%`;
  const { rows } = await q(
    `SELECT e.id, e.emp_code, e.full_name, u.email, e.phone, d.name AS department, g.name AS designation,
            e.join_date, e.status, count(*) OVER() AS total
       FROM employees e JOIN users u ON u.id=e.user_id
       LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN designations g ON g.id=e.designation_id
      WHERE ($1='%%' OR e.full_name ILIKE $1 OR e.emp_code ILIKE $1 OR u.email ILIKE $1)
        AND ($2::int IS NULL OR e.department_id=$2) AND ($3::text IS NULL OR e.status=$3)
      ORDER BY e.full_name LIMIT $4 OFFSET $5`, [like, deptId, status, limit, offset]);
  return { total: rows[0]?.total || 0, rows: rows.map(({ total, ...r }) => r) };
}

export { monthRange };
