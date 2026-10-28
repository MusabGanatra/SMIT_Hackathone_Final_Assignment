import { useEffect, useState, useCallback } from 'react';
import { Routes, Route, Navigate, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { api, getToken, setToken, setUnauthorizedHandler } from './api.js';
import { Loading, useLoad } from './ui.jsx';
import { AuthCtx, useAuth } from './auth.js';
import { Setup, Login, ChangePassword } from './pages/AuthPages.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Employees from './pages/Employees.jsx';
import Attendance from './pages/Attendance.jsx';
import Leave from './pages/Leave.jsx';
import Payroll from './pages/Payroll.jsx';
import Organization from './pages/Organization.jsx';
import { Announcements, AuditLog, Notifications } from './pages/Comms.jsx';
import Profile from './pages/Profile.jsx';
import AIChat from './pages/AIChat.jsx';


const NAV = {
  admin: [['/', 'Dashboard'], ['/employees', 'Employees'], ['/attendance', 'Attendance'], ['/leave', 'Leave'], ['/payroll', 'Payroll'], ['/organization', 'Organization'], ['/announcements', 'Announcements'], ['/audit', 'Audit log']],
  hr: [['/', 'Dashboard'], ['/employees', 'Employees'], ['/attendance', 'Attendance'], ['/leave', 'Leave'], ['/payroll', 'Payroll'], ['/announcements', 'Announcements']],
  employee: [['/', 'Dashboard'], ['/attendance', 'My attendance'], ['/leave', 'My leave'], ['/payroll', 'My payslips'], ['/profile', 'My profile'], ['/announcements', 'Announcements']],
};

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const nav = useNavigate();

  const logout = useCallback(() => { setToken(null); setUser(null); nav('/login'); }, [nav]);
  useEffect(() => setUnauthorizedHandler(logout), [logout]);

  useEffect(() => {
    (async () => {
      try {
        const s = await api.get('/setup/status');
        setNeedsSetup(s.needsSetup);
        if (!s.needsSetup && getToken()) setUser((await api.get('/auth/me')).user);
      } catch { setToken(null); }
      setReady(true);
    })();
  }, []);

  if (!ready) return <Loading />;
  const ctx = { user, setUser, logout, setNeedsSetup };
  return (
    <AuthCtx.Provider value={ctx}>
      <Routes>
        <Route path="/setup" element={needsSetup ? <Setup /> : <Navigate to="/login" />} />
        <Route path="/login" element={needsSetup ? <Navigate to="/setup" /> : user ? <Navigate to="/" /> : <Login />} />
        <Route path="/*" element={needsSetup ? <Navigate to="/setup" /> : !user ? <Navigate to="/login" /> : user.must_change_password ? <ChangePassword forced /> : <Shell />} />
      </Routes>
    </AuthCtx.Provider>
  );
}

function Shell() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const { data: notes, reload } = useLoad(() => api.get('/comms/notifications'), [loc.pathname]);
  const items = NAV[user.role];
  return (
    <div className="layout">
      <nav className={'sidebar' + (open ? ' open' : '')} aria-label="Main">
        <div className="brand">HCM Lite</div>
        {items.map(([to, label]) => <NavLink key={to} to={to} end={to === '/'}>{label}</NavLink>)}
        <div className="spacer" />
        <NavLink to="/notifications">Notifications{notes?.unread ? ` (${notes.unread})` : ''}</NavLink>
        <NavLink to="/password">Change password</NavLink>
        <a href="#logout" onClick={(e) => { e.preventDefault(); logout(); }}>Log out</a>
      </nav>
      <div className="main">
        <header className="topbar">
          <button className="btn menu-btn" onClick={() => setOpen(!open)} aria-label="Toggle menu">☰</button>
          <div className="grow muted">{user.name || user.email} · <b style={{ textTransform: 'capitalize' }}>{user.role}</b></div>
        </header>
        <main className="content">
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="employees" element={user.role === 'employee' ? <Navigate to="/" /> : <Employees />} />
            <Route path="attendance" element={<Attendance />} />
            <Route path="leave" element={<Leave />} />
            <Route path="payroll" element={<Payroll />} />
            <Route path="organization" element={user.role === 'admin' ? <Organization /> : <Navigate to="/" />} />
            <Route path="audit" element={user.role === 'admin' ? <AuditLog /> : <Navigate to="/" />} />
            <Route path="announcements" element={<Announcements />} />
            <Route path="notifications" element={<Notifications onChange={reload} />} />
            <Route path="profile" element={user.role === 'employee' ? <Profile /> : <Navigate to="/" />} />
            <Route path="password" element={<ChangePassword />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
      <AIChat />
    </div>
  );
}
