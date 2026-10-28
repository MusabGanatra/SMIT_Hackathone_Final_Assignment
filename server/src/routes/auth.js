import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { q, tx } from '../db.js';
import { ah, HttpError } from '../utils/http.js';
import { signToken, authenticate } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';

export const setupRouter = Router();
export const authRouter = Router();

setupRouter.get('/status', ah(async (_req, res) => {
  const { rows: [r] } = await q('SELECT count(*) AS n FROM users');
  res.json({ needsSetup: r.n === 0 });
}));

const passwordRule = z.string().min(8, 'Password must be at least 8 characters').max(100);

setupRouter.post('/', ah(async (req, res) => {
  const d = z.object({
    companyName: z.string().min(2).max(120), name: z.string().min(2).max(120),
    email: z.string().email(), password: passwordRule,
  }).parse(req.body);
  await tx(async (db) => {
    await db.query('LOCK TABLE users IN EXCLUSIVE MODE'); // prevents two concurrent first-run setups
    const { rows: [r] } = await db.query('SELECT count(*) AS n FROM users');
    if (r.n > 0) throw new HttpError(409, 'Setup has already been completed');
    const hash = await bcrypt.hash(d.password, 10);
    const { rows: [u] } = await db.query(
      `INSERT INTO users (email, password_hash, role, display_name) VALUES ($1,$2,'admin',$3) RETURNING id, email`,
      [d.email.toLowerCase(), hash, d.name]);
    await db.query('INSERT INTO company_settings (id, name) VALUES (1,$1)', [d.companyName]);
    // Leave policy defaults from the brief (configuration, not dummy data). Admin can edit them.
    await db.query(`INSERT INTO leave_types (code, name, annual_quota, paid) VALUES
      ('annual','Annual',14,TRUE),('sick','Sick',8,TRUE),('casual','Casual',10,TRUE),('unpaid','Unpaid',NULL,FALSE)`);
    await audit(db, u, 'first_run_setup', 'company', 1, null, { name: d.companyName });
  });
  res.status(201).json({ ok: true });
}));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' } });

authRouter.post('/login', loginLimiter, ah(async (req, res) => {
  const d = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  const { rows: [u] } = await q(
    `SELECT u.*, e.id AS employee_id, e.full_name FROM users u LEFT JOIN employees e ON e.user_id=u.id WHERE u.email=$1`,
    [d.email.toLowerCase()]);
  const ok = u && (await bcrypt.compare(d.password, u.password_hash));
  if (!ok) throw new HttpError(401, 'Incorrect email or password');
  if (!u.active) throw new HttpError(403, 'This account has been deactivated');
  res.json({ token: signToken(u), user: publicUser(u) });
}));

export const publicUser = (u) => ({
  id: u.id, email: u.email, role: u.role, name: u.full_name || u.display_name,
  employee_id: u.employee_id || null, must_change_password: u.must_change_password,
});

authRouter.get('/me', authenticate, (req, res) => res.json({ user: publicUser(req.user) }));

authRouter.post('/change-password', authenticate, ah(async (req, res) => {
  const d = z.object({ current_password: z.string().min(1), new_password: passwordRule }).parse(req.body);
  const { rows: [u] } = await q('SELECT * FROM users WHERE id=$1', [req.user.id]);
  if (!(await bcrypt.compare(d.current_password, u.password_hash))) throw new HttpError(400, 'Current password is incorrect');
  if (d.current_password === d.new_password) throw new HttpError(400, 'New password must be different');
  await q('UPDATE users SET password_hash=$1, must_change_password=FALSE WHERE id=$2', [await bcrypt.hash(d.new_password, 10), u.id]);
  await audit(null, req.user, 'change_password', 'user', u.id);
  res.json({ ok: true });
}));
