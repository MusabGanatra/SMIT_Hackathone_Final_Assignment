import { useState } from 'react';
import { api } from '../api.js';
import { Card, Field, Confirm, Secret, ErrorBox, Loading, Empty, Badge, useLoad, useToast } from '../ui.jsx';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function Organization() {
  const toast = useToast();
  return (
    <div className="col"><h1>Organization setup</h1>
      <SettingsCard toast={toast} />
      <div className="grid g2"><Simple title="Departments" path="/org/departments" toast={toast} /><Simple title="Designations" path="/org/designations" toast={toast} /></div>
      <LeaveTypes toast={toast} /><Holidays toast={toast} /><Users toast={toast} />{toast.node}</div>
  );
}

function SettingsCard({ toast }) {
  const { data, error } = useLoad(() => api.get('/org/settings'));
  const [f, setF] = useState(null); const [slabs, setSlabs] = useState('');
  if (data && !f) { setF({ ...data, office_lat: data.office_lat ?? '', office_lng: data.office_lng ?? '', radius_m: data.radius_m ?? '' }); setSlabs(JSON.stringify(data.tax_slabs, null, 1)); }
  if (!f) return <Card><ErrorBox error={error} /><Loading /></Card>;
  const set = (k, num) => (e) => setF({ ...f, [k]: num ? e.target.value : e.target.value });
  const n = (v) => (v === '' || v == null ? null : Number(v));
  const save = async (e) => {
    e.preventDefault();
    try {
      await api.put('/org/settings', { name: f.name, timezone: f.timezone, office_start: f.office_start, grace_minutes: Number(f.grace_minutes), halfday_hours: Number(f.halfday_hours), weekends: f.weekends,
        office_lat: n(f.office_lat), office_lng: n(f.office_lng), radius_m: n(f.radius_m), tax_slabs: JSON.parse(slabs) });
      toast.ok('Settings saved');
    } catch (x) { toast.err(x instanceof SyntaxError ? 'Tax slabs must be valid JSON' : x.message); }
  };
  return (
    <Card title="Company profile & rules"><form className="col" onSubmit={save}><div className="form-grid">
      <Field label="Company name"><input required value={f.name} onChange={set('name')} /></Field>
      <Field label="Timezone (IANA)"><input required value={f.timezone} onChange={set('timezone')} /></Field>
      <Field label="Office start (HH:MM)"><input required pattern="([01]\d|2[0-3]):[0-5]\d" value={f.office_start} onChange={set('office_start')} /></Field>
      <Field label="Grace minutes"><input type="number" min="0" value={f.grace_minutes} onChange={set('grace_minutes')} /></Field>
      <Field label="Half-day if under (hours)"><input type="number" step="0.5" min="1" value={f.halfday_hours} onChange={set('halfday_hours')} /></Field>
      <Field label="Office latitude"><input type="number" step="any" value={f.office_lat} onChange={set('office_lat')} /></Field>
      <Field label="Office longitude"><input type="number" step="any" value={f.office_lng} onChange={set('office_lng')} /></Field>
      <Field label="Attendance radius (m)" hint="Stored for the optional GPS feature"><input type="number" min="10" value={f.radius_m} onChange={set('radius_m')} /></Field></div>
      <div className="row"><b>Weekends:</b>{DAYS.map((d, i) => <label key={d} className="row"><input type="checkbox" style={{ width: 'auto' }} checked={f.weekends.includes(i)} onChange={(e) => setF({ ...f, weekends: e.target.checked ? [...f.weekends, i] : f.weekends.filter((x) => x !== i) })} />{d}</label>)}</div>
      <Field label="Annual tax slabs (JSON)" hint='Progressive, ascending: [{"upTo":600000,"rate":0},{"upTo":null,"rate":0.15}]. Replace defaults with your brief’s slabs.'><textarea rows={5} value={slabs} onChange={(e) => setSlabs(e.target.value)} /></Field>
      <div className="row end"><button className="btn primary">Save settings</button></div></form></Card>
  );
}

function Simple({ title, path, toast }) {
  const { data, error, reload } = useLoad(() => api.get(path)); const [name, setName] = useState(''); const [del, setDel] = useState(null);
  const add = async (e) => { e.preventDefault(); try { await api.post(path, { name }); setName(''); reload(); } catch (x) { toast.err(x.message); } };
  return (
    <Card title={title}><ErrorBox error={error} /><form className="row" onSubmit={add}><input required minLength={2} placeholder={`New ${title.toLowerCase().slice(0, -1)}`} value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} /><button className="btn primary">Add</button></form>
      {!data ? <Loading /> : !data.length ? <Empty /> : <table><tbody>{data.map((d) => <tr key={d.id}><td>{d.name}</td><td style={{ textAlign: 'right' }}><button className="btn sm" onClick={() => setDel(d)}>Delete</button></td></tr>)}</tbody></table>}
      {del && <Confirm title="Delete" message={`Delete “${del.name}”?`} onNo={() => setDel(null)} onYes={async () => { try { await api.del(`${path}/${del.id}`); reload(); } catch (x) { toast.err(x.message); } setDel(null); }} />}</Card>
  );
}

function LeaveTypes({ toast }) {
  const { data, reload } = useLoad(() => api.get('/org/leave-types')); const [f, setF] = useState({ code: '', name: '', annual_quota: '', paid: true });
  const add = async (e) => { e.preventDefault(); try { await api.post('/org/leave-types', { ...f, annual_quota: f.annual_quota === '' ? null : Number(f.annual_quota) }); setF({ code: '', name: '', annual_quota: '', paid: true }); reload(); } catch (x) { toast.err(x.message); } };
  const quota = async (t, v) => { try { await api.put('/org/leave-types/' + t.id, { code: t.code, name: t.name, paid: t.paid, annual_quota: v === '' ? null : Number(v) }); toast.ok('Quota updated'); reload(); } catch (x) { toast.err(x.message); } };
  return (
    <Card title="Leave types & yearly quotas">{!data ? <Loading /> : <div className="table-wrap"><table><thead><tr><th>Code</th><th>Name</th><th>Annual quota (blank = none)</th><th>Paid</th></tr></thead><tbody>
      {data.map((t) => <tr key={t.id}><td>{t.code}</td><td>{t.name}</td><td><input type="number" min="0" style={{ width: 90 }} defaultValue={t.annual_quota ?? ''} onBlur={(e) => String(t.annual_quota ?? '') !== e.target.value && quota(t, e.target.value)} /></td><td>{t.paid ? 'Yes' : 'No'}</td></tr>)}</tbody></table></div>}
      <form className="row pad" onSubmit={add}><input required placeholder="code (e.g. maternity)" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /><input required placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input type="number" min="0" placeholder="Quota" value={f.annual_quota} onChange={(e) => setF({ ...f, annual_quota: e.target.value })} style={{ width: 100 }} />
        <label className="row"><input type="checkbox" style={{ width: 'auto' }} checked={f.paid} onChange={(e) => setF({ ...f, paid: e.target.checked })} />Paid</label><button className="btn primary">Add type</button></form></Card>
  );
}

function Holidays({ toast }) {
  const { data, reload } = useLoad(() => api.get('/org/holidays')); const [f, setF] = useState({ date: '', name: '' }); const [del, setDel] = useState(null);
  const add = async (e) => { e.preventDefault(); try { await api.post('/org/holidays', f); setF({ date: '', name: '' }); reload(); } catch (x) { toast.err(x.message); } };
  return (
    <Card title="Public holidays"><form className="row" onSubmit={add}><input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} style={{ width: 170 }} /><input required placeholder="Holiday name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={{ flex: 1 }} /><button className="btn primary">Add</button></form>
      {!data ? <Loading /> : !data.length ? <Empty>No holidays added.</Empty> : <table><tbody>{data.map((h) => <tr key={h.id}><td>{h.date}</td><td>{h.name}</td><td style={{ textAlign: 'right' }}><button className="btn sm" onClick={() => setDel(h)}>Delete</button></td></tr>)}</tbody></table>}
      {del && <Confirm title="Delete holiday" message={`Delete “${del.name}” (${del.date})?`} onNo={() => setDel(null)} onYes={async () => { try { await api.del('/org/holidays/' + del.id); reload(); } catch (x) { toast.err(x.message); } setDel(null); }} />}</Card>
  );
}

function Users({ toast }) {
  const { data, reload } = useLoad(() => api.get('/org/users')); const [f, setF] = useState({ name: '', email: '', role: 'hr' }); const [secret, setSecret] = useState(null); const [reset, setReset] = useState(null);
  const add = async (e) => { e.preventDefault(); try { const r = await api.post('/org/users', f); setSecret({ email: r.user.email, temp_password: r.temp_password }); setF({ name: '', email: '', role: 'hr' }); reload(); } catch (x) { toast.err(x.message); } };
  const toggle = async (u) => { try { await api.patch(`/org/users/${u.id}/active`, { active: !u.active }); reload(); } catch (x) { toast.err(x.message); } };
  return (
    <Card title="Staff logins (HR / Admin)"><p className="muted small">Employee logins are created automatically when you register an employee.</p>
      <form className="row" onSubmit={add}><input required placeholder="Full name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /><input required type="email" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} style={{ width: 110 }}><option value="hr">HR</option><option value="admin">Admin</option></select><button className="btn primary">Create login</button></form>
      {!data ? <Loading /> : <div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th /></tr></thead><tbody>
        {data.map((u) => <tr key={u.id}><td>{u.display_name}</td><td>{u.email}</td><td>{u.role}</td><td><Badge>{u.active ? 'active' : 'inactive'}</Badge></td>
          <td className="row"><button className="btn sm" onClick={() => toggle(u)}>{u.active ? 'Deactivate' : 'Activate'}</button><button className="btn sm" onClick={() => setReset(u)}>Reset password</button></td></tr>)}</tbody></table></div>}
      {secret && <Secret info={secret} onClose={() => setSecret(null)} />}
      {reset && <Confirm title="Reset password" yesLabel="Reset" message={`Generate a new temporary password for ${reset.email}?`} onNo={() => setReset(null)} onYes={async () => { try { const r = await api.post(`/org/users/${reset.id}/reset-password`); setSecret(r); } catch (x) { toast.err(x.message); } setReset(null); }} />}</Card>
  );
}
