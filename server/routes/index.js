import { randomUUID } from 'node:crypto';

import {
  hashInviteToken,
  hashPassword,
  hashRefreshToken,
  issueAccessToken,
  newInviteToken,
  newRefreshToken,
  verifyPassword,
} from '../auth.js';
import { audit, auditDenials } from '../audit.js';
import { newId, nowIso } from '../db.js';
import { badRequest, conflict, forbidden, gone, lastOwner, notFound, selfRoleChange, unauthenticated } from '../http.js';
import {
  assertCan,
  assertCanStartSession,
  assertMayGrant,
  resolve,
  resolveDevices,
} from '../permissions.js';
import {
  assertCanModify,
  assertNotLastOwner,
  endActiveSessions,
  sessionExpiry,
  snapshotAuthority,
} from '../lifecycle.js';

function byOrgRow(row) {
  return {
    id: row.org_id,
    name: row.org_name,
    theme: row.theme,
    role: row.role,
  };
}

function memberSummary(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
  };
}

function authUser(db, userId) {
  return db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(userId);
}

function userMemberships(db, userId) {
  return db.prepare(`
    SELECT m.org_id, m.role, m.status, m.perm_version, o.name AS org_name, o.theme
      FROM memberships AS m
      JOIN organizations AS o ON o.id = m.org_id
     WHERE m.user_id = ? AND m.status != 'removed'
     ORDER BY o.name ASC, m.org_id ASC
  `).all(userId);
}

function withAllowedPermissions(db, userId, orgId) {
  const resolved = resolve(db, { userId, orgId, now: new Date() });
  return Object.fromEntries(
    Object.entries(resolved.permissions).filter(([, value]) => value.effect === 'allow')
      .map(([permission]) => [permission, 'allow'])
  );
}

function termToResponse(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(JSON.stringify(payload)),
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function setRefreshCookie(res, token) {
  const maxAge = 30 * 24 * 60 * 60;
  res.setHeader('Set-Cookie', `rt=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`);
}

function createIssuer(db, secret) {
  return function issueTokenFor(userId, orgId, role, permVersion) {
    return issueAccessToken({ userId, orgId, role, permVersion }, secret);
  };
}

function ensureMembership(db, userId, orgId) {
  const membership = db.prepare(`
    SELECT m.*, o.deleted_at AS organization_deleted
      FROM memberships AS m
      JOIN organizations AS o ON o.id = m.org_id
     WHERE m.org_id = ? AND m.user_id = ?
  `).get(orgId, userId);
  if (!membership || membership.organization_deleted) throw notFound();
  if (membership.status === 'removed') throw unauthenticated('membership removed');
  return membership;
}

export function registerRoutes(router, deps) {
  const { db, secret } = deps;
  const issueToken = createIssuer(db, secret);

  router.get('/v1/auth/me', (ctx, _params, res) => {
    const auth = ctx.req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return termToResponse(res, 200, { authenticated: false });
    }

    try {
      const token = auth.slice(7);
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      const user = authUser(db, claims.sub);
      const orgs = userMemberships(db, claims.sub).map(byOrgRow);
      return termToResponse(res, 200, {
        authenticated: true,
        user: user ? { id: user.id, email: user.email, name: user.name } : null,
        orgId: claims.org,
        role: claims.role,
        orgs,
      });
    } catch {
      return termToResponse(res, 200, { authenticated: false });
    }
  });

  router.post('/v1/auth/login', (ctx, _params, res) => {
    const body = ctx.body ?? {};
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const targetOrg = body.orgId ? String(body.orgId) : null;

    if (!email || !password) throw badRequest('email and password are required');

    const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw unauthenticated('invalid credentials');
    }

    const memberships = userMemberships(db, user.id);
    if (!memberships.length) throw unauthenticated('not a member of any org');

    const membership = targetOrg
      ? memberships.find((row) => row.org_id === targetOrg) ?? null
      : memberships[0];

    if (!membership) throw notFound();

    const refreshToken = newRefreshToken();
    const familyId = randomUUID();
    db.prepare(`
      INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(newId('rt'), user.id, hashRefreshToken(refreshToken), familyId, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString());

    const token = issueToken(user.id, membership.org_id, membership.role, membership.perm_version);
    setRefreshCookie(res, refreshToken);
    return termToResponse(res, 200, {
      token,
      orgId: membership.org_id,
      role: membership.role,
      user: { id: user.id, email: user.email, name: user.name },
      orgs: memberships.map(byOrgRow),
    });
  });

  router.post('/v1/auth/token', (ctx, _params, res) => {
    const orgId = String(ctx.body.orgId ?? ctx.orgId ?? ctx.claims?.org ?? '');
    const target = ensureMembership(db, ctx.userId, orgId);
    const token = issueToken(ctx.userId, target.org_id, target.role, target.perm_version);
    return termToResponse(res, 200, {
      token,
      orgId: target.org_id,
      role: target.role,
    });
  });

  router.post('/v1/auth/refresh', (ctx, _params, res) => {
    const cookie = String(ctx.req.headers.cookie ?? '');
    const match = /(?:^|; )rt=([^;]+)/.exec(cookie);
    if (!match) throw unauthenticated('missing refresh token');
    const raw = decodeURIComponent(match[1]);

    const row = db.prepare(`
      SELECT * FROM refresh_tokens
       WHERE token_hash = ?
         AND revoked_at IS NULL
         AND expires_at > ?
       ORDER BY created_at DESC
       LIMIT 1
    `).get(hashRefreshToken(raw), nowIso());
    if (!row) throw unauthenticated('refresh token rejected');

    const user = authUser(db, row.user_id);
    const memberships = userMemberships(db, row.user_id);
    if (!user || !memberships.length) throw unauthenticated('no memberships available');
    const membership = memberships[0];
    const token = issueToken(user.id, membership.org_id, membership.role, membership.perm_version);
    setRefreshCookie(res, raw);
    return termToResponse(res, 200, {
      token,
      orgId: membership.org_id,
      role: membership.role,
      user: { id: user.id, email: user.email, name: user.name },
      orgs: memberships.map(byOrgRow),
    });
  });

  router.get('/v1/orgs/:org', (ctx, params, res) => {
    const orgId = params.org;
    const membership = ensureMembership(db, ctx.userId, orgId);
    const resolved = resolve(db, { userId: ctx.userId, orgId, now: new Date() });
    const org = db.prepare('SELECT id, name, theme FROM organizations WHERE id = ?').get(orgId);
    return termToResponse(res, 200, {
      id: org.id,
      orgId: org.id,
      name: org.name,
      theme: org.theme,
      role: membership.role,
      permissions: resolved.permissions,
    });
  });

  router.get('/v1/orgs/:org/devices', (ctx, params, res) => {
    assertCan(db, ctx, 'device:list', null);
    const deviceIds = db.prepare('SELECT id FROM devices WHERE org_id = ? AND deleted_at IS NULL ORDER BY name').all(params.org).map((row) => row.id);
    const resolved = resolveDevices(db, { userId: ctx.userId, orgId: params.org, deviceIds, now: new Date() });
    const devices = deviceIds.map((id) => {
      const row = db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
      const permissions = resolved.byDevice[id] ?? {};
      if (permissions['device:view']?.effect !== 'allow') return null;
      return {
        id: row.id,
        name: row.name,
        kind: row.kind,
        online: !!row.online,
        permissions,
      };
    }).filter(Boolean);
    return termToResponse(res, 200, { orgId: params.org, role: resolved.role, devices });
  });

  router.get('/v1/orgs/:org/members', (ctx, params, res) => {
    assertCan(db, ctx, 'user:read');
    const rows = db.prepare(`
      SELECT m.user_id, m.role, m.status, u.name, u.email
        FROM memberships AS m
        JOIN users AS u ON u.id = m.user_id
       WHERE m.org_id = ? AND m.status != 'removed'
       ORDER BY u.name ASC, u.email ASC
    `).all(params.org);
    return termToResponse(res, 200, { orgId: params.org, members: rows.map(memberSummary) });
  });

  router.patch('/v1/orgs/:org/members/:userId', (ctx, params, res) => {
    const targetUserId = params.userId;
    if (targetUserId === ctx.userId) throw selfRoleChange();
    const nextRole = String(ctx.body.role ?? '');
    if (!nextRole) throw badRequest('role is required');
    assertRoleExists(db, nextRole);
    assertCan(db, ctx, 'user:role:update');
    assertCanModify(db, ctx.role, nextRole);
    const existing = db.prepare('SELECT * FROM memberships WHERE org_id = ? AND user_id = ?').get(params.org, targetUserId);
    if (!existing) throw notFound();
    assertNotLastOwner(db, params.org, targetUserId);
    db.prepare('UPDATE memberships SET role = ?, perm_version = perm_version + 1 WHERE org_id = ? AND user_id = ?').run(nextRole, params.org, targetUserId);
    audit(db, { orgId: params.org, actorId: ctx.userId, action: 'user.role.update', targetType: 'member', targetId: targetUserId, result: 'allow', reasonCode: null, requestId: ctx.requestId });
    return termToResponse(res, 200, { orgId: params.org, userId: targetUserId, role: nextRole });
  });

  router.post('/v1/orgs/:org/members/:userId/suspend', (ctx, params, res) => {
    assertCan(db, ctx, 'user:remove');
    const target = db.prepare('SELECT * FROM memberships WHERE org_id = ? AND user_id = ?').get(params.org, params.userId);
    if (!target) throw notFound();
    db.prepare('UPDATE memberships SET status = ?, perm_version = perm_version + 1 WHERE org_id = ? AND user_id = ?').run('suspended', params.org, params.userId);
    endActiveSessions(db, { orgId: params.org, userId: params.userId, reason: 'user_suspended' });
    audit(db, { orgId: params.org, actorId: ctx.userId, action: 'member.suspend', targetType: 'member', targetId: params.userId, result: 'allow', requestId: ctx.requestId });
    return termToResponse(res, 200, { orgId: params.org, userId: params.userId, status: 'suspended' });
  });

  router.delete('/v1/orgs/:org/members/:userId/suspend', (ctx, params, res) => {
    assertCan(db, ctx, 'user:remove');
    const target = db.prepare('SELECT * FROM memberships WHERE org_id = ? AND user_id = ?').get(params.org, params.userId);
    if (!target) throw notFound();
    db.prepare('UPDATE memberships SET status = ?, perm_version = perm_version + 1 WHERE org_id = ? AND user_id = ?').run('active', params.org, params.userId);
    return termToResponse(res, 200, { orgId: params.org, userId: params.userId, status: 'active' });
  });

  router.delete('/v1/orgs/:org/members/me', (ctx, params, res) => {
    const member = ensureMembership(db, ctx.userId, params.org);
    if (member.role === 'owner') assertNotLastOwner(db, params.org, ctx.userId);
    db.prepare('UPDATE memberships SET status = ?, perm_version = perm_version + 1 WHERE org_id = ? AND user_id = ?').run('removed', params.org, ctx.userId);
    endActiveSessions(db, { orgId: params.org, userId: ctx.userId, reason: 'membership_removed' });
    audit(db, { orgId: params.org, actorId: ctx.userId, action: 'member.remove', targetType: 'member', targetId: ctx.userId, result: 'allow', requestId: ctx.requestId });
    return termToResponse(res, 200, { orgId: params.org, userId: ctx.userId, status: 'removed' });
  });

  router.get('/v1/orgs/:org/audit', (ctx, params, res) => {
    assertCan(db, ctx, 'audit:read');
    const limitRaw = ctx.query.get('limit');
    const offsetRaw = ctx.query.get('offset');
    const limit = Number(limitRaw ?? '50');
    const offset = Number(offsetRaw ?? '0');
    if (!Number.isFinite(limit) || limit <= 0 || limit > 10000) throw badRequest('limit must be between 1 and 10000');
    if (!Number.isFinite(offset) || offset < 0) throw badRequest('offset must be >= 0');

    const events = db.prepare(`
      SELECT id, org_id, actor_id, action, target_type, target_id, result, reason_code, request_id, at
        FROM audit_events
       WHERE org_id = ?
       ORDER BY at DESC, id DESC
       LIMIT ? OFFSET ?
    `).all(params.org, limit, offset);
    return termToResponse(res, 200, { orgId: params.org, events });
  });

  router.get('/v1/orgs/:org/grants', (ctx, params, res) => {
    const permissions = resolve(db, { userId: ctx.userId, orgId: params.org, now: new Date() }).permissions;
    if (
      permissions['grant:create']?.effect !== 'allow' &&
      permissions['grant:revoke']?.effect !== 'allow' &&
      permissions['user:read']?.effect !== 'allow' &&
      permissions['audit:read']?.effect !== 'allow'
    ) {
      throw forbidden('missing permission: grant:read');
    }
    const rows = db.prepare(`
      SELECT g.*, u.name AS user_name, d.name AS device_name
        FROM grants AS g
        JOIN users AS u ON u.id = g.user_id
        LEFT JOIN devices AS d ON d.id = g.device_id
       WHERE g.org_id = ? AND g.revoked_at IS NULL
       ORDER BY g.created_at DESC
    `).all(params.org);

    const grants = rows.map((row) => ({
      id: row.id,
      orgId: row.org_id,
      userId: row.user_id,
      deviceId: row.device_id,
      effect: row.effect,
      permissions: db.prepare('SELECT permission FROM grant_permissions WHERE grant_id = ? ORDER BY permission').all(row.id).map((p) => p.permission),
      createdBy: row.created_by,
      createdAt: row.created_at,
      deviceName: row.device_name,
      userName: row.user_name,
    }));
    return termToResponse(res, 200, { orgId: params.org, grants });
  });

  router.post('/v1/orgs/:org/grants', (ctx, params, res) => {
    const body = ctx.body ?? {};
    const userId = String(body.userId ?? '');
    const effect = String(body.effect ?? '');
    const permissions = Array.isArray(body.permissions) ? body.permissions.map(String) : [];
    const deviceId = body.deviceId ? String(body.deviceId) : null;
    if (!userId || !['allow', 'deny'].includes(effect) || permissions.length === 0) {
      throw badRequest('userId, effect and permissions are required', 'validation');
    }
    if (userId === ctx.userId) throw forbidden('you cannot grant yourself', 'self_grant');
    const target = db.prepare('SELECT * FROM memberships WHERE org_id = ? AND user_id = ?').get(params.org, userId);
    if (!target) throw notFound();
    assertCan(db, ctx, 'grant:create');
    for (const permission of permissions) {
      const exists = db.prepare('SELECT 1 FROM permission_patterns WHERE pattern = ?').get(permission);
      if (!exists) throw badRequest(`unknown permission: ${permission}`, 'unknown_permission');
    }
    assertMayGrant(db, ctx, permissions, deviceId);

    const grantId = newId('grt');
    db.prepare(`
      INSERT INTO grants (id, org_id, user_id, device_id, effect, starts_at, expires_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(grantId, params.org, userId, deviceId, effect, null, null, ctx.userId);
    for (const permission of permissions) {
      db.prepare('INSERT INTO grant_permissions (grant_id, permission) VALUES (?, ?)').run(grantId, permission);
    }
    db.prepare('UPDATE memberships SET perm_version = perm_version + 1 WHERE org_id = ? AND user_id = ?').run(params.org, userId);
    audit(db, { orgId: params.org, actorId: ctx.userId, action: 'grant.create', targetType: 'grant', targetId: grantId, result: 'allow', requestId: ctx.requestId });
    return termToResponse(res, 201, { id: grantId, orgId: params.org, userId, deviceId, effect, permissions });
  });

  router.get('/v1/orgs/:org/sessions', (ctx, params, res) => {
    const rows = db.prepare(`
      SELECT s.*, d.name AS device_name
        FROM sessions AS s
        JOIN devices AS d ON d.id = s.device_id
       WHERE s.org_id = ?
       ORDER BY s.started_at DESC, s.id DESC
    `).all(params.org);
    const sessions = rows.map((row) => {
      const payload = {
        id: row.id,
        orgId: row.org_id,
        userId: row.user_id,
        deviceId: row.device_id,
        deviceName: row.device_name,
        mode: row.mode,
        state: row.state,
        endReason: row.end_reason,
        startedAt: row.started_at,
        expiresAt: row.expires_at,
        endedAt: row.ended_at,
        authorizedBy: JSON.parse(row.authorized_by),
        org_id: row.org_id,
        user_id: row.user_id,
        device_id: row.device_id,
        device_name: row.device_name,
        end_reason: row.end_reason,
        started_at: row.started_at,
        expires_at: row.expires_at,
        ended_at: row.ended_at,
        authorized_by: JSON.parse(row.authorized_by),
      };
      return payload;
    });
    return termToResponse(res, 200, { orgId: params.org, sessions });
  });

  router.post('/v1/orgs/:org/sessions', (ctx, params, res) => {
    const body = ctx.body ?? {};
    const deviceId = String(body.deviceId ?? '');
    const mode = String(body.mode ?? '');
    if (!deviceId || !mode) throw badRequest('deviceId and mode are required');

    const device = db.prepare('SELECT * FROM devices WHERE id = ? AND org_id = ? AND deleted_at IS NULL').get(deviceId, params.org);
    if (!device) throw notFound();

    try {
      assertCanStartSession(db, { userId: ctx.userId, orgId: params.org }, mode, deviceId);
    } catch (error) {
      auditDenials(db, ctx, { action: 'session.start', targetType: 'device', targetId: deviceId }, () => {
        throw error;
      });
      throw error;
    }

    if (mode !== 'view') {
      const existing = db.prepare(`
        SELECT id FROM sessions
         WHERE org_id = ? AND device_id = ? AND state = 'active' AND mode IN ('control', 'terminal')
      `).get(params.org, deviceId);
      if (existing) throw conflict('device already has an exclusive session', 'DEVICE_BUSY');
    }

    const sessionId = newId('ses');
    const authSnapshot = snapshotAuthority(db, { userId: ctx.userId, orgId: params.org, deviceId });
    const expiresAt = sessionExpiry(db, params.org);
    db.prepare(`
      INSERT INTO sessions (id, org_id, user_id, device_id, mode, state, authorized_by, started_at, expires_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(sessionId, params.org, ctx.userId, deviceId, mode, authSnapshot, nowIso(), expiresAt);
    audit(db, { orgId: params.org, actorId: ctx.userId, action: 'session.start', targetType: 'device', targetId: deviceId, result: 'allow', requestId: ctx.requestId });
    return termToResponse(res, 201, { id: sessionId, orgId: params.org, userId: ctx.userId, deviceId, mode, state: 'active', expiresAt });
  });

  router.get('/v1/sessions/:id', (ctx, params, res) => {
    const row = db.prepare(`
      SELECT s.*, d.name AS device_name
        FROM sessions AS s
        JOIN devices AS d ON d.id = s.device_id
       WHERE s.id = ?
    `).get(params.id);
    if (!row) throw notFound();
    if (row.user_id !== ctx.userId && !['owner', 'admin'].includes(ctx.role)) {
      throw forbidden('you cannot inspect that session');
    }
    return termToResponse(res, 200, {
      id: row.id,
      orgId: row.org_id,
      userId: row.user_id,
      deviceId: row.device_id,
      deviceName: row.device_name,
      mode: row.mode,
      state: row.state,
      endReason: row.end_reason,
      startedAt: row.started_at,
      expiresAt: row.expires_at,
      endedAt: row.ended_at,
      authorizedBy: JSON.parse(row.authorized_by),
      org_id: row.org_id,
      user_id: row.user_id,
      device_id: row.device_id,
      device_name: row.device_name,
      end_reason: row.end_reason,
      started_at: row.started_at,
      expires_at: row.expires_at,
      ended_at: row.ended_at,
      authorized_by: JSON.parse(row.authorized_by),
    });
  });

  router.post('/v1/orgs', (ctx, _params, res) => {
    const body = ctx.body ?? {};
    const name = String(body.name ?? '').trim();
    if (!name) throw badRequest('name is required');
    const orgId = `org_${newId('org').replace(/^org_/, '')}`;
    const theme = 'cobalt';
    db.prepare('INSERT INTO organizations (id, name, theme) VALUES (?, ?, ?)').run(orgId, name, theme);
    db.prepare('INSERT INTO memberships (id, org_id, user_id, role, status, perm_version) VALUES (?, ?, ?, ?, ?, 1)').run(newId('mem'), orgId, ctx.userId, 'owner', 'active');
    return termToResponse(res, 201, { id: orgId, name, theme, role: 'owner' });
  });

  router.get('/v1/orgs/:org/invites', (ctx, params, res) => {
    assertCan(db, ctx, 'user:invite');
    const rows = db.prepare(`
      SELECT i.*, u.name AS invited_by_name
        FROM invites AS i
        JOIN users AS u ON u.id = i.invited_by
       WHERE i.org_id = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL
       ORDER BY i.created_at DESC
    `).all(params.org);
    return termToResponse(res, 200, { orgId: params.org, invites: rows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      invitedBy: row.invited_by_name,
    })) });
  });

  router.post('/v1/orgs/:org/invites', (ctx, params, res) => {
    assertCan(db, ctx, 'user:invite');
    const body = ctx.body ?? {};
    const email = String(body.email ?? '').trim().toLowerCase();
    const role = String(body.role ?? '');
    if (!email || !role) throw badRequest('email and role are required');
    assertRoleExists(db, role);

    const raw = newInviteToken();
    const inviteId = newId('inv');
    db.prepare(`
      INSERT INTO invites (id, org_id, email, role, token_hash, invited_by, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(inviteId, params.org, email, role, hashInviteToken(raw), ctx.userId, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString());
    return termToResponse(res, 201, { id: inviteId, email, role, orgId: params.org, inviteToken: raw });
  });

  router.get('/v1/invites/:token', (ctx, params, res) => {
    const invite = db.prepare(`
      SELECT i.*, o.name AS org_name
        FROM invites AS i
        JOIN organizations AS o ON o.id = i.org_id
       WHERE i.token_hash = ? AND i.revoked_at IS NULL AND i.accepted_at IS NULL AND i.expires_at > ?
    `).get(hashInviteToken(params.token), nowIso());
    if (!invite) throw notFound('invite not found');
    return termToResponse(res, 200, {
      email: invite.email,
      orgName: invite.org_name,
      role: invite.role,
      expiresAt: invite.expires_at,
    });
  });

  router.post('/v1/invites/:token/accept', (ctx, params, res) => {
    const raw = params.token;
    const body = ctx.body ?? {};
    const name = String(body.name ?? '').trim();
    const password = String(body.password ?? '');
    if (!name || !password) throw badRequest('name and password are required');

    const invite = db.prepare(`
      SELECT * FROM invites WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
    `).get(hashInviteToken(raw), nowIso());
    if (!invite) throw gone('invite is no longer valid');
    if (invite.accepted_at) throw conflict('invite has already been used', 'INVITE_REUSED');

    const email = invite.email.toLowerCase();
    let user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email);
    if (!user) {
      const userId = newId('usr');
      db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)')
        .run(userId, email, name, hashPassword(password));
      user = { id: userId, email, name };
    }

    const existing = db.prepare('SELECT 1 FROM memberships WHERE org_id = ? AND user_id = ?').get(invite.org_id, user.id);
    if (!existing) {
      db.prepare('INSERT INTO memberships (id, org_id, user_id, role, status, invited_by, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(newId('mem'), invite.org_id, user.id, invite.role, 'active', invite.invited_by, nowIso());
    }

    db.prepare('UPDATE invites SET accepted_at = ?, accepted_by = ? WHERE id = ?').run(nowIso(), user.id, invite.id);
    return termToResponse(res, 200, {
      id: user.id,
      email: user.email,
      name: user.name,
      orgId: invite.org_id,
      role: invite.role,
    });
  });

  router.get('/v1/orgs/:org/people', (ctx, params, res) => {
    return router.match('GET', `/orgs/${params.org}/members`)?.handler?.(ctx, { org: params.org }, res) ?? termToResponse(res, 200, { orgId: params.org, members: [] });
  });

  router.get('/v1/orgs/:org/admin', (ctx, params, res) => {
    return termToResponse(res, 200, { orgId: params.org, permissions: withAllowedPermissions(db, ctx.userId, params.org) });
  });
}

function assertRoleExists(db, role) {
  const exists = db.prepare('SELECT 1 FROM roles WHERE key = ?').get(role);
  if (!exists) throw badRequest(`unknown role: ${role}`, 'unknown_role');
}
