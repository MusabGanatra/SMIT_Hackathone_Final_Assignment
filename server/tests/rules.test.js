import test from 'node:test';
import assert from 'node:assert/strict';
import { isLateArrival, finalStatus, dayStatus } from '../src/services/rules.js';
import { computePayslip, computeAnnualTax, salaryParts } from '../src/services/payrollCalc.js';
import { leaveDays, findOverlap, hasBalance } from '../src/services/leaveCalc.js';
import { requireRole } from '../src/middleware/roles.js';

const S = { office_start: '09:00', grace_minutes: 15, halfday_hours: 5 };
const WE = [0, 6];

test('late begins after 09:15', () => {
  assert.equal(isLateArrival(9 * 60 + 15, S), false);
  assert.equal(isLateArrival(9 * 60 + 16, S), true);
});

test('half-day when under five hours', () => {
  const ci = '2026-01-05T04:00:00Z';
  assert.equal(finalStatus({ checkIn: ci, checkOut: '2026-01-05T08:30:00Z', isLate: false }, S), 'half_day');
  assert.equal(finalStatus({ checkIn: ci, checkOut: '2026-01-05T09:00:00Z', isLate: false }, S), 'present');
  assert.equal(finalStatus({ checkIn: ci, checkOut: '2026-01-05T13:00:00Z', isLate: true }, S), 'late');
});

test('missing record without approved leave is absent; leave wins over absent', () => {
  const base = { today: '2026-01-14', holiday: false, weekends: WE };
  assert.equal(dayStatus({ ...base, date: '2026-01-12', rec: null, leave: null }), 'absent');
  assert.equal(dayStatus({ ...base, date: '2026-01-12', rec: null, leave: { paid: true } }), 'on_leave');
  assert.equal(dayStatus({ ...base, date: '2026-01-12', rec: null, leave: { paid: false } }), 'unpaid_leave');
  assert.equal(dayStatus({ ...base, date: '2026-01-10', rec: null, leave: null }), 'weekend'); // Saturday
  assert.equal(dayStatus({ ...base, date: '2026-01-12', rec: { status: 'present', check_out: null } }), 'missing_checkout');
  assert.equal(dayStatus({ ...base, date: '2026-01-14', rec: { status: 'present', check_out: null } }), 'present');
});

test('salary rules: HRA 40%, medical 10%, gross 1.5x basic', () => {
  const p = salaryParts(100000);
  assert.deepEqual([p.hra, p.medical, p.gross], [40000, 10000, 150000]);
  assert.equal(p.basic + p.hra + p.medical, p.gross);
});

test('progressive tax slabs', () => {
  const slabs = [{ upTo: 600000, rate: 0 }, { upTo: 1200000, rate: 0.05 }, { upTo: null, rate: 0.15 }];
  assert.equal(computeAnnualTax(500000, slabs), 0);
  assert.equal(computeAnnualTax(1000000, slabs), 20000);
  assert.equal(computeAnnualTax(1500000, slabs), 30000 + 45000);
});

test('payslip: deductions for absent, unpaid, half-day', () => {
  const slabs = [{ upTo: null, rate: 0 }];
  const r = computePayslip({ basic: 100000, workingDays: 20, activeDays: 20, absentDays: 1, unpaidDays: 1, halfDays: 2, slabs });
  // gross 150000 -> daily 7500; deduct 2*7500 + 2*3750 = 22500
  assert.equal(r.deductions, 22500);
  assert.equal(r.net, 127500);
});

test('payslip: proration for mid-month joiner', () => {
  const slabs = [{ upTo: null, rate: 0 }];
  const r = computePayslip({ basic: 100000, workingDays: 20, activeDays: 10, absentDays: 0, unpaidDays: 0, halfDays: 0, slabs });
  assert.equal(r.gross, 75000);
  assert.equal(r.net, 75000);
});

test('leave days skip weekends and holidays', () => {
  // Mon 2026-01-05 .. Mon 2026-01-12 = 8 calendar days, 6 weekdays; holiday on Wed 7th => 5
  assert.equal(leaveDays('2026-01-05', '2026-01-12', WE, new Set(['2026-01-07'])), 5);
  assert.equal(leaveDays('2026-01-10', '2026-01-11', WE, new Set()), 0);
});

test('overlap and balance checks', () => {
  const ex = [{ status: 'approved', start_date: '2026-01-05', end_date: '2026-01-07' }, { status: 'rejected', start_date: '2026-02-01', end_date: '2026-02-03' }];
  assert.ok(findOverlap(ex, '2026-01-07', '2026-01-09'));
  assert.equal(findOverlap(ex, '2026-02-01', '2026-02-02'), undefined);
  assert.equal(hasBalance(14, 12, 3), false);
  assert.equal(hasBalance(14, 12, 2), true);
  assert.equal(hasBalance(null, 999, 5), true);
});

import { assertEmployeeScope } from '../src/middleware/roles.js';

test('employee cannot access another employee scope', () => {
  assert.throws(() => assertEmployeeScope({ role: 'employee', employee_id: 1 }, 2), /own records/);
  assert.doesNotThrow(() => assertEmployeeScope({ role: 'employee', employee_id: 1 }, '1'));
  assert.doesNotThrow(() => assertEmployeeScope({ role: 'hr', employee_id: null }, 2));
});

test('requireRole blocks other roles', () => {
  let err;
  requireRole('admin')({ user: { role: 'hr' } }, {}, (e) => { err = e; });
  assert.equal(err.status, 403);
  err = undefined;
  requireRole('admin', 'hr')({ user: { role: 'hr' } }, {}, (e) => { err = e; });
  assert.equal(err, undefined);
});
