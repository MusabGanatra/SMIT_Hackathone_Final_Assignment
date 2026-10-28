import pg from 'pg';
import { config } from './config.js';

pg.types.setTypeParser(1082, (v) => v);             // DATE -> 'YYYY-MM-DD' string
pg.types.setTypeParser(1700, (v) => parseFloat(v)); // NUMERIC -> number
pg.types.setTypeParser(20, (v) => parseInt(v, 10)); // COUNT -> number

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.dbSsl ? { rejectUnauthorized: false } : undefined,
});
export const q = (text, params) => pool.query(text, params);

/** Run fn inside a transaction. fn receives a client with .query(). */
export async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
