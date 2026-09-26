// The permission resolution engine. THE ONLY PLACE allow-vs-deny is decided.
//
// YOURS TO WRITE. This file ships as a stub.
//
// If you ever find yourself writing `if (role === 'admin')` outside this file — and
// especially under web/ — that is the bug this module exists to prevent. The console
// renders what this returns; it must never re-derive it.
//
// Inputs you will need:
//   permissions                 the catalogue (19 rows in db/reference.sql, but read it
//                               from the table, never hardcode it)
//   permission_patterns         the superset grants may name ('device:*', '*', ...)
//   role_permissions            the per-role baseline
//   memberships                 role + status + perm_version
//   grants / grant_permissions  per-user deltas, optionally device-scoped and windowed
//
// Behaviour to implement is in PERMISSIONS.md; the failure modes and the reason codes
// the API must report are in §10, and the shipped tests read those reason strings.
//
// NOTE: your database is personalised. There is at least one role and one permission in
// it that this exercise's prose never mentions. Read the tables; do not encode the
// documented matrix. Run `npm run personalisation` to see what you are dealing with.

import { forbidden } from './http.js';

export const MODE_PERMISSION = { view: 'device:view', control: 'device:control', terminal: 'device:terminal' };

const keys = (db) => db.prepare('SELECT key FROM permissions ORDER BY key').all().map((row) => row.key);
const member = (db, orgId, userId) => db.prepare(
  'SELECT role, status FROM memberships WHERE org_id = ? AND user_id = ?'
).get(orgId, userId);
const baseline = (db, role) => db.prepare(
  'SELECT permission FROM role_permissions WHERE role = ?'
).all(role).map((row) => row.permission);

function expand(pattern, catalogue) {
  if (pattern === '*') return catalogue;
  if (pattern.endsWith(':*')) return catalogue.filter((key) => key.startsWith(pattern.slice(0, -1)));
  return catalogue.includes(pattern) ? [pattern] : [];
}

function applicable(db, input, deviceId = null) {
  const deviceClause = deviceId === null ? '' : ' AND (g.device_id IS NULL OR g.device_id = ?)';
  const values = [input.userId, input.orgId, input.at, input.at];
  if (deviceId !== null) values.push(deviceId);
  return db.prepare(`
    SELECT g.id AS grant_id, g.device_id, g.effect, gp.permission
      FROM grants AS g
      JOIN grant_permissions AS gp ON gp.grant_id = g.id
     WHERE g.user_id = ? AND g.org_id = ? AND g.revoked_at IS NULL
       AND (g.starts_at IS NULL OR g.starts_at <= ?)
       AND (g.expires_at IS NULL OR g.expires_at > ?)${deviceClause}
  `).all(...values);
}

function blocked(catalogue, role, reason) {
  return {
    role,
    permissions: Object.fromEntries(catalogue.map((permission) => [permission, {
      effect: 'deny', source: null, reason,
    }])),
  };
}

function evaluate(catalogue, role, inherited, grants) {
  const denials = new Map();
  const allowances = new Map(inherited.map((permission) => [permission, `role:${role}`]));

  for (const grant of grants) {
    if (grant.effect !== 'deny') continue;
    for (const permission of expand(grant.permission, catalogue)) {
      if (!denials.has(permission)) denials.set(permission, grant.grant_id);
    }
  }
  for (const grant of grants) {
    if (grant.effect !== 'allow') continue;
    for (const permission of expand(grant.permission, catalogue)) {
      if (!allowances.has(permission)) allowances.set(permission, `grant:${grant.grant_id}`);
    }
  }

  return Object.fromEntries(catalogue.map((permission) => {
    if (denials.has(permission)) return [permission, {
      effect: 'deny', source: `grant:${denials.get(permission)}`, reason: 'explicit_deny',
    }];
    if (allowances.has(permission)) return [permission, {
      effect: 'allow', source: allowances.get(permission), reason: null,
    }];
    return [permission, { effect: 'deny', source: null, reason: 'implicit' }];
  }));
}

function gate(status) {
  if (status === undefined) return 'not_a_member';
  if (status === 'suspended') return 'suspended';
  if (status !== 'active') return 'inactive_membership';
  return null;
}

// Resolve one user's permission set in one org. deviceId === null means the org-level
// view; a deviceId means the exact per-device check.
export function resolve(db, { userId, orgId, deviceId = null, now = new Date() }) {
  const catalogue = keys(db);
  const membership = member(db, orgId, userId);
  const reason = gate(membership?.status);
  if (reason) return blocked(catalogue, membership?.role ?? null, reason);
  const input = { userId, orgId, at: now.toISOString() };
  return {
    role: membership.role,
    permissions: evaluate(catalogue, membership.role, baseline(db, membership.role), applicable(db, input, deviceId)),
  };
}

// Batched form for list endpoints: { role, byDevice: { [deviceId]: permissions } }.
export function resolveDevices(db, { userId, orgId, deviceIds, now = new Date() }) {
  const catalogue = keys(db);
  const membership = member(db, orgId, userId);
  const reason = gate(membership?.status);
  if (reason) {
    const denied = blocked(catalogue, membership?.role ?? null, reason).permissions;
    return { role: membership?.role ?? null, byDevice: Object.fromEntries(deviceIds.map((id) => [id, denied])) };
  }
  const input = { userId, orgId, at: now.toISOString() };
  const grants = applicable(db, input);
  const inherited = baseline(db, membership.role);
  return {
    role: membership.role,
    byDevice: Object.fromEntries(deviceIds.map((deviceId) => [deviceId, evaluate(
      catalogue,
      membership.role,
      inherited,
      grants.filter((grant) => grant.device_id === null || grant.device_id === deviceId)
    )])),
  };
}

export function can(db, ctx, permission, deviceId) {
  return resolve(db, { ...ctx, deviceId }).permissions[permission]?.effect === 'allow';
}

// Throws 403 carrying the reason code, so a refusal is debuggable.
export function assertCan(db, ctx, permission, deviceId) {
  const entry = resolve(db, { ...ctx, deviceId }).permissions[permission];
  if (entry?.effect === 'allow') return;
  const reason = entry?.reason === 'explicit_deny'
    ? 'explicit_deny'
    : entry?.reason === 'suspended'
      ? 'suspended'
      : entry?.reason === 'not_a_member'
        ? 'not_a_member'
        : 'missing_permission';
  throw forbidden(`missing permission: ${permission}`, reason);
}

// No privilege laundering: you may only grant authority you hold at that scope.
export function assertMayGrant(db, ctx, patterns, deviceId = null) {
  const permissions = resolve(db, { ...ctx, deviceId }).permissions;
  for (const pattern of patterns) {
    for (const permission of expand(pattern, Object.keys(permissions))) {
      const entry = permissions[permission];
      if (entry.effect === 'allow') continue;
      throw forbidden(
        `you cannot grant a permission you do not hold at this scope: ${permission}`,
        entry.reason === 'explicit_deny' ? 'explicit_deny' : 'missing_permission'
      );
    }
  }
}

// The compound check: session:start AND the permission for the requested mode, and a
// refusal must distinguish WHICH of the two was missing.
export function assertCanStartSession(db, ctx, mode, deviceId) {
  const requested = MODE_PERMISSION[mode];
  if (!requested) throw forbidden('unknown session mode', 'validation');
  assertCan(db, ctx, 'session:start', deviceId);
  if (!can(db, ctx, requested, deviceId)) {
    throw forbidden(`${mode} sessions also require ${requested}`, 'missing_device_permission');
  }
}
