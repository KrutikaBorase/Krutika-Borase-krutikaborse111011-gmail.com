import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

async function api(path, { method = 'GET', body, token, headers = {} } = {}) {
  const options = {
    method,
    credentials: 'same-origin',
    headers: { ...headers },
  };

  if (token) options.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    options.body = JSON.stringify(body);
    options.headers['content-type'] = 'application/json';
  }

  const res = await fetch(`/v1${path}`, options);
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const message = parsed?.error?.message ?? `request failed (${res.status})`;
    throw new Error(message);
  }

  return parsed;
}

function App() {
  const [token, setToken] = useState(null);
  const [session, setSession] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [activeOrgId, setActiveOrgId] = useState('');
  const [orgTheme, setOrgTheme] = useState('cobalt');
  const [currentView, setCurrentView] = useState('devices');
  const [devices, setDevices] = useState([]);
  const [members, setMembers] = useState([]);
  const [grants, setGrants] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [audit, setAudit] = useState([]);
  const [orgPermissions, setOrgPermissions] = useState({});
  const [loginForm, setLoginForm] = useState({ email: 'dana@example.test', password: 'demo1234' });
  const [error, setError] = useState('');
  const [grantForm, setGrantForm] = useState({ open: false, userId: '', deviceId: '', effect: 'allow', permissionKeys: ['device:terminal'] });

  const activeOrg = useMemo(() => orgs.find((org) => org.id === activeOrgId) ?? null, [activeOrgId, orgs]);

  const loadOrgData = async (orgId) => {
    const [org, deviceData, membersData, grantsData, sessionsData, auditData] = await Promise.all([
      api(`/orgs/${orgId}`, { token }),
      api(`/orgs/${orgId}/devices`, { token }),
      api(`/orgs/${orgId}/members`, { token }),
      api(`/orgs/${orgId}/grants`, { token }),
      api(`/orgs/${orgId}/sessions`, { token }),
      api(`/orgs/${orgId}/audit?limit=25`, { token }),
    ]);

    setActiveOrgId(orgId);
    setOrgTheme(org.theme ?? 'cobalt');
    setOrgPermissions(org.permissions ?? {});
    setDevices(deviceData.devices ?? []);
    setMembers(membersData.members ?? []);
    setGrants(grantsData.grants ?? []);
    setSessions(sessionsData.sessions ?? []);
    setAudit(auditData.events ?? []);
  };

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const data = await api('/auth/refresh', { method: 'POST' });
        setToken(data.token);
        setSession({ user: data.user, role: data.role, orgId: data.orgId });
        setOrgs(data.orgs ?? []);
        if (data.orgId) {
          await loadOrgData(data.orgId);
        }
      } catch {
        setSession(null);
      }
    };

    bootstrap().catch(() => setSession(null));
  }, []);

  const handleLogin = async (event) => {
    event.preventDefault();
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        body: {
          email: loginForm.email,
          password: loginForm.password,
        },
      });
      setToken(data.token);
      setSession({ user: data.user, role: data.role, orgId: data.orgId });
      setOrgs(data.orgs ?? []);
      setError('');
      await loadOrgData(data.orgId);
    } catch (err) {
      setError(err.message);
    }
  };

  const switchOrg = async (orgId) => {
    if (!token) return;
    try {
      const switched = await api('/auth/token', {
        method: 'POST',
        token,
        body: { orgId },
      });
      setToken(switched.token);
      setSession((prev) => ({ ...prev, role: switched.role, orgId: switched.orgId }));
      await loadOrgData(switched.orgId);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleGrantCreate = async (event) => {
    event.preventDefault();
    if (!token || !activeOrgId) return;
    try {
      const payload = await api(`/orgs/${activeOrgId}/grants`, {
        method: 'POST',
        token,
        body: {
          userId: grantForm.userId,
          effect: grantForm.effect,
          deviceId: grantForm.deviceId || null,
          permissions: grantForm.permissionKeys,
        },
      });
      setGrantForm({ open: false, userId: '', deviceId: '', effect: 'allow', permissionKeys: ['device:terminal'] });
      const updated = await api(`/orgs/${activeOrgId}/grants`, { token });
      setGrants(updated.grants ?? []);
      setError('');
      await loadOrgData(activeOrgId);
      if (payload.id) setCurrentView('grants');
    } catch (err) {
      setError(err.message);
    }
  };

  const can = (permission) => orgPermissions[permission]?.effect === 'allow';
  const navAllowed = {
    devices: can('device:list') || can('device:view'),
    people: can('user:read'),
    grants: can('grant:create') || can('grant:revoke') || can('user:read') || can('audit:read'),
    sessions: can('session:view') || can('session:start'),
    audit: can('audit:read'),
    admin: can('org:update') || can('org:delete'),
  };

  if (!session) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0f172a', color: '#e2e8f0', fontFamily: 'Inter, ui-sans-serif, system-ui' }}>
        <section style={{ width: 360, background: '#111827', border: '1px solid #334155', borderRadius: 16, padding: 24 }}>
          <h1 style={{ margin: '0 0 12px', fontSize: 28 }}>RemoteOps</h1>
          <form onSubmit={handleLogin}>
            <label style={{ display: 'block', marginBottom: 8 }}>
              <span>Email</span>
              <input data-testid="login-email" value={loginForm.email} onChange={(e) => setLoginForm((prev) => ({ ...prev, email: e.target.value }))} style={{ width: '100%', marginTop: 6, padding: 10, borderRadius: 8, border: '1px solid #475569', background: '#0f172a', color: '#f8fafc' }} />
            </label>
            <label style={{ display: 'block', marginBottom: 12 }}>
              <span>Password</span>
              <input data-testid="login-password" type="password" value={loginForm.password} onChange={(e) => setLoginForm((prev) => ({ ...prev, password: e.target.value }))} style={{ width: '100%', marginTop: 6, padding: 10, borderRadius: 8, border: '1px solid #475569', background: '#0f172a', color: '#f8fafc' }} />
            </label>
            {error ? <div style={{ color: '#fca5a5', marginBottom: 12 }}>{error}</div> : null}
            <button data-testid="login-submit" type="submit" style={{ width: '100%', padding: 10, borderRadius: 8, border: 'none', background: '#38bdf8', color: '#082f49', fontWeight: 600 }}>Sign in</button>
          </form>
        </section>
      </main>
    );
  }

  const shellStyle = {
    minHeight: '100vh',
    background: orgTheme === 'amber' ? '#fff7ed' : orgTheme === 'moss' ? '#ecfdf5' : orgTheme === 'plum' ? '#faf5ff' : orgTheme === 'rust' ? '#fff7ed' : orgTheme === 'teal' ? '#ecfeff' : '#eef6ff',
    color: '#111827',
    fontFamily: 'Inter, ui-sans-serif, system-ui',
    padding: 24,
  };

  return (
    <main data-testid="app-shell" data-org-id={activeOrgId} data-org-theme={orgTheme} style={shellStyle}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.7 }}>RemoteOps</div>
          <h1 style={{ margin: 0 }}>{activeOrg?.name ?? 'RemoteOps'}</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span data-testid="active-role" style={{ padding: '6px 10px', borderRadius: 999, background: '#dbeafe', fontWeight: 700 }}>{session.role}</span>
          <button onClick={() => { setToken(null); setSession(null); setError(''); }} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff' }}>Sign out</button>
        </div>
      </header>

      <section style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        {orgs.map((org) => (
          <button
            key={org.id}
            data-testid="org-option"
            data-org-id={org.id}
            onClick={() => switchOrg(org.id)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: activeOrgId === org.id ? '2px solid #0f172a' : '1px solid #cbd5e1',
              background: activeOrgId === org.id ? '#e2e8f0' : '#fff',
              fontWeight: 600,
            }}
          >
            {org.name}
          </button>
        ))}
      </section>

      <nav style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        {navAllowed.devices ? (
          <button data-testid="nav-devices" onClick={() => setCurrentView('devices')} style={{ padding: '8px 12px', borderRadius: 8, background: currentView === 'devices' ? '#1d4ed8' : '#e2e8f0', color: currentView === 'devices' ? '#fff' : '#0f172a', border: 'none' }}>Devices</button>
        ) : null}
        {navAllowed.people ? (
          <button data-testid="nav-people" onClick={() => setCurrentView('people')} style={{ padding: '8px 12px', borderRadius: 8, background: currentView === 'people' ? '#1d4ed8' : '#e2e8f0', color: currentView === 'people' ? '#fff' : '#0f172a', border: 'none' }}>People</button>
        ) : null}
        {navAllowed.grants ? (
          <button data-testid="nav-grants" onClick={() => setCurrentView('grants')} style={{ padding: '8px 12px', borderRadius: 8, background: currentView === 'grants' ? '#1d4ed8' : '#e2e8f0', color: currentView === 'grants' ? '#fff' : '#0f172a', border: 'none' }}>Grants</button>
        ) : null}
        {navAllowed.sessions ? (
          <button data-testid="nav-sessions" onClick={() => setCurrentView('sessions')} style={{ padding: '8px 12px', borderRadius: 8, background: currentView === 'sessions' ? '#1d4ed8' : '#e2e8f0', color: currentView === 'sessions' ? '#fff' : '#0f172a', border: 'none' }}>Sessions</button>
        ) : null}
        {navAllowed.audit ? (
          <button data-testid="nav-audit" data-permission="audit:read" data-state="unlocked" onClick={() => setCurrentView('audit')} style={{ padding: '8px 12px', borderRadius: 8, background: currentView === 'audit' ? '#1d4ed8' : '#e2e8f0', color: currentView === 'audit' ? '#fff' : '#0f172a', border: 'none' }}>Audit</button>
        ) : null}
        {navAllowed.admin ? (
          <button data-testid="nav-admin" onClick={() => setCurrentView('admin')} style={{ padding: '8px 12px', borderRadius: 8, background: currentView === 'admin' ? '#1d4ed8' : '#e2e8f0', color: currentView === 'admin' ? '#fff' : '#0f172a', border: 'none' }}>Admin</button>
        ) : null}
      </nav>

      {error ? <div style={{ marginBottom: 18, color: '#b91c1c' }}>{error}</div> : null}

      {currentView === 'devices' && (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: 'rgba(255,255,255,0.7)', borderRadius: 12 }}>
          <thead>
            <tr><th style={{ textAlign: 'left', padding: 10 }}>Device</th><th style={{ textAlign: 'left', padding: 10 }}>Type</th><th style={{ textAlign: 'left', padding: 10 }}>Actions</th></tr>
          </thead>
          <tbody>
            {devices.map((device) => (
              <tr key={device.id} data-testid="device-row" data-device-id={device.id}>
                <td style={{ padding: 10 }}>{device.name}</td>
                <td style={{ padding: 10 }}>{device.kind}</td>
                <td style={{ padding: 10 }}>
                  {[
                    'device:view',
                    'device:control',
                    'device:terminal',
                    'device:file_transfer',
                    'device:update',
                  ].filter((permission) => device.permissions[permission]?.effect === 'allow').map((permission) => (
                    <button key={permission} data-permission={permission} data-state="unlocked" style={{ marginRight: 6, padding: '4px 8px', borderRadius: 6, border: '1px solid #93c5fd', background: '#eff6ff' }}>
                      {permission.split(':')[1]}
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {currentView === 'people' && (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: 'rgba(255,255,255,0.7)' }}>
          <thead>
            <tr><th style={{ textAlign: 'left', padding: 10 }}>Name</th><th style={{ textAlign: 'left', padding: 10 }}>Email</th><th style={{ textAlign: 'left', padding: 10 }}>Role</th></tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.userId} data-testid="user-row" data-user-id={member.userId}>
                <td style={{ padding: 10 }}>{member.name}</td>
                <td style={{ padding: 10 }}>{member.email}</td>
                <td style={{ padding: 10 }}>{member.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {currentView === 'grants' && (
        <div>
          {can('grant:create') ? (
            <button data-testid="new-grant" onClick={() => setGrantForm((prev) => ({ ...prev, open: !prev.open }))} style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, background: '#0f172a', color: '#fff', border: 'none' }}>
              New grant
            </button>
          ) : null}

          {grantForm.open ? (
            <form onSubmit={handleGrantCreate} style={{ background: 'rgba(255,255,255,0.8)', padding: 12, borderRadius: 12, marginBottom: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                <label>
                  <div>User</div>
                  <select data-testid="grant-user" value={grantForm.userId} onChange={(e) => setGrantForm((prev) => ({ ...prev, userId: e.target.value }))} style={{ width: '100%', padding: 8 }}>
                    <option value="">Select user</option>
                    {members.map((member) => (
                      <option key={member.userId} value={member.userId}>{member.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <div>Device</div>
                  <select data-testid="grant-device" value={grantForm.deviceId} onChange={(e) => setGrantForm((prev) => ({ ...prev, deviceId: e.target.value }))} style={{ width: '100%', padding: 8 }}>
                    <option value="">Org-wide</option>
                    {devices.map((device) => (
                      <option key={device.id} value={device.id}>{device.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <div>Effect</div>
                  <select data-testid="grant-effect" value={grantForm.effect} onChange={(e) => setGrantForm((prev) => ({ ...prev, effect: e.target.value }))} style={{ width: '100%', padding: 8 }}>
                    <option value="allow">allow</option>
                    <option value="deny">deny</option>
                  </select>
                </label>
              </div>

              <div style={{ marginTop: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {['device:control', 'device:terminal', 'device:view', 'session:start', 'audit:read'].map((key) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" data-permission-key={key} checked={grantForm.permissionKeys.includes(key)} onChange={(e) => setGrantForm((prev) => ({
                      ...prev,
                      permissionKeys: e.target.checked ? [...prev.permissionKeys, key] : prev.permissionKeys.filter((value) => value !== key),
                    }))} />
                    {key}
                  </label>
                ))}
              </div>

              <button data-testid="grant-submit" type="submit" style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: '#22c55e', color: '#052e16', border: 'none' }}>Create grant</button>
            </form>
          ) : null}

          <table style={{ width: '100%', borderCollapse: 'collapse', background: 'rgba(255,255,255,0.7)' }}>
            <thead>
              <tr><th style={{ textAlign: 'left', padding: 10 }}>User</th><th style={{ textAlign: 'left', padding: 10 }}>Permission</th><th style={{ textAlign: 'left', padding: 10 }}>Effect</th><th style={{ textAlign: 'left', padding: 10 }}>Scope</th></tr>
            </thead>
            <tbody>
              {grants.map((grant) => (
                <tr key={grant.id} data-testid="grant-row" data-effect={grant.effect}>
                  <td style={{ padding: 10 }}>{grant.userName || grant.userId}</td>
                  <td style={{ padding: 10 }}>{grant.permissions.join(', ')}</td>
                  <td style={{ padding: 10 }}>{grant.effect}</td>
                  <td style={{ padding: 10 }}>{grant.deviceName || 'org-wide'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {currentView === 'sessions' && (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: 'rgba(255,255,255,0.7)' }}>
          <thead>
            <tr><th style={{ textAlign: 'left', padding: 10 }}>Device</th><th style={{ textAlign: 'left', padding: 10 }}>Mode</th><th style={{ textAlign: 'left', padding: 10 }}>State</th></tr>
          </thead>
          <tbody>
            {sessions.map((sessionEntry) => (
              <tr key={sessionEntry.id}>
                <td style={{ padding: 10 }}>{sessionEntry.deviceName}</td>
                <td style={{ padding: 10 }}>{sessionEntry.mode}</td>
                <td style={{ padding: 10 }}>{sessionEntry.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {currentView === 'audit' && (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: 'rgba(255,255,255,0.7)' }}>
          <thead>
            <tr><th style={{ textAlign: 'left', padding: 10 }}>Action</th><th style={{ textAlign: 'left', padding: 10 }}>Result</th><th style={{ textAlign: 'left', padding: 10 }}>Reason</th></tr>
          </thead>
          <tbody>
            {audit.map((event) => (
              <tr key={event.id}>
                <td style={{ padding: 10 }}>{event.action}</td>
                <td style={{ padding: 10 }}>{event.result}</td>
                <td style={{ padding: 10 }}>{event.reason_code ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {currentView === 'admin' && (
        <section style={{ background: 'rgba(255,255,255,0.8)', borderRadius: 12, padding: 16 }}>
          {can('org:update') ? <button data-testid="rename-org" style={{ marginRight: 12, padding: '8px 12px' }}>Rename org</button> : null}
          {can('org:delete') ? <button data-testid="delete-org" style={{ padding: '8px 12px' }}>Delete org</button> : null}
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
