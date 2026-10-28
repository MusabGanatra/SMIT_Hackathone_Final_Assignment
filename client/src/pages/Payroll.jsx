import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.js';
import { Card, Confirm, ErrorBox, Loading, Empty, Badge, useLoad, useToast, money } from '../ui.jsx';

export default function Payroll() {
  const { user } = useAuth();
  return user.role === 'employee' ? <MyPayslips /> : <PayrollAdmin isAdmin={user.role === 'admin'} />;
}

function MyPayslips() {
  const { data, error, loading } = useLoad(() => api.get('/payroll/payslips/mine')); const toast = useToast();
  return (
    <div className="col"><h1>My payslips</h1><ErrorBox error={error} />
      <Card>{loading ? <Loading /> : !data?.length ? <Empty>No payslips yet. They appear here after Admin finalizes payroll.</Empty> : <div className="table-wrap"><table><thead><tr><th>Month</th><th>Gross</th><th>Deductions</th><th>Tax</th><th>Net</th><th /></tr></thead><tbody>
        {data.map((p) => <tr key={p.id}><td>{p.month}</td><td>{money(p.gross)}</td><td>{money(p.deductions)}</td><td>{money(p.tax)}</td><td><b>{money(p.net)}</b></td>
          <td><button className="btn sm" onClick={() => api.download(`/payroll/payslips/${p.id}/pdf`, `payslip-${p.month}.pdf`).catch((e) => toast.err(e.message))}>Download PDF</button></td></tr>)}</tbody></table></div>}</Card>{toast.node}</div>
  );
}

function PayrollAdmin({ isAdmin }) {
  const runs = useLoad(() => api.get('/payroll/runs'));
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)); const [open, setOpen] = useState(null); const [fin, setFin] = useState(null); const toast = useToast();
  const detail = useLoad(() => (open ? api.get('/payroll/runs/' + open) : Promise.resolve(null)), [open]);
  const gen = async () => { try { const r = await api.post('/payroll/runs', { month }); toast.ok(`Draft ready: ${r.payslips} payslip(s)`); runs.reload(); setOpen(r.run.id); detail.reload(); } catch (e) { toast.err(e.message); } };
  return (
    <div className="col"><h1>Payroll</h1>
      <Card title="Generate monthly draft" actions={<><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 160 }} /><button className="btn primary" onClick={gen}>Generate / refresh draft</button></>}>
        <p className="muted small">Only employees with a salary structure are included. Finalized months are locked. {isAdmin ? 'You can finalize drafts.' : 'Only Admin can finalize.'}</p></Card>
      <ErrorBox error={runs.error} />
      <Card title="Payroll runs">{runs.loading && !runs.data ? <Loading /> : !runs.data?.length ? <Empty>No payroll runs yet.</Empty> : <div className="table-wrap"><table><thead><tr><th>Month</th><th>Status</th><th>Payslips</th><th>Total net</th><th /></tr></thead><tbody>
        {runs.data.map((r) => <tr key={r.id}><td>{r.month}</td><td><Badge>{r.status}</Badge></td><td>{r.payslips}</td><td>{money(r.total_net)}</td>
          <td className="row"><button className="btn sm" onClick={() => setOpen(r.id)}>View</button>{isAdmin && r.status === 'draft' && <button className="btn sm danger" onClick={() => setFin(r)}>Finalize</button>}</td></tr>)}</tbody></table></div>}</Card>
      {open && <Card title="Payslips" actions={<button className="btn sm" onClick={() => setOpen(null)}>Close</button>}>
        {!detail.data ? <Loading /> : <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Basic</th><th>HRA</th><th>Medical</th><th>Gross</th><th>Absent</th><th>Unpaid</th><th>Half</th><th>Deductions</th><th>Tax</th><th>Net</th><th /></tr></thead><tbody>
          {detail.data.payslips.map((p) => <tr key={p.id}><td>{p.full_name}</td><td>{money(p.basic)}</td><td>{money(p.hra)}</td><td>{money(p.medical)}</td><td>{money(p.gross)}</td><td>{p.absent_days}</td><td>{p.unpaid_days}</td><td>{p.half_days}</td><td>{money(p.deductions)}</td><td>{money(p.tax)}</td><td><b>{money(p.net)}</b></td>
            <td><button className="btn sm" onClick={() => api.download(`/payroll/payslips/${p.id}/pdf`, `payslip-${p.emp_code}.pdf`).catch((e) => toast.err(e.message))}>PDF</button></td></tr>)}</tbody></table></div>}</Card>}
      {fin && <Confirm title="Finalize payroll" yesLabel="Finalize & lock" message={`Finalize ${fin.month}? This locks the run permanently and notifies employees that payslips are ready.`} onNo={() => setFin(null)}
        onYes={async () => { try { await api.post(`/payroll/runs/${fin.id}/finalize`); toast.ok('Payroll finalized and locked'); runs.reload(); detail.reload(); } catch (e) { toast.err(e.message); } setFin(null); }} />}
      {toast.node}
    </div>
  );
}
