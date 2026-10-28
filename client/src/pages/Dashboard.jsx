import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer, ReferenceLine } from 'recharts';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.js';
import { Card, Stat, useLoad, Loading, ErrorBox, Empty, Badge, fmtTime, money } from '../ui.jsx';

export default function Dashboard() {
  const { user } = useAuth();
  return user.role === 'employee' ? <EmployeeDash /> : <StaffDash role={user.role} />;
}

function Filters({ f, setF, depts }) {
  return (
    <div className="row">
      <label className="field"><span>From</span><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
      <label className="field"><span>To</span><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
      <label className="field"><span>Department</span>
        <select value={f.department_id} onChange={(e) => setF({ ...f, department_id: e.target.value })}>
          <option value="">All</option>{depts?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
    </div>
  );
}

function AISummary({ f }) {
  const [state, setState] = useState({ loading: false });
  const run = async () => {
    setState({ loading: true });
    try { setState({ ...(await api.post('/ai/summary', { from: f.from || undefined, to: f.to || undefined, department_id: f.department_id ? Number(f.department_id) : undefined })) }); }
    catch (e) { setState({ error: e.message }); }
  };
  return (
    <Card title="AI summary" actions={<button className="btn sm" onClick={run} disabled={state.loading}>{state.loading ? 'Thinking…' : 'Generate'}</button>}>
      <ErrorBox error={state.error} />
      {state.fallback && <div className="alert info">{state.message}</div>}
      {state.insights?.length ? <><ul>{state.insights.map((t, i) => <li key={i}>{t}</li>)}</ul><span className="tag">{state.label} · based on current filters</span></> : !state.loading && !state.error && !state.fallback && <Empty>Click Generate for 3–5 insights on the current filters.</Empty>}
    </Card>
  );
}

function StaffDash({ role }) {
  const [f, setF] = useState({ from: '', to: '', department_id: '' });
  const { data: depts } = useLoad(() => api.get('/org/departments'));
  const { data, error, loading } = useLoad(() => api.get(`/dashboard/${role}?` + qs(f)), [f.from, f.to, f.department_id, role]);
  return (
    <div className="col">
      <div className="card-head"><h1>{role === 'admin' ? 'Admin dashboard' : 'HR dashboard'}</h1><Filters f={f} setF={setF} depts={depts} /></div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : data && (role === 'admin' ? <AdminBody d={data} f={f} /> : <HrBody d={data} f={f} />)}
    </div>
  );
}

const TrendChart = ({ rows }) => rows?.length ? (
  <div style={{ height: 260 }}><ResponsiveContainer><LineChart data={rows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} /><YAxis allowDecimals={false} /><Tooltip /><Legend />
    <Line dataKey="present_total" name="Present" stroke="#16a34a" /><Line dataKey="late" name="Late" stroke="#d97706" /><Line dataKey="absent" name="Absent" stroke="#dc2626" /></LineChart></ResponsiveContainer></div>
) : <Empty>No attendance data in this range.</Empty>;

function AdminBody({ d, f }) {
  const a = d.attendance;
  return (<>
    <div className="grid g4">
      <Stat label="Headcount" value={d.headcount.total} />
      <Stat label="Attrition" value={d.attrition.rate_percent + '%'} sub={`${d.attrition.left} left in range`} />
      <Stat label="Absenteeism" value={a.absenteeism_percent + '%'} sub={`${a.absent} absences`} />
      <Stat label="Payroll cost (latest)" value={d.payroll.total_net != null ? money(d.payroll.total_net) : '-'} sub={d.payroll.month ? `${d.payroll.month} · avg gross ${money(d.payroll.avg_gross)}` : 'No payroll yet'} />
    </div>
    <div className="grid g2">
      <Card title="Attendance overview"><div className="row"><Badge>present</Badge> {a.present} <Badge>late</Badge> {a.late} <Badge>half_day</Badge> {a.half_day} <Badge>on_leave</Badge> {a.on_leave} <Badge>absent</Badge> {a.absent}</div><TrendChart rows={a.daily} /></Card>
      <Card title="Department statistics">
        {d.departments.length ? <div style={{ height: 260 }}><ResponsiveContainer><BarChart data={d.departments}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="department" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="headcount" fill="#2b5be0" name="Headcount" /></BarChart></ResponsiveContainer></div> : <Empty>Add employees to see department stats.</Empty>}
      </Card>
    </div>
    <div className="grid g2">
      <Card title="Recent audit activity" actions={<Link to="/audit">View all</Link>}>
        {d.recent_audit.length ? <div className="table-wrap"><table><tbody>{d.recent_audit.map((r) => <tr key={r.id}><td>{r.actor_email || 'system'}</td><td>{r.action}</td><td>{r.entity}</td><td className="muted">{new Date(r.created_at).toLocaleString()}</td></tr>)}</tbody></table></div> : <Empty />}
      </Card>
      <AISummary f={f} />
    </div>
  </>);
}

function HrBody({ d, f }) {
  return (<>
    <div className="grid g4">
      <Stat label="Present today" value={d.today.present} /><Stat label="Late today" value={d.today.late} />
      <Stat label="Absent today" value={d.today.absent} /><Stat label="On leave today" value={d.today.on_leave} />
      <Stat label="Pending leave approvals" value={d.pending.leave} /><Stat label="Pending corrections" value={d.pending.corrections} />
      <Stat label="Absenteeism (range)" value={d.attendance.absenteeism_percent + '%'} />
    </div>
    <div className="grid g2">
      <Card title="Attendance trend"><TrendChart rows={d.trend} /></Card>
      <Card title="Frequent late-comers">
        {d.late_comers.length ? <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Dept</th><th>Late days</th></tr></thead><tbody>{d.late_comers.map((r) => <tr key={r.employee_id}><td>{r.full_name}</td><td>{r.department || '-'}</td><td>{r.late_count}</td></tr>)}</tbody></table></div> : <Empty>No late arrivals in this range.</Empty>}
      </Card>
    </div>
    <div className="grid g2">
      <Card title="Department-wise headcount">{d.departments.length ? <div style={{ height: 240 }}><ResponsiveContainer><BarChart data={d.departments}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="department" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="headcount" fill="#2b5be0" /></BarChart></ResponsiveContainer></div> : <Empty />}</Card>
      <AISummary f={f} />
    </div>
  </>);
}

function EmployeeDash() {
  const { data: d, error, loading, reload } = useLoad(() => api.get('/dashboard/employee'));
  const { data: cal } = useLoad(() => api.get('/attendance/calendar'));
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  const act = async (p) => { setBusy(true); setMsg(''); try { await api.post(p); await reload(); } catch (e) { setMsg(e.message); } finally { setBusy(false); } };
  if (loading && !d) return <Loading />;
  if (!d) return <ErrorBox error={error} />;
  const rec = d.today.record;
  return (
    <div className="col"><h1>My dashboard</h1><ErrorBox error={msg || error} />
      <div className="grid g4">
        <Card title="Today">
          <p>{rec ? <>In <b>{fmtTime(rec.check_in)}</b>{rec.is_late && <> <Badge>late</Badge></>} · Out <b>{fmtTime(rec.check_out)}</b></> : 'Not checked in yet'}</p>
          <div className="row"><button className="btn primary" disabled={busy || !!rec} onClick={() => act('/attendance/check-in')}>Check in</button>
            <button className="btn" disabled={busy || !rec || !!rec.check_out} onClick={() => act('/attendance/check-out')}>Check out</button></div>
        </Card>
        <Stat label="Hours this week" value={`${d.week_hours} / ${d.week_target}`} sub={`${Math.round((d.week_hours / d.week_target) * 100)}% of target`} />
        <Stat label="Late arrivals this month" value={d.late_this_month} />
        <Card title="Latest payslip">{d.latest_payslip ? <><b>{d.latest_payslip.month}</b><div>Net {money(d.latest_payslip.net)}</div><Link to="/payroll">Download</Link></> : <span className="muted">None yet</span>}</Card>
      </div>
      <div className="grid g2">
        <Card title="Leave balance"><div className="table-wrap"><table><thead><tr><th>Type</th><th>Quota</th><th>Used</th><th>Pending</th><th>Left</th></tr></thead><tbody>
          {d.leave_balance.map((b) => <tr key={b.code}><td>{b.name}</td><td>{b.quota ?? '∞'}</td><td>{b.used}</td><td>{b.pending}</td><td><b>{b.remaining ?? '∞'}</b></td></tr>)}</tbody></table></div></Card>
        <Card title="This month">{cal ? <Calendar days={cal.days} /> : <Loading />}</Card>
      </div>
      <Card title="Announcements">{d.announcements.length ? d.announcements.map((a) => <div key={a.id} style={{ marginBottom: 10 }}><b>{a.title}</b><div className="muted small">{new Date(a.created_at).toLocaleDateString()}</div><div>{a.body}</div></div>) : <Empty />}</Card>
    </div>
  );
}

export function Calendar({ days }) {
  const lead = new Date(days[0].date + 'T00:00:00Z').getUTCDay();
  return (<>
    <div className="cal" aria-label="Attendance calendar">
      {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((x, i) => <b key={i} className="muted small">{x}</b>)}
      {Array.from({ length: lead }).map((_, i) => <span key={'p' + i} />)}
      {days.map((d) => <div key={d.date} className={d.status} title={`${d.date}: ${d.status.replace('_', ' ')}`}>{Number(d.date.slice(8))}<br /><span style={{ fontSize: '.62rem' }}>{d.status.replace('_', ' ')}</span></div>)}
    </div></>);
}
