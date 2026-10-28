import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

export default function AIChat() {
  const [open, setOpen] = useState(false); const [msgs, setMsgs] = useState([]); const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const end = useRef(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth' }), [msgs, open]);
  const send = async (e) => {
    e.preventDefault(); const t = text.trim(); if (!t || busy) return;
    const next = [...msgs, { role: 'user', content: t }]; setMsgs(next); setText(''); setBusy(true);
    try {
      const r = await api.post('/ai/chat', { messages: next.map(({ role, content }) => ({ role, content })) });
      setMsgs([...next, { role: 'assistant', content: r.reply, label: r.label }]);
    } catch (x) { setMsgs([...next, { role: 'assistant', content: x.message, label: 'system' }]); } finally { setBusy(false); }
  };
  if (!open) return <button className="btn primary chat-fab" onClick={() => setOpen(true)} aria-label="Open AI assistant">✨ Ask AI</button>;
  return (
    <aside className="card chat" aria-label="AI assistant">
      <div className="card-head"><h3>AI assistant</h3><button className="btn ghost" onClick={() => setOpen(false)} aria-label="Close">✕</button></div>
      <div className="chat-log" aria-live="polite">
        {!msgs.length && <div className="muted small">Ask about your leave balance, attendance, or company policy. Staff can also ask about headcount, late-comers and payroll totals. Roman Urdu works too.</div>}
        {msgs.map((m, i) => <div key={i} className={'msg ' + m.role}>{m.content}{m.label && <span className="tag">{m.label}</span>}</div>)}
        {busy && <div className="msg assistant muted">Thinking…</div>}<div ref={end} />
      </div>
      <form className="row" onSubmit={send}><input style={{ flex: 1 }} placeholder="Type a question…" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} aria-label="Message" /><button className="btn primary" disabled={busy || !text.trim()}>Send</button></form>
    </aside>
  );
}
