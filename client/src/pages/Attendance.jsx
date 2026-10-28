import { useState } from 'react';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.js';
import { Card, Field, Modal, ErrorBox, Loading, Empty, Badge, useLoad, useToast, fmtTime, today } from '../ui.jsx';
import { Calendar } from './Dashboard.jsx';

export default function Attendance() {
  const { user } = useAuth();
  return user.role === 'employee' ? <MyAttendance /> : <StaffAttendance />;
}

function MyAttendance() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const { data: cal, error } = useLoad(() => api.get('/attendance/calendar?month=' + month), [month]);
  const { data: tod, reload: rt } = useLoad(() => api.get('/attendance/today'));
  const { data: corr, reload: rc } = useLoad(() => api.get('/attendance/corrections'));
  const [form, setForm] = useState(null); const toast = useToast();
  const act = async (p) => { try { await api.post(p); await rt(); toast.ok('Done'); } catch (e) { toast.err(e.message); } };
  const rec = tod?.record;
  return (
    <div className="col"><h1>My attendance</h1>
      <Card title="Today" actions={<><button className="btn primary" disabled={!tod || !!rec} onClick={() => act('/attendance/check-in')}>Check in</button><button className="btn" disabled={!rec || !!rec.check_out} onClick={() => act('/attendance/check-out')}>Check out</button></>}>
        {rec ? <>Checked in {fmtTime(rec.check_in)} {rec.is_late && <Badge>late</Badge>} · out {fmtTime(rec.check_out)}</> : 'Not checked in yet'}
        <div className="muted small">Times are recorded by the server, not your device.</div></Card>
      <Card title="Calendar" actions={<><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 160 }} /><button className="btn sm" onClick={() => setForm({ work_date: today() })}>Request correction</button></>}>
        <ErrorBox error={error} />{cal ? <Calendar days={cal.days} /> : <Loading />}</Card>
      <Card title="My correction requests">{corr?.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Requested</th><th>Reason</th><th>Status</th><th>HR comment</th></tr></thead><tbody>
        {corr.map((c) => <tr key={c.id}><td>{c.work_date}</td><td>{c.requested_check_in}–{c.requested_check_out || '?'}</td><td>{c.reason}</td><td><Badge>{c.status}</Badge></td><td>{c.review_comment || ''}</td></tr>)}</tbody></table></div> : <Empty />}</Card>
      {form && <CorrectionForm init={form} onClose={() => setForm(null)} onDone={() => { setForm(null); rc(); toast.ok('Request submitted'); }} />}
      {toast.node}
    </div>
  );
}

function CorrectionForm({ init, onClose, onDone }) {
  const [f, setF] = useState({ work_date: init.work_date, check_in: '09:00', check_out: '17:00', reason: '' }); const [err, setErr] = useState('');
  const submit = async (e) => { e.preventDefault(); try { await api.post('/attendance/corrections', { ...f, check_out: f.check_out || null }); onDone(); } catch (x) { setErr(x.message); } };
  return (
    <Modal title="Request attendance correction" onClose={onClose}><ErrorBox error={err} />
      <form className="col" onSubmit={submit}><div className="form-grid">
        <Field label="Date"><input type="date" required max={today()} value={f.work_date} onChange={(e) => setF({ ...f, work_date: e.target.value })} /></Field>
        <Field label="Check-in"><input type="time" required value={f.check_in} onChange={(e) => setF({ ...f, check_in: e.target.value })} /></Field>
        <Field label="Check-out"><input type="time" value={f.check_out} onChange={(e) => setF({ ...f, check_out: e.target.value })} /></Field></div>
        <Field label="Reason"><textarea required minLength={5} rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        <div className="row end"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary">Submit</button></div></form>
    </Modal>
  );
}

function StaffAttendance() {
  const [date, setDate] = useState(today()); const [dept, setDept] = useState(''); const [tab, setTab] = useState('board');
  const { data: depts } = useLoad(() => api.get('/org/departments'));
  const board = useLoad(() => api.get('/attendance/board?' + qs({ date, department_id: dept })), [date, dept]);
  const corr = useLoad(() => api.get('/attendance/corrections?status=pending'));
  const [edit, setEdit] = useState(null); const [decide, setDecide] = useState(null); const toast = useToast();
  return (
    <div className="col"><div className="card-head"><h1>Attendance</h1><div className="row"><button className={'btn ' + (tab === 'board' ? 'primary' : '')} onClick={() => setTab('board')}>Daily board</button><button className={'btn ' + (tab === 'corr' ? 'primary' : '')} onClick={() => setTab('corr')}>Corrections ({corr.data?.length ?? 0})</button></div></div>
      {tab === 'board' ? <Card>
        <div className="form-grid"><Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Department"><select value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All</option>{depts?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field></div>
        <ErrorBox error={board.error} />
        {board.loading && !board.data ? <Loading /> : !board.data?.rows.length ? <Empty>No employees to show for this date.</Empty> :
          <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Department</th><th>Status</th><th>In</th><th>Out</th><th /></tr></thead><tbody>
            {board.data.rows.map((r) => <tr key={r.id}><td>{r.full_name}</td><td>{r.department || '-'}</td><td><Badge>{r.status}</Badge></td><td>{fmtTime(r.check_in)}</td><td>{fmtTime(r.check_out)}</td>
              <td><button className="btn sm" onClick={() => setEdit(r)}>Correct</button></td></tr>)}</tbody></table></div>}
      </Card> : <Card>
        {!corr.data?.length ? <Empty>No pending correction requests.</Empty> : <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Date</th><th>Requested</th><th>Reason</th><th /></tr></thead><tbody>
          {corr.data.map((c) => <tr key={c.id}><td>{c.full_name}</td><td>{c.work_date}</td><td>{c.requested_check_in}–{c.requested_check_out || '?'}</td><td>{c.reason}</td>
            <td><button className="btn sm" onClick={() => setDecide(c)}>Review</button></td></tr>)}</tbody></table></div>}
      </Card>}
      {edit && <HrCorrect row={edit} date={date} onClose={() => setEdit(null)} onDone={() => { setEdit(null); board.reload(); toast.ok('Attendance updated'); }} />}
      {decide && <Decision title="Review correction" item={decide} url={`/attendance/corrections/${decide.id}/decision`} onClose={() => setDecide(null)} onDone={() => { setDecide(null); corr.reload(); toast.ok('Decision saved'); }} />}
      {toast.node}
    </div>
  );
}

function HrCorrect({ row, date, onClose, onDone }) {
  const [f, setF] = useState({ check_in: '09:00', check_out: '17:00' }); const [err, setErr] = useState('');
  const submit = async (e) => { e.preventDefault(); try { await api.put('/attendance/record', { employee_id: row.id, work_date: date, check_in: f.check_in, check_out: f.check_out || null }); onDone(); } catch (x) { setErr(x.message); } };
  return (
    <Modal title={`Correct ${row.full_name} · ${date}`} onClose={onClose}><ErrorBox error={err} />
      <form className="col" onSubmit={submit}><div className="form-grid"><Field label="Check-in"><input type="time" required value={f.check_in} onChange={(e) => setF({ ...f, check_in: e.target.value })} /></Field>
        <Field label="Check-out"><input type="time" value={f.check_out} onChange={(e) => setF({ ...f, check_out: e.target.value })} /></Field></div>
        <p className="muted small">This overwrites the day's record and is written to the audit log with before/after values.</p>
        <div className="row end"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary">Save correction</button></div></form>
    </Modal>
  );
}

/** Shared approve/reject-with-comment dialog (attendance corrections and leave). */
export function Decision({ title, item, url, onClose, onDone }) {
  const [comment, setComment] = useState(''); const [err, setErr] = useState('');
  const go = async (approve) => { try { await api.post(url, { approve, comment: comment || undefined }); onDone(); } catch (x) { setErr(x.message); } };
  return (
    <Modal title={title} onClose={onClose}><ErrorBox error={err} />
      <p><b>{item.full_name}</b> · {item.work_date || `${item.start_date} → ${item.end_date}`} {item.leave_type && `· ${item.leave_type} (${item.days}d)`}</p>
      <p>{item.reason}</p>
      <Field label="Comment" hint="Required when rejecting"><textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
      <div className="row end"><button className="btn danger" onClick={() => go(false)}>Reject</button><button className="btn primary" onClick={() => go(true)}>Approve</button></div>
    </Modal>
  );
}
