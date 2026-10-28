import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.js';
import { Card, Field, Confirm, ErrorBox, Loading, Empty, Badge, useLoad, useToast, today } from '../ui.jsx';
import { Decision } from './Attendance.jsx';

export default function Leave() {
  const { user } = useAuth();
  return user.role === 'employee' ? <MyLeave /> : <LeaveQueue />;
}

function MyLeave() {
  const { data: types } = useLoad(() => api.get('/org/leave-types'));
  const bal = useLoad(() => api.get('/leave/balance'));
  const hist = useLoad(() => api.get('/leave/mine'));
  const [f, setF] = useState({ leave_type_id: '', start_date: today(), end_date: today(), reason: '' });
  const [ai, setAi] = useState({ text: '', busy: false, note: '' }); const [err, setErr] = useState(''); const [days, setDays] = useState(null);
  const [cancel, setCancel] = useState(null); const toast = useToast();
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setDays(null); };
  const body = () => ({ leave_type_id: Number(f.leave_type_id), start_date: f.start_date, end_date: f.end_date, reason: f.reason || undefined });

  const parse = async () => {
    setAi({ ...ai, busy: true, note: '' }); setErr('');
    try {
      const r = await api.post('/ai/parse-leave', { text: ai.text });
      const t = types.find((x) => x.code === r.draft.leave_type);
      setF({ leave_type_id: t ? String(t.id) : '', start_date: r.draft.start_date, end_date: r.draft.end_date, reason: r.draft.reason }); setDays(null);
      setAi({ ...ai, busy: false, note: `${r.label}: form prefilled. Review it, then press Submit to confirm.` });
    } catch (e) { setAi({ ...ai, busy: false }); setErr(e.message); }
  };
  const check = async () => { setErr(''); try { setDays((await api.post('/leave/check', body())).days); } catch (e) { setErr(e.message); setDays(null); } };
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try { await api.post('/leave', body()); toast.ok('Leave request submitted'); setDays(null); setF({ ...f, reason: '' }); bal.reload(); hist.reload(); } catch (x) { setErr(x.message); }
  };
  return (
    <div className="col"><h1>My leave</h1>
      <Card title="Balance">{bal.loading && !bal.data ? <Loading /> : <div className="table-wrap"><table><thead><tr><th>Type</th><th>Quota</th><th>Used</th><th>Pending</th><th>Remaining</th></tr></thead><tbody>
        {bal.data?.map((b) => <tr key={b.code}><td>{b.name}</td><td>{b.quota ?? 'No limit'}</td><td>{b.used}</td><td>{b.pending}</td><td><b>{b.remaining ?? '∞'}</b></td></tr>)}</tbody></table></div>}</Card>
      <Card title="Smart leave form (AI)">
        <div className="row"><input style={{ flex: 1, minWidth: 220 }} placeholder='e.g. "I need sick leave next Monday and Tuesday for a dentist visit"' value={ai.text} onChange={(e) => setAi({ ...ai, text: e.target.value })} />
          <button className="btn" disabled={ai.busy || ai.text.trim().length < 3 || !types} onClick={parse}>{ai.busy ? 'Reading…' : 'Fill form with AI'}</button></div>
        {ai.note && <div className="alert info" style={{ marginTop: 10 }}>{ai.note}</div>}
      </Card>
      <Card title="Apply for leave"><ErrorBox error={err} />
        <form className="col" onSubmit={submit}><div className="form-grid">
          <Field label="Leave type"><select required value={f.leave_type_id} onChange={set('leave_type_id')}><option value="">Select…</option>{types?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
          <Field label="From"><input type="date" required value={f.start_date} onChange={set('start_date')} /></Field>
          <Field label="To"><input type="date" required min={f.start_date} value={f.end_date} onChange={set('end_date')} /></Field></div>
          <Field label="Reason"><textarea rows={2} value={f.reason} onChange={set('reason')} /></Field>
          <div className="row"><button type="button" className="btn" disabled={!f.leave_type_id} onClick={check}>Check days &amp; balance</button>{days != null && <span className="badge ok">{days} working day(s)</span>}
            <button className="btn primary" disabled={!f.leave_type_id}>Submit request</button></div></form></Card>
      <Card title="History">{hist.loading && !hist.data ? <Loading /> : !hist.data?.length ? <Empty>You have not requested any leave.</Empty> : <div className="table-wrap"><table><thead><tr><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Status</th><th>Comment</th><th /></tr></thead><tbody>
        {hist.data.map((l) => <tr key={l.id}><td>{l.leave_type}</td><td>{l.start_date}</td><td>{l.end_date}</td><td>{l.days}</td><td><Badge>{l.status}</Badge></td><td>{l.review_comment || ''}</td>
          <td>{['pending', 'approved'].includes(l.status) && <button className="btn sm" onClick={() => setCancel(l)}>Cancel</button>}</td></tr>)}</tbody></table></div>}</Card>
      {cancel && <Confirm title="Cancel leave request" message={`Cancel ${cancel.leave_type} leave from ${cancel.start_date} to ${cancel.end_date}?`} yesLabel="Yes, cancel it" onNo={() => setCancel(null)}
        onYes={async () => { try { await api.post(`/leave/${cancel.id}/cancel`); toast.ok('Cancelled'); bal.reload(); hist.reload(); } catch (e) { toast.err(e.message); } setCancel(null); }} />}
      {toast.node}
    </div>
  );
}

function LeaveQueue() {
  const [status, setStatus] = useState('pending');
  const { data, error, loading, reload } = useLoad(() => api.get('/leave' + (status ? `?status=${status}` : '')), [status]);
  const [sel, setSel] = useState(null); const toast = useToast();
  return (
    <div className="col"><div className="card-head"><h1>Leave requests</h1>
      <select style={{ width: 160 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter"><option value="">All</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option></select></div>
      <ErrorBox error={error} />
      <Card>{loading && !data ? <Loading /> : !data?.length ? <Empty>No leave requests{status ? ` with status “${status}”` : ''}.</Empty> : <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Reason</th><th>Status</th><th /></tr></thead><tbody>
        {data.map((l) => <tr key={l.id}><td>{l.full_name}</td><td>{l.leave_type}</td><td>{l.start_date}</td><td>{l.end_date}</td><td>{l.days}</td><td>{l.reason}</td><td><Badge>{l.status}</Badge></td>
          <td>{l.status === 'pending' && <button className="btn sm" onClick={() => setSel(l)}>Review</button>}</td></tr>)}</tbody></table></div>}</Card>
      {sel && <Decision title="Review leave request" item={sel} url={`/leave/${sel.id}/decision`} onClose={() => setSel(null)} onDone={() => { setSel(null); reload(); toast.ok('Decision saved'); }} />}
      {toast.node}
    </div>
  );
}
