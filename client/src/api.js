const BASE = import.meta.env.VITE_API_URL || '/api';
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };
export const getToken = () => localStorage.getItem('hcm_token');
export const setToken = (t) => (t ? localStorage.setItem('hcm_token', t) : localStorage.removeItem('hcm_token'));

async function request(method, path, body, raw = false) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && getToken()) onUnauthorized();
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `Request failed (${res.status})`);
  }
  return raw ? res : res.json();
}
export const api = {
  get: (p) => request('GET', p),
  post: (p, b = {}) => request('POST', p, b),
  put: (p, b) => request('PUT', p, b),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
  /** Authenticated file download (PDF/CSV). */
  async download(path, filename) {
    const res = await request('GET', path, null, true);
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click(); URL.revokeObjectURL(url);
  },
};
export const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString();
