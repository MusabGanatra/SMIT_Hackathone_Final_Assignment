import { q } from '../db.js';
import { HttpError } from '../utils/http.js';

export async function getSettings(db = { query: q }) {
  const { rows: [s] } = await db.query('SELECT * FROM company_settings WHERE id = 1');
  if (!s) throw new HttpError(409, 'Company setup has not been completed');
  return s;
}
export async function getHolidaySet(db, from, to) {
  const { rows } = await db.query('SELECT date FROM holidays WHERE date BETWEEN $1 AND $2', [from, to]);
  return new Set(rows.map((r) => r.date));
}
