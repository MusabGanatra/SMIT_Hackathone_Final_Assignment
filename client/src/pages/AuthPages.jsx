import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../api.js';
import { Card, Field, ErrorBox, useToast } from '../ui.jsx';
import { useAuth } from '../auth.js';

export function Setup() {
  const { setNeedsSetup } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ companyName: '', name: '', email: '', password: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api.post('/setup', f); setNeedsSetup(false); nav('/login'); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="auth"><Card title="Welcome to HCM Lite - first-run setup">
      <p className="muted">Create your company and the first Admin account.</p><ErrorBox error={err} />
      <form className="col" onSubmit={submit}>
        <Field label="Company name"><input required value={f.companyName} onChange={set('companyName')} /></Field>
        <Field label="Admin full name"><input required value={f.name} onChange={set('name')} /></Field>
        <Field label="Admin email"><input required type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Password" hint="At least 8 characters"><input required type="password" minLength={8} value={f.password} onChange={set('password')} /></Field>
        <button className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create company'}</button>
      </form></Card></div>
  );
}

export function Login() {
  const { setUser } = useAuth();
  const [f, setF] = useState({ email: '', password: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api.post('/auth/login', f); setToken(r.token); setUser(r.user); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="auth"><Card title="Sign in to HCM Lite"><ErrorBox error={err} />
      <form className="col" onSubmit={submit}>
        <Field label="Email"><input type="email" required autoComplete="username" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Password"><input type="password" required autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form></Card></div>
  );
}

export function ChangePassword({ forced }) {
  const { user, setUser, logout } = useAuth();
  const [f, setF] = useState({ current_password: '', new_password: '', confirm: '' });
  const [err, setErr] = useState(''); const toast = useToast();
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (f.new_password !== f.confirm) return setErr('New passwords do not match');
    try {
      await api.post('/auth/change-password', { current_password: f.current_password, new_password: f.new_password });
      setUser({ ...user, must_change_password: false }); setF({ current_password: '', new_password: '', confirm: '' }); toast.ok('Password changed');
    } catch (x) { setErr(x.message); }
  };
  const box = (
    <Card title={forced ? 'Set a new password to continue' : 'Change password'}>
      {forced && <div className="alert info">You are using a temporary password. Please choose your own.</div>}
      <ErrorBox error={err} />
      <form className="col" onSubmit={submit}>
        <Field label="Current password"><input type="password" required value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} /></Field>
        <Field label="New password" hint="At least 8 characters"><input type="password" required minLength={8} value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} /></Field>
        <Field label="Confirm new password"><input type="password" required value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
        <div className="row"><button className="btn primary">Update password</button>{forced && <button type="button" className="btn" onClick={logout}>Log out</button>}</div>
      </form>{toast.node}
    </Card>
  );
  return forced ? <div className="auth">{box}</div> : <div style={{ maxWidth: 460 }}>{box}</div>;
}
