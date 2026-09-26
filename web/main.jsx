import React, { useEffect, useMemo, useRef, useState } from 'react';
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

function InvitePage() {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');

  const token = window.location.pathname.replace(/^\/invite\//, '');

  useEffect(() => {
    api(`/invites/${token}`)
      .then((data) => setDetail(data))
      .catch(() => setError('Invite link is invalid or expired.'));
  }, [token]);

  const submit = async (event) => {
    event.preventDefault();
    try {
      await api(`/invites/${token}/accept`, {
        method: 'POST',
        body: { name: name.trim(), password },
      });
      window.location.href = '/';
    } catch (err) {
      setError(err.message || 'Invite link is invalid or expired.');
    }
  };

  if (!detail && error) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0f172a', color: '#e2e8f0', fontFamily: 'Inter, ui-sans-serif, system-ui' }}>
        <section style={{ width: 420, background: '#111827', border: '1px solid #334155', borderRadius: 16, padding: 24 }}>
          <div data-testid="invite-error" style={{ color: '#fca5a5', fontWeight: 600 }}>{error}</div>
        </section>
      </main>
    );
  }

  if (!detail) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0f172a', color: '#e2e8f0', fontFamily: 'Inter, ui-sans-serif, system-ui' }}>
        <section style={{ width: 420, background: '#111827', border: '1px solid #334155', borderRadius: 16, padding: 24 }}>
          <div>Loading…</div>
        </section>
      </main>
    );
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0f172a', color: '#e2e8f0', fontFamily: 'Inter, ui-sans-serif, system-ui' }}>
      <section style={{ width: 420, background: '#111827', border: '1px solid #334155', borderRadius: 16, padding: 24 }}>
        <h1 style={{ marginTop: 0 }}>Accept invitation</h1>
        <div style={{ marginBottom: 12 }}>
          <div style={{ opacity: 0.7, fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Role</div>
          <div data-testid="invite-role" style={{ fontSize: 22, fontWeight: 700 }}>{detail.role}</div>
        </div>
        <form onSubmit={submit}>
          <label style={{ display: 'block', marginBottom: 10 }}>
            <span>Email</span>
            <input data-testid="invite-email" value={detail.email} readOnly style={{ width: '100%', marginTop: 6, padding: 10, borderRadius: 8, border: '1px solid #475569', background: '#0f172a', color: '#f8fafc' }} />
          </label>
          <label style={{ display: 'block', marginBottom: 10 }}>
            <span>Name</span>
            <input data-testid="invite-name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', marginTop: 6, padding: 10, borderRadius: 8, border: '1px solid #475569', background: '#0f172a', color: '#f8fafc' }} />
          </label>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span>Password</span>
            <input data-testid="invite-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: '100%', marginTop: 6, padding: 10, borderRadius: 8, border: '1px solid #475569', background: '#0f172a', color: '#f8fafc' }} />
          </label>
          {error ? <div data-testid="invite-error" style={{ color: '#fca5a5', marginBottom: 12 }}>{error}</div> : null}
          <button data-testid="invite-submit" type="submit" style={{ width: '100%', padding: 10, borderRadius: 8, border: 'none', background: '#38bdf8', color: '#082f49', fontWeight: 600 }}>Create account</button>
        </form>
      </section>
    </main>
  );
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
  const loadGeneration = useRef(0);

  const effectiveOrgId = activeOrgId || session?.orgId || '';
  const effectiveOrgTheme = orgTheme || orgs.find((org) => org.id === effectiveOrgId)?.theme || 'cobalt';
  const activeOrg = useMemo(() => orgs.find((org) => org.id === effectiveOrgId) ?? null, [effectiveOrgId, orgs]);

  const resetOrgState = () => {
    setDevices([]);
    setMembers([]);
    setGrants([]);
    setSessions([]);
    setAudit([]);
    setOrgPermissions({});
  };

  const loadOrgData = async (orgId, accessToken = token) => {
    const generation = ++loadGeneration.current;
    setActiveOrgId(orgId);
    resetOrgState();

    let org;
    try {
      org = await api(`/orgs/${orgId}`, { token: accessToken });
    } catch (err) {
      if (generation === loadGeneration.current) setError(err.message);
      return;
    }

    if (generation !== loadGeneration.current) return;
    setOrgTheme(org.theme ?? 'cobalt');
    setOrgPermissions(org.permissions ?? {});

    const fetchers = [
      ['devices', '/devices', () => api(`/orgs/${orgId}/devices`, { token: accessToken }), 'device:list'],
      ['members', '/members', () => api(`/orgs/${orgId}/members`, { token: accessToken }), 'user:read'],
      ['grants', '/grants', () => api(`/orgs/${orgId}/grants`, { token: accessToken }), 'grant:create'],
      ['sessions', '/sessions', () => api(`/orgs/${orgId}/sessions`, { token: accessToken }), 'session:view'],
      ['audit', '/audit?limit=25', () => api(`/orgs/${orgId}/audit?limit=25`, { token: accessToken }), 'audit:read'],
    ];

    for (const [key, path, loader, permission] of fetchers) {
      try {
        const data = await loader();
        if (generation !== loadGeneration.current) return;
        if (key === 'devices') setDevices(data.devices ?? []);
        if (key === 'members') setMembers(data.members ?? []);
        if (key === 'grants') setGrants(data.grants ?? []);
        if (key === 'sessions') setSessions(data.sessions ?? []);
        if (key === 'audit') setAudit(data.events ?? []);
      } catch (err) {
        if (err.message && err.message.startsWith('missing permission:')) {
          continue;
        }
        if (permission && err.message && err.message.includes(permission)) continue;
        if (path.includes('audit') && err.message && err.message.includes('missing permission')) continue;
        if (path.includes('devices') && err.message && err.message.includes('missing permission')) continue;
        if (path.includes('members') && err.message && err.message.includes('missing permission')) continue;
        if (path.includes('sessions') && err.message && err.message.includes('missing permission')) continue;
        if (path.includes('grants') && err.message && err.message.includes('missing permission')) continue;
      }
    }
  };

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const data = await api('/auth/refresh', { method: 'POST' });
        setToken(data.token);
        setSession({ user: data.user, role: data.role, orgId: data.orgId });
        setOrgs(data.orgs ?? []);
        const nextTheme = data.orgs?.find((org) => org.id === data.orgId)?.theme ?? 'cobalt';
        setActiveOrgId(data.orgId);
        setOrgTheme(nextTheme);
        if (data.orgId) {
          await loadOrgData(data.orgId, data.token);
        }
      } catch {
        setSession(null);
      }
    };

    bootstrap().catch(() => setSession(null));
  }, []);

  const handleLogin = async (event) => {
    event.preventDefault();
    setError('');

    if (!loginForm.email.trim() || !loginForm.password.trim()) {
      setError('Email and password are required.');
      return;
    }

    try {
      const data = await api('/auth/login', {
        method: 'POST',
        body: {
          email: loginForm.email.trim().toLowerCase(),
          password: loginForm.password,
        },
      });
      setToken(data.token);
      setSession({ user: data.user, role: data.role, orgId: data.orgId });
      setOrgs(data.orgs ?? []);
      const nextTheme = data.orgs?.find((org) => org.id === data.orgId)?.theme ?? 'cobalt';
      setActiveOrgId(data.orgId);
      setOrgTheme(nextTheme);
      setError('');
      await loadOrgData(data.orgId, data.token);
    } catch (err) {
      setError(err.message || 'Invalid credentials.');
    }
  };

  const switchOrg = async (orgId) => {
    if (!token) return;
    setError('');
    setActiveOrgId(orgId);
    resetOrgState();
    const nextTheme = orgs.find((entry) => entry.id === orgId)?.theme ?? 'cobalt';
    setOrgTheme(nextTheme);

    try {
      const switched = await api('/auth/token', {
        method: 'POST',
        token,
        body: { orgId },
      });
      setToken(switched.token);
      setSession((prev) => ({ ...(prev || {}), role: switched.role, orgId: switched.orgId }));
      await loadOrgData(switched.orgId, switched.token);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    if (!session || !effectiveOrgId || !token) return;
    loadOrgData(effectiveOrgId, token).catch(() => undefined);
  }, [currentView, effectiveOrgId, token]);

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
      await loadOrgData(activeOrgId, token);
      if (payload.id) setCurrentView('grants');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCreateOrg = async () => {
    const name = window.prompt('Organization name');
    if (!name || !name.trim()) return;
    try {
      const org = await api('/orgs', {
        method: 'POST',
        token,
        body: { name: name.trim() },
      });
      const switched = await api('/auth/token', {
        method: 'POST',
        token,
        body: { orgId: org.id },
      });
      setOrgs((prev) => [...prev, { id: org.id, name: org.name, theme: org.theme }]);
      setActiveOrgId(org.id);
      setOrgTheme(org.theme ?? 'cobalt');
      setToken(switched.token);
      setSession((prev) => ({ ...(prev || {}), orgId: switched.orgId, role: switched.role }));
      setCurrentView('devices');
      setError('');
    } catch (err) {
      setError(err.message || 'Could not create organization.');
    }
  };

  const handleGrantRevoke = async (grantId) => {
    if (!token || !activeOrgId) return;
    try {
      await api(`/orgs/${activeOrgId}/grants/${grantId}/revoke`, {
        method: 'POST',
        token,
      });
      await loadOrgData(activeOrgId, token);
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

  if (window.location.pathname.startsWith('/invite/')) {
    return <InvitePage />;
  }

  if (!session) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0f172a', color: '#e2e8f0', fontFamily: 'Inter, ui-sans-serif, system-ui' }}>
        <section style={{ width: 360, background: '#111827', border: '1px solid #334155', borderRadius: 16, padding: 24 }}>
          <h1 style={{ margin: '0 0 12px', fontSize: 28 }}>RemoteOps</h1>
          <form data-testid="login-form" onSubmit={handleLogin}>
            <label style={{ display: 'block', marginBottom: 8 }}>
              <span>Email</span>
              <input data-testid="login-email" value={loginForm.email} onChange={(e) => setLoginForm((prev) => ({ ...prev, email: e.target.value }))} style={{ width: '100%', marginTop: 6, padding: 10, borderRadius: 8, border: '1px solid #475569', background: '#0f172a', color: '#f8fafc' }} />
            </label>
            <label style={{ display: 'block', marginBottom: 12 }}>
              <span>Password</span>
              <input data-testid="login-password" type="password" value={loginForm.password} onChange={(e) => setLoginForm((prev) => ({ ...prev, password: e.target.value }))} style={{ width: '100%', marginTop: 6, padding: 10, borderRadius: 8, border: '1px solid #475569', background: '#0f172a', color: '#f8fafc' }} />
            </label>
            {error ? <div data-testid="login-error" style={{ color: '#fca5a5', marginBottom: 12 }}>{error}</div> : null}
            <button data-testid="login-submit" type="submit" style={{ width: '100%', padding: 10, borderRadius: 8, border: 'none', background: '#38bdf8', color: '#082f49', fontWeight: 600 }}>Sign in</button>
          </form>
        </section>
      </main>
    );
  }

  const shellStyle = {
    minHeight: '100vh',
    background: effectiveOrgTheme === 'amber' ? '#fff7ed' : effectiveOrgTheme === 'moss' ? '#ecfdf5' : effectiveOrgTheme === 'plum' ? '#faf5ff' : effectiveOrgTheme === 'rust' ? '#fff7ed' : effectiveOrgTheme === 'teal' ? '#ecfeff' : '#eef6ff',
    color: '#111827',
    fontFamily: 'Inter, ui-sans-serif, system-ui',
    padding: 24,
  };

  return (
    <main data-testid="app-shell" data-org-id={effectiveOrgId} data-org-theme={effectiveOrgTheme} style={shellStyle}>
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

      <section style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18, alignItems: 'center' }}>
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
        {session?.role === 'owner' ? (
          <button data-testid="create-org" onClick={handleCreateOrg} style={{ padding: '8px 12px', borderRadius: 8, background: '#0f172a', color: '#fff', border: 'none' }}>
            New org
          </button>
        ) : null}
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
        devices.length === 0 ? (
          <div data-testid="devices-empty" style={{ background: 'rgba(255,255,255,0.7)', borderRadius: 12, padding: 24 }}>No devices available.</div>
        ) : (
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
                    ].filter((permission) => device.permissions?.[permission]?.effect === 'allow').map((permission) => (
                      <button key={permission} data-permission={permission} data-state="unlocked" style={{ marginRight: 6, padding: '4px 8px', borderRadius: 6, border: '1px solid #93c5fd', background: '#eff6ff' }}>
                        {permission.split(':')[1]}
                      </button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
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
              <tr><th style={{ textAlign: 'left', padding: 10 }}>User</th><th style={{ textAlign: 'left', padding: 10 }}>Permission</th><th style={{ textAlign: 'left', padding: 10 }}>Effect</th><th style={{ textAlign: 'left', padding: 10 }}>Scope</th>{can('grant:revoke') ? <th style={{ textAlign: 'left', padding: 10 }}>Action</th> : null}</tr>
            </thead>
            <tbody>
              {grants.map((grant) => (
                <tr key={grant.id} data-testid="grant-row" data-effect={grant.effect}>
                  <td style={{ padding: 10 }}>{grant.userName || grant.userId}</td>
                  <td style={{ padding: 10 }}>{grant.permissions.join(', ')}</td>
                  <td style={{ padding: 10 }}>{grant.effect}</td>
                  <td style={{ padding: 10 }}>{grant.deviceName || 'org-wide'}</td>
                  {can('grant:revoke') ? (
                    <td style={{ padding: 10 }}>
                      <button data-testid="revoke-grant" onClick={() => handleGrantRevoke(grant.id)} style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fff1f2', color: '#991b1b' }}>
                        Revoke
                      </button>
                    </td>
                  ) : null}
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
