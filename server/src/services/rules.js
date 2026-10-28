// Pure business rules (unit-tested). Settings object comes from company_settings.
import { dow } from '../utils/dates.js';

export const toMin = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };

/** Late begins AFTER office_start + grace (09:15 by default). */
export const isLateArrival = (arrivalMinutes, s) => arrivalMinutes > toMin(s.office_start) + s.grace_minutes;

export const hoursBetween = (a, b) => (new Date(b) - new Date(a)) / 36e5;

/** Status stored on the attendance row. Under halfday_hours worked => half_day. */
export function finalStatus({ checkIn, checkOut, isLate }, s) {
  if (checkOut && hoursBetween(checkIn, checkOut) < s.halfday_hours) return 'half_day';
  return isLate ? 'late' : 'present';
}

/**
 * Status of one calendar day for one employee.
 * leave = null | { paid: boolean } for an APPROVED leave covering the day.
 */
export function dayStatus({ date, today, rec, leave, holiday, weekends }) {
  if (weekends.includes(dow(date))) return 'weekend';
  if (holiday) return 'holiday';
  if (date > today) return 'future';
  if (rec) return !rec.check_out && date < today ? 'missing_checkout' : rec.status;
  if (leave) return leave.paid ? 'on_leave' : 'unpaid_leave';
  return 'absent'; // no record and no approved leave
}
