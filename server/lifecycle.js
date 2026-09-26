// Shared domain rules: role ranks, last-owner protection, ending sessions.
//
// YOURS TO WRITE. This file ships as a stub.
//
// Put here the rules more than one route needs, so "what ends a session" has exactly
// one implementation. Sources: PERMISSIONS.md §7.2 and D8.
//
// Two traps worth naming before you start:
//   - `roles.rank` is MODIFICATION AUTHORITY ONLY. It must never answer a can()
//     question. operator and auditor are unordered by permission, and ranking them is
//     the modelling error the auditor role exists to catch.
//   - a permission change does NOT end a session in flight (grantfathering). Suspension,
//     membership removal and device transfer DO. See PERMISSIONS.md §7.

import { newId, nowIso } from './db.js';
import { badRequest, forbidden, lastOwner } from './http.js';

export function roleRanks(db) {
  return Object.fromEntries(db.prepare('SELECT key, rank FROM roles').all().map((row) => [row.key, row.rank]));
}

export function assertRoleExists(db, role) {
  if (!db.prepare('SELECT 1 FROM roles WHERE key = ?').get(role)) {
    throw badRequest(`unknown role: ${role}`, 'unknown_role');
  }
}

export function assertCanModify(db, callerRole, targetRole) {
  if (callerRole === 'owner') return;
  const ranks = roleRanks(db);
  if (ranks[callerRole] > ranks[targetRole]) return;
  throw forbidden('you cannot modify a user at or above your own role', 'insufficient_rank');
}

export function assertNotLastOwner(db, orgId, userId) {
  const target = db.prepare('SELECT role FROM memberships WHERE org_id = ? AND user_id = ?').get(orgId, userId);
  if (target?.role !== 'owner') return;
  const count = db.prepare(
    "SELECT count(*) AS total FROM memberships WHERE org_id = ? AND role = 'owner' AND status = 'active'"
  ).get(orgId).total;
  if (count <= 1) throw lastOwner();
}

export function endActiveSessions(db, { orgId, userId = null, deviceId = null, reason, exceptSessionId = null }) {
  const clauses = ['org_id = ?', "state = 'active'"];
  const values = [orgId];
  if (userId) { clauses.push('user_id = ?'); values.push(userId); }
  if (deviceId) { clauses.push('device_id = ?'); values.push(deviceId); }
  if (exceptSessionId) { clauses.push('id != ?'); values.push(exceptSessionId); }
  const ids = db.prepare(`SELECT id FROM sessions WHERE ${clauses.join(' AND ')}`).all(...values).map((row) => row.id);
  const update = db.prepare("UPDATE sessions SET state = 'ended', ended_at = ?, end_reason = ? WHERE id = ?");
  const endedAt = nowIso();
  for (const id of ids) update.run(endedAt, reason, id);
  return ids;
}

export function snapshotAuthority(db, { userId, orgId, deviceId }) {
  const role = db.prepare('SELECT role FROM memberships WHERE org_id = ? AND user_id = ?').get(orgId, userId)?.role ?? null;
  const at = nowIso();
  const grants = db.prepare(`
    SELECT id FROM grants
     WHERE user_id = ? AND org_id = ? AND revoked_at IS NULL
       AND (starts_at IS NULL OR starts_at <= ?)
       AND (expires_at IS NULL OR expires_at > ?)
       AND (device_id IS NULL OR device_id = ?)
  `).all(userId, orgId, at, at, deviceId).map((row) => row.id);
  return JSON.stringify({ role, grantIds: grants, snapshotAt: at });
}

export function sessionExpiry(db, orgId) {
  const minutes = db.prepare('SELECT max_session_minutes FROM organizations WHERE id = ?').get(orgId)?.max_session_minutes ?? 60;
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export { newId, nowIso };
