// Pure payroll maths. No database access here, so it is easy to test.
export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** HRA = 40% basic, medical = 10% basic, gross = 1.5 x basic. */
export const salaryParts = (basic) => ({
  basic, hra: basic * 0.4, medical: basic * 0.1, gross: basic * 1.5,
});

/** Progressive annual tax. slabs = [{upTo:number|null, rate:fraction}] in ascending order. */
export function computeAnnualTax(annualGross, slabs) {
  let tax = 0, prev = 0;
  for (const s of slabs) {
    const upper = s.upTo == null ? Infinity : s.upTo;
    if (annualGross > prev) tax += (Math.min(annualGross, upper) - prev) * s.rate;
    if (annualGross <= upper) break;
    prev = upper;
  }
  return tax;
}

/**
 * workingDays: working days in the whole month.
 * activeDays:  working days the employee was employed (proration for joiners/leavers).
 * Deductions: absent + unpaid days at the daily rate, half-days at half the daily rate.
 */
export function computePayslip({ basic, workingDays, activeDays, absentDays, unpaidDays, halfDays, slabs }) {
  const p = salaryParts(basic);
  const daily = workingDays > 0 ? p.gross / workingDays : 0;
  const payableGross = daily * activeDays;
  const deductions = daily * (absentDays + unpaidDays) + daily * 0.5 * halfDays;
  const fraction = workingDays > 0 ? activeDays / workingDays : 0;
  const tax = (computeAnnualTax(p.gross * 12, slabs) / 12) * fraction;
  const net = Math.max(0, payableGross - deductions - tax);
  return {
    basic: round2(p.basic), hra: round2(p.hra), medical: round2(p.medical), gross: round2(payableGross),
    working_days: workingDays, active_days: activeDays,
    absent_days: absentDays, unpaid_days: unpaidDays, half_days: halfDays,
    deductions: round2(deductions), tax: round2(tax), net: round2(net),
  };
}
