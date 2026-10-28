import { countWorkingDays, rangesOverlap } from '../utils/dates.js';

/** Leave days exclude weekends and public holidays. */
export const leaveDays = (start, end, weekends, holidaySet) => countWorkingDays(start, end, weekends, holidaySet);

/** Returns the first overlapping request (pending/approved) or undefined. */
export const findOverlap = (existing, start, end) =>
  existing.find((r) => ['pending', 'approved'].includes(r.status) && rangesOverlap(r.start_date, r.end_date, start, end));

/** quota === null => unlimited (e.g. unpaid). */
export const hasBalance = (quota, used, requested) => quota == null || used + requested <= quota;
