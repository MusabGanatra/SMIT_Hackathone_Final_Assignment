import { q } from '../db.js';

/** Append an audit record. `db` may be the pool or a transaction client. */
export async function audit(db, actor, action, entity, entityId, before = null, after = null) {
  const strip = (o) => {
    if (!o) return null;
    const c = { ...o };
    delete c.password_hash; delete c.password; delete c.temp_password;
    return JSON.stringify(c);
  };
  await (db || { query: q }).query(
    `INSERT INTO audit_logs (actor_id, actor_email, action, entity, entity_id, before, after)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [actor?.id ?? null, actor?.email ?? null, action, entity, String(entityId ?? ''), strip(before), strip(after)]);
}

export async function notify(db, userId, title, body = null) {
  await db.query('INSERT INTO notifications (user_id, title, body) VALUES ($1,$2,$3)', [userId, title, body]);
}
