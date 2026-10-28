import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';

export const tempPassword = () => crypto.randomBytes(6).toString('base64url') + '#7';

/** Creates the login (role employee, must change password) and the employee profile in the caller's transaction. */
export async function createEmployee(db, actor, d) {
  const email = d.email.toLowerCase();
  const { rows: [dup] } = await db.query('SELECT 1 FROM users WHERE email=$1', [email]);
  if (dup) throw new HttpError(409, `Email already in use: ${email}`);
  const pw = tempPassword();
  const hash = await bcrypt.hash(pw, 10);
  const { rows: [u] } = await db.query(
    `INSERT INTO users (email, password_hash, role, display_name, must_change_password)
     VALUES ($1,$2,'employee',$3,TRUE) RETURNING id`, [email, hash, d.full_name]);
  const { rows: [{ n }] } = await db.query('SELECT COALESCE(max(id),0)+1 AS n FROM employees');
  const { rows: [e] } = await db.query(
    `INSERT INTO employees (user_id, emp_code, full_name, phone, address, department_id, designation_id, join_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [u.id, 'EMP-' + String(n).padStart(4, '0'), d.full_name, d.phone || null, d.address || null,
     d.department_id || null, d.designation_id || null, d.join_date]);
  if (d.basic != null && d.basic !== '')
    await db.query('INSERT INTO salary_structures (employee_id, basic) VALUES ($1,$2)', [e.id, d.basic]);
  await audit(db, actor, 'create', 'employee', e.id, null, { ...e, email });
  return { employee: e, email, temp_password: pw };
}

/** Minimal RFC-4180-ish CSV parser (quotes, commas, newlines in quotes). */
export function parseCsv(text) {
  const rows = []; let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

export const csvEscape = (v) => {
  const s = v == null ? '' : String(v);
  // Prefix formula-looking cells to avoid CSV injection when opened in Excel.
  const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
  return /[",\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
};
