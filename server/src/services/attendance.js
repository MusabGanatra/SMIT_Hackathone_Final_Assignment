import { q } from '../db.js';
import { HttpError } from '../utils/http.js';
import { eachDay, localParts } from '../utils/dates.js';
import { getSettings, getHolidaySet } from './settings.js';
import { dayStatus, isLateArrival, finalStatus } from './rules.js';

export const todayLocal = (s) => localParts(new Date(), s.timezone).date;

/** Day-by-day statuses for one employee in [from, to]. */
export async function employeeDays(db, empId, from, to, s) {
  const today = todayLocal(s);
  const [att, leaves, hol] = await Promise.all([
    db.query('SELECT * FROM attendance WHERE employee_id=$1 AND work_date BETWEEN $2 AND $3', [empId, from, to]),
    db.query(`SELECT l.start_date, l.end_date, t.paid FROM leave_requests l JOIN leave_types t ON t.id=l.leave_type_id
              WHERE l.employee_id=$1 AND l.status='approved' AND l.start_date<=$3 AND l.end_date>=$2`, [empId, from, to]),
    getHolidaySet(db, from, to),
  ]);
  const recs = new Map(att.rows.map((r) => [r.work_date, r]));
  return eachDay(from, to).map((date) => {
    const lv = leaves.rows.find((l) => l.start_date <= date && date <= l.end_date);
    const rec = recs.get(date) || null;
    return {
      date, status: dayStatus({ date, today, rec, leave: lv ? { paid: lv.paid } : null, holiday: hol.has(date), weekends: s.weekends }),
      check_in: rec?.check_in || null, check_out: rec?.check_out || null,
    };
  });
}

export async function checkIn(empId) {
  const s = await getSettings();
  const now = new Date();
  const { date, minutes } = localParts(now, s.timezone);
  const { rows: [leave] } = await q(
    `SELECT 1 FROM leave_requests WHERE employee_id=$1 AND status='approved' AND $2 BETWEEN start_date AND end_date`, [empId, date]);
  if (leave) throw new HttpError(409, 'You are on approved leave today');
  const late = isLateArrival(minutes, s);
  const { rows: [row] } = await q(
    `INSERT INTO attendance (employee_id, work_date, check_in, status, is_late)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (employee_id, work_date) DO NOTHING RETURNING *`,
    [empId, date, now, late ? 'late' : 'present', late]); // server-generated timestamp
  if (!row) throw new HttpError(409, 'You have already checked in today');
  return row;
}

export async function checkOut(empId) {
  const s = await getSettings();
  const now = new Date();
  const { date } = localParts(now, s.timezone);
  const { rows: [rec] } = await q('SELECT * FROM attendance WHERE employee_id=$1 AND work_date=$2', [empId, date]);
  if (!rec) throw new HttpError(409, 'You have not checked in today');
  if (rec.check_out) throw new HttpError(409, 'You have already checked out today');
  const status = finalStatus({ checkIn: rec.check_in, checkOut: now, isLate: rec.is_late }, s);
  const { rows: [row] } = await q('UPDATE attendance SET check_out=$1, status=$2 WHERE id=$3 RETURNING *', [now, status, rec.id]);
  return row;
}

/** Upsert a record from local HH:MM times (used by approved corrections and HR edits). */
export async function upsertFromTimes(db, empId, workDate, inHM, outHM, s) {
  const ts = (hm) => db.query('SELECT (($1::date + $2::time) AT TIME ZONE $3) AS t', [workDate, hm, s.timezone]).then((r) => r.rows[0].t);
  const checkIn = await ts(inHM);
  const checkOut = outHM ? await ts(outHM) : null;
  if (checkOut && checkOut <= checkIn) throw new HttpError(400, 'Check-out must be after check-in');
  const { minutes } = localParts(checkIn, s.timezone);
  const late = isLateArrival(minutes, s);
  const status = finalStatus({ checkIn, checkOut, isLate: late }, s);
  const { rows: [before] } = await db.query('SELECT * FROM attendance WHERE employee_id=$1 AND work_date=$2', [empId, workDate]);
  const { rows: [after] } = await db.query(
    `INSERT INTO attendance (employee_id, work_date, check_in, check_out, status, is_late)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (employee_id, work_date) DO UPDATE SET check_in=$3, check_out=$4, status=$5, is_late=$6 RETURNING *`,
    [empId, workDate, checkIn, checkOut, status, late]);
  return { before, after };
}
