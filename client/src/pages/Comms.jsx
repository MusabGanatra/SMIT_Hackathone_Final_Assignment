import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.js';
import { Card, Field, Confirm, ErrorBox, Loading, Empty, useLoad, useToast } from '../ui.jsx';

export function Announcements() {
  const { user } = useAuth(); const { data, error, loading, reload } = useLoad(() => api.get('/comms/announcements'));
  const [f, setF] = useState({ title: '', body: '' }); const [del, setDel] = useState(null); const toast = useToast();
  const post = async (e) => { e.preventDefault(); try { await api.post('/comms/announcements', f); setF({ title: '', body: '' }); toast.ok('Announcement posted'); reload(); } catch (x) { toast.err(x.message); } };
  return (
    <div className="col"><h1>Announcements</h1><ErrorBox error={error} />
      {['admin', 'hr'].includes(user.role) && <Card title="Post an announcement"><form className="col" onSubmit={post}>
        <Field label="Title"><input required minLength={3} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Message"><textarea required minLength={3} rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        <div className="row end"><button className="btn primary">Post</button></div></form></Card>}
      {loading ? <Loading /> : !data?.length ? <Card><Empty>No announcements yet.</Empty></Card> : data.map((a) => (
        <Card key={a.id} title={a.title} actions={user.role === 'admin' && <button className="btn sm" onClick={() => setDel(a)}>Delete</button>}>
          <div className="muted small">{new Date(a.created_at).toLocaleString()} · {a.author || 'Admin'}</div><p style={{ whiteSpace: 'pre-wrap' }}>{a.body}</p></Card>))}
      {del && <Confirm title="Delete announcement" message={`Delete “${del.title}”?`} onNo={() => setDel(null)} onYes={async () => { try { await api.del('/comms/announcements/' + del.id); reload(); } catch (x) { toast.err(x.message); } setDel(null); }} />}
      {toast.node}</div>
  );
}

export function Notifications({ onChange }) {
  const { data, error, loading, reload } = useLoad(() => api.get('/comms/notifications'));
  const readAll = async () => { await api.post('/comms/notifications/read-all'); reload(); onChange?.(); };
  const read = async (n) => { if (!n.read) { await api.post(`/comms/notifications/${n.id}/read`); reload(); onChange?.(); } };
  return (
    <div className="col"><div className="card-head"><h1>Notifications</h1><button className="btn" onClick={readAll} disabled={!data?.unread}>Mark all read</button></div><ErrorBox error={error} />
      <Card>{loading ? <Loading /> : !data?.items.length ? <Empty>You have no notifications.</Empty> : data.items.map((n) => (
        <div key={n.id} onClick={() => read(n)} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)', cursor: 'pointer', opacity: n.read ? 0.6 : 1 }}>
          <b>{!n.read && '● '}{n.title}</b><div>{n.body}</div><div className="muted small">{new Date(n.created_at).toLocaleString()}</div></div>))}</Card></div>
  );
}

export function AuditLog() {
  const [page, setPage] = useState(1); const [entity, setEntity] = useState(''); const [open, setOpen] = useState(null);
  const { data, error, loading } = useLoad(() => api.get(`/comms/audit-logs?page=${page}${entity ? '&entity=' + entity : ''}`), [page, entity]);
  const pages = data ? Math.max(1, Math.ceil(data.total / 25)) : 1;
  return (
    <div className="col"><div className="card-head"><h1>Audit log</h1>
      <select style={{ width: 200 }} value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} aria-label="Entity filter"><option value="">All entities</option>
        {['employee', 'leave_request', 'attendance', 'attendance_correction', 'payroll_run', 'salary_structure', 'user', 'company_settings', 'announcement'].map((x) => <option key={x}>{x}</option>)}</select></div>
      <p className="muted small">Read-only and append-only: the database blocks updates and deletes on audit records.</p><ErrorBox error={error} />
      <Card>{loading && !data ? <Loading /> : !data?.rows.length ? <Empty>No audit entries.</Empty> : <>
        <div className="table-wrap"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>ID</th><th /></tr></thead><tbody>
          {data.rows.map((r) => <tr key={r.id}><td>{new Date(r.created_at).toLocaleString()}</td><td>{r.actor_email || 'system'}</td><td>{r.action}</td><td>{r.entity}</td><td>{r.entity_id}</td>
            <td>{(r.before || r.after) && <button className="btn sm" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide' : 'Diff'}</button>}</td></tr>)}</tbody></table></div>
        {open && (() => { const r = data.rows.find((x) => x.id === open); return <div className="grid g2 pad"><div><b>Before</b><pre className="secret small">{JSON.stringify(r.before, null, 1)}</pre></div><div><b>After</b><pre className="secret small">{JSON.stringify(r.after, null, 1)}</pre></div></div>; })()}
        <div className="row end pad"><span className="muted">{data.total} entries · page {page} of {pages}</span><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button><button className="btn sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div></>}</Card></div>
  );
}
