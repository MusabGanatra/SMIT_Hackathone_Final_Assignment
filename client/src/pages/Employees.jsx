import { useState } from 'react';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.js';
import { Card, Field, Modal, Secret, ErrorBox, Loading, Empty, Badge, useLoad, useToast, money, today } from '../ui.jsx';

export default function Employees() {
  const { user } = useAuth();
  const [f, setF] = useState({ q: '', department_id: '', status: '', page: 1 });
  const [form, setForm] = useState(null); const [view, setView] = useState(null); const [imp, setImp] = useState(false); const [secret, setSecret] = useState(null);
  const toast = useToast();
  const { data: depts } = useLoad(() => api.get('/org/departments'));
  const { data: desigs } = useLoad(() => api.get('/org/designations'));
  const { data, error, loading, reload } = useLoad(() => api.get('/employees?' + qs({ ...f, pageSize: 10 })), [f.q, f.department_id, f.status, f.page]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value, page: 1 });
  return (
    <div className="col">
      <div className="card-head"><h1>Employees</h1>
        <div className="row"><button className="btn" onClick={() => api.download('/employees/export', 'employees.csv').catch((e) => toast.err(e.message))}>Export CSV</button>
          <button className="btn" onClick={() => setImp(true)}>Import CSV</button>
          <button className="btn primary" onClick={() => setForm({})}>+ Add employee</button></div></div>
      <Card>
        <div className="form-grid">
          <Field label="Search"><input placeholder="Name, code or email" value={f.q} onChange={set('q')} /></Field>
          <Field label="Department"><select value={f.department_id} onChange={set('department_id')}><option value="">All</option>{depts?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
          <Field label="Status"><select value={f.status} onChange={set('status')}><option value="">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>
        </div>
      </Card>
      <ErrorBox error={error} />
      <Card>{loading && !data ? <Loading /> : !data?.rows.length ? <Empty>No employees found. Click “Add employee” to register the first one.</Empty> : <>
        <div className="table-wrap"><table><thead><tr><th>Code</th><th>Name</th><th>Email</th><th>Department</th><th>Designation</th><th>Joined</th><th>Status</th><th /></tr></thead><tbody>
          {data.rows.map((e) => <tr key={e.id}><td>{e.emp_code}</td><td>{e.full_name}</td><td>{e.email}</td><td>{e.department || '-'}</td><td>{e.designation || '-'}</td><td>{e.join_date}</td><td><Badge>{e.status}</Badge></td>
            <td className="row"><button className="btn sm" onClick={() => setView(e.id)}>360° view</button><button className="btn sm" onClick={() => setForm(e)}>Edit</button></td></tr>)}</tbody></table></div>
        <div className="row end pad"><span className="muted">{data.total} total · page {f.page} of {pages}</span>
          <button className="btn sm" disabled={f.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })}>Prev</button>
          <button className="btn sm" disabled={f.page >= pages} onClick={() => setF({ ...f, page: f.page + 1 })}>Next</button></div></>}</Card>
      {form && <EmpForm init={form} depts={depts || []} desigs={desigs || []} onClose={() => setForm(null)} onSaved={(s) => { setForm(null); reload(); toast.ok('Saved'); if (s) setSecret(s); }} />}
      {view && <Employee360 id={view} onClose={() => setView(null)} toast={toast} />}
      {imp && <ImportModal onClose={() => { setImp(false); reload(); }} />}
      {secret && <Secret info={secret} onClose={() => setSecret(null)} />}
      {toast.node}
    </div>
  );
}

function EmpForm({ init, depts, desigs, onClose, onSaved }) {
  const edit = !!init.id;
  const [f, setF] = useState({ full_name: init.full_name || '', email: init.email || '', phone: init.phone || '', address: init.address || '', department_id: init.department_id || '', designation_id: init.designation_id || '',
    join_date: init.join_date || today(), leave_date: init.leave_date || '', status: init.status || 'active', basic: '' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const num = (v) => (v === '' ? null : Number(v));
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try {
      if (edit) {
        await api.put('/employees/' + init.id, { full_name: f.full_name, phone: f.phone || null, address: f.address || null, department_id: num(f.department_id), designation_id: num(f.designation_id), join_date: f.join_date, leave_date: f.leave_date || null, status: f.status });
        onSaved();
      } else {
        const r = await api.post('/employees', { full_name: f.full_name, email: f.email, phone: f.phone || null, address: f.address || null, department_id: num(f.department_id), designation_id: num(f.designation_id), join_date: f.join_date, basic: num(f.basic) });
        onSaved({ email: r.email, temp_password: r.temp_password });
      }
    } catch (x) { setErr(x.message); }
  };
  return (
    <Modal title={edit ? 'Edit employee' : 'Register employee'} onClose={onClose}><ErrorBox error={err} />
      <form className="col" onSubmit={submit}><div className="form-grid">
        <Field label="Full name"><input required value={f.full_name} onChange={set('full_name')} /></Field>
        <Field label="Email (login)"><input required type="email" disabled={edit} value={f.email} onChange={set('email')} /></Field>
        <Field label="Phone"><input value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Address"><input value={f.address} onChange={set('address')} /></Field>
        <Field label="Department"><select value={f.department_id} onChange={set('department_id')}><option value="">-</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        <Field label="Designation"><select value={f.designation_id} onChange={set('designation_id')}><option value="">-</option>{desigs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        <Field label="Joining date"><input required type="date" value={f.join_date} onChange={set('join_date')} /></Field>
        {edit ? <><Field label="Leaving date"><input type="date" value={f.leave_date} onChange={set('leave_date')} /></Field>
          <Field label="Status"><select value={f.status} onChange={set('status')}><option value="active">Active</option><option value="inactive">Inactive</option></select></Field></>
          : <Field label="Basic salary (optional)" hint="HRA, medical and gross are calculated"><input type="number" min="0" value={f.basic} onChange={set('basic')} /></Field>}
      </div><div className="row end"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary">{edit ? 'Save changes' : 'Register & create login'}</button></div></form>
    </Modal>
  );
}

function Employee360({ id, onClose, toast }) {
  const { data, error } = useLoad(() => api.get(`/employees/${id}/360`), [id]);
  const [basic, setBasic] = useState('');
  const saveSalary = async () => { try { await api.put(`/employees/${id}/salary`, { basic: Number(basic) }); toast.ok('Salary structure saved'); } catch (e) { toast.err(e.message); } };
  return (
    <Modal title="Employee 360" onClose={onClose}><ErrorBox error={error} />
      {!data ? <Loading /> : <div className="col">
        <div><h3>{data.profile.full_name} <span className="muted">({data.profile.emp_code})</span></h3>
          <div className="muted">{data.profile.email} · {data.profile.phone || 'no phone'} · {data.profile.department || 'No department'} / {data.profile.designation || 'No designation'}</div>
          <div className="muted">Joined {data.profile.join_date}{data.profile.leave_date ? ` · left ${data.profile.leave_date}` : ''}</div></div>
        <div><b>Attendance this month:</b> {Object.entries(data.attendance_this_month).map(([k, v]) => <span key={k} style={{ marginRight: 10 }}>{k.replace('_', ' ')} {v}</span>)}</div>
        <div><b>Leave balance:</b> {data.leave_balance.map((b) => <span key={b.code} style={{ marginRight: 10 }}>{b.name}: {b.remaining ?? '∞'}</span>)}</div>
        <div className="row"><b>Basic salary:</b> {data.salary ? money(data.salary.basic) : 'not set'}
          <input style={{ width: 130 }} type="number" min="0" placeholder="New basic" value={basic} onChange={(e) => setBasic(e.target.value)} />
          <button className="btn sm" disabled={basic === ''} onClick={saveSalary}>Save salary</button></div>
        <div><b>Recent leave:</b>{data.recent_leaves.length ? data.recent_leaves.map((l) => <div key={l.id}>{l.leave_type} {l.start_date} → {l.end_date} <Badge>{l.status}</Badge></div>) : <span className="muted"> none</span>}</div>
      </div>}
    </Modal>
  );
}

function ImportModal({ onClose }) {
  const [csv, setCsv] = useState(''); const [res, setRes] = useState(null); const [err, setErr] = useState(''); const [secrets, setSecrets] = useState(null);
  const run = async (dryRun) => { setErr(''); try { const r = await api.post('/employees/import', { csv, dryRun }); setRes(r); if (!dryRun) setSecrets(r.logins); } catch (e) { setErr(e.message); } };
  return (
    <Modal title="Import employees (CSV)" onClose={onClose}>
      <p className="muted small">Header: <code>full_name,email,phone,address,department,designation,join_date,basic_salary</code>. Departments/designations must already exist. Always run the dry-run first.</p>
      <input type="file" accept=".csv,text/csv" onChange={async (e) => { const t = await e.target.files[0]?.text(); setCsv(t || ''); setRes(null); }} />
      <textarea rows={5} placeholder="…or paste CSV here" value={csv} onChange={(e) => { setCsv(e.target.value); setRes(null); }} style={{ marginTop: 8 }} />
      <ErrorBox error={err} />
      {res && <div className="alert info">{res.dryRun ? `Dry run: ${res.valid} valid, ${res.invalid.length} invalid of ${res.total}` : `Imported ${res.imported}, skipped ${res.skipped.length}`}
        {res.invalid?.concat(res.skipped || []).slice(0, 10).map((r, i) => <div key={i}>Row {r.row}: {r.errors.join('; ')}</div>)}</div>}
      {secrets && <><b>Temporary passwords (shown once):</b><pre className="secret" style={{ fontSize: '.8rem' }}>{secrets.map((s) => `${s.email}  ${s.temp_password}`).join('\n')}</pre></>}
      <div className="row end"><button className="btn" disabled={!csv} onClick={() => run(true)}>Dry-run validate</button>
        <button className="btn primary" disabled={!csv || !res?.dryRun || res.valid === 0} onClick={() => run(false)}>Import valid rows</button></div>
    </Modal>
  );
}
