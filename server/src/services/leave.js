import { HttpError } from '../utils/http.js';
import { isValidDate } from '../utils/dates.js';
import { getSettings, getHolidaySet } from './settings.js';
import { leaveDays, hasBalance } from './leaveCalc.js';

/**
 * Validates a leave request and returns the number of leave days.
 * Rules: valid dates, not before join date, weekends/holidays excluded, no overlap, balance available.
 * excludeId lets approval re-validate a request without counting itself.
 */
export async function validateLeave(db, { empId, leaveTypeId, start, end, excludeId = null }) {
  if (!isValidDate(start) || !isValidDate(end)) throw new HttpError(400, 'Dates must be in YYYY-MM-DD format');
  if (start > end) throw new HttpError(400, 'End date cannot be before start date');
  if (start.slice(0, 4) !== end.slice(0, 4)) throw new HttpError(400, 'A leave request cannot span two calendar years; split it in two');
  const s = await getSettings(db);
  const { rows: [emp] } = await db.query('SELECT join_date FROM employees WHERE id=$1', [empId]);
  if (!emp) throw new HttpError(404, 'Employee not found');
  if (start < emp.join_date) throw new HttpError(400, 'Leave cannot start before the joining date');
  const { rows: [type] } = await db.query('SELECT * FROM leave_types WHERE id=$1', [leaveTypeId]);
  if (!type) throw new HttpError(400, 'Unknown leave type');

  const holidays = await getHolidaySet(db, start, end);
  const days = leaveDays(start, end, s.weekends, holidays);
  if (days <= 0) throw new HttpError(400, 'The selected dates contain no working days (weekends and holidays are excluded)');

  const { rows: [clash] } = await db.query(
    `SELECT id FROM leave_requests WHERE employee_id=$1 AND status IN ('pending','approved')
       AND start_date <= $3 AND end_date >= $2 AND ($4::int IS NULL OR id <> $4) LIMIT 1`, [empId, start, end, excludeId]);
  if (clash) throw new HttpError(409, 'This request overlaps with an existing pending or approved leave');

  const { rows: [u] } = await db.query(
    `SELECT COALESCE(sum(days),0) AS used FROM leave_requests
      WHERE employee_id=$1 AND leave_type_id=$2 AND status IN ('pending','approved')
        AND extract(year FROM start_date)=$3 AND ($4::int IS NULL OR id <> $4)`,
    [empId, leaveTypeId, Number(start.slice(0, 4)), excludeId]);
  if (!hasBalance(type.annual_quota, u.used, days))
    throw new HttpError(409, `Insufficient ${type.name} balance: ${type.annual_quota - u.used} day(s) left, ${days} requested`);
  return { days, type };
}
