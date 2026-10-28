import { useState } from 'react';
import { api } from '../api.js';
import { Card, Field, ErrorBox, Loading, useLoad, useToast } from '../ui.jsx';

export default function Profile() {
  const { data, error } = useLoad(() => api.get('/employees/me'));
  const [f, setF] = useState(null); const toast = useToast();
  if (data && !f) setF({ phone: data.phone || '', address: data.address || '' });
  if (!data || !f) return <><ErrorBox error={error} /><Loading /></>;
  const save = async (e) => { e.preventDefault(); try { await api.put('/employees/me', { phone: f.phone || null, address: f.address || null }); toast.ok('Profile updated'); } catch (x) { toast.err(x.message); } };
  return (
    <div className="col" style={{ maxWidth: 560 }}><h1>My profile</h1>
      <Card><div><b>{data.full_name}</b> ({data.emp_code})</div><div className="muted">{data.email} · {data.department || 'No department'} · {data.designation || 'No designation'} · joined {data.join_date}</div></Card>
      <Card title="Contact details"><form className="col" onSubmit={save}><Field label="Phone"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Address"><textarea rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <div className="row end"><button className="btn primary">Save</button></div><p className="muted small">Other details can only be changed by HR.</p></form></Card>{toast.node}</div>
  );
}
