import jwt from 'jsonwebtoken';
import { q } from '../db.js';
import { config } from '../config.js';
import { HttpError, ah } from '../utils/http.js';

export const signToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

/** Verifies the JWT, then reloads the user so deactivation/role changes take effect immediately. */
export const authenticate = ah(async (req, _res, next) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) throw new HttpError(401, 'Authentication required');
  let payload;
  try { payload = jwt.verify(token, config.jwtSecret); }
  catch { throw new HttpError(401, 'Invalid or expired token'); }
  const { rows: [u] } = await q(
    `SELECT u.id, u.email, u.role, u.active, u.must_change_password, u.display_name,
            e.id AS employee_id, e.full_name
       FROM users u LEFT JOIN employees e ON e.user_id = u.id WHERE u.id = $1`, [payload.sub]);
  if (!u || !u.active) throw new HttpError(401, 'Account is disabled or no longer exists');
  req.user = u;
  next();
});

export { requireRole, requirePasswordChanged, assertEmployeeScope } from './roles.js';
