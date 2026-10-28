import { useEffect, useState, useCallback } from 'react';

export function useLoad(fn, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    setLoading(true); setError('');
    return fn().then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

export const Card = ({ title, actions, children, className = '' }) => (
  <section className={'card ' + className}>
    {(title || actions) && <div className="card-head"><h3>{title}</h3><div className="row">{actions}</div></div>}
    {children}
  </section>
);
export const Stat = ({ label, value, sub }) => (
  <div className="card stat"><div className="muted">{label}</div><div className="stat-value">{value ?? '-'}</div>{sub && <div className="muted small">{sub}</div>}</div>
);
export const Loading = () => <div className="muted pad" role="status">Loading…</div>;
export const ErrorBox = ({ error }) => error ? <div className="alert error" role="alert">{error}</div> : null;
export const Empty = ({ children = 'Nothing here yet.' }) => <div className="empty">{children}</div>;
export const Badge = ({ children, tone }) => <span className={'badge ' + (tone || String(children).toLowerCase().replace(/\s|_/g, '-'))}>{String(children).replace(/_/g, ' ')}</span>;

export function Field({ label, children, hint }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small className="muted">{hint}</small>}</label>;
}

export function Modal({ title, onClose, children }) {
  useEffect(() => { const h = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="card-head"><h3>{title}</h3><button className="btn ghost" onClick={onClose} aria-label="Close">✕</button></div>
        {children}
      </div>
    </div>
  );
}

export function Confirm({ title, message, onYes, onNo, yesLabel = 'Confirm' }) {
  return <Modal title={title} onClose={onNo}><p>{message}</p><div className="row end"><button className="btn ghost" onClick={onNo}>Cancel</button><button className="btn danger" onClick={onYes}>{yesLabel}</button></div></Modal>;
}

/** Shows a one-time secret (temporary password). */
export function Secret({ info, onClose }) {
  return (
    <Modal title="Temporary password" onClose={onClose}>
      <p>Share this with <b>{info.email}</b> securely. It is shown only once, and they must change it at first login.</p>
      <pre className="secret">{info.temp_password}</pre>
      <div className="row end"><button className="btn" onClick={() => navigator.clipboard?.writeText(info.temp_password)}>Copy</button><button className="btn primary" onClick={onClose}>Done</button></div>
    </Modal>
  );
}

export function useToast() {
  const [msg, setMsg] = useState(null);
  useEffect(() => { if (msg) { const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t); } }, [msg]);
  const node = msg ? <div className={'toast ' + msg.type} role="status">{msg.text}</div> : null;
  return { ok: (text) => setMsg({ type: 'ok', text }), err: (text) => setMsg({ type: 'err', text }), node };
}

export const fmtTime = (ts) => ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';
export const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString() : '-';
export const money = (n) => Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
export const today = () => new Date().toISOString().slice(0, 10);
