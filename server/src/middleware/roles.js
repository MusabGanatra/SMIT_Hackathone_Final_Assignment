import { HttpError } from '../utils/http.js';

export const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user.role) ? next() : next(new HttpError(403, 'You do not have permission to do this'));

export const requirePasswordChanged = (req, _res, next) =>
  req.user.must_change_password ? next(new HttpError(403, 'You must change your temporary password first')) : next();

/** Employees may only touch their own record; admin/hr may touch any. */
export function assertEmployeeScope(user, employeeId) {
  if (user.role === 'employee' && user.employee_id !== Number(employeeId))
    throw new HttpError(403, 'You can only access your own records');
}
