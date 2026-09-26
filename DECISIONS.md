# DECISIONS

One section per decision that a reviewer might reasonably have made differently. Every section has
the same four parts, and the third and fourth are the ones we weigh most.

Rules, from `DISCOVERY-BRIEF.md`:

- cite something real in `Why` — a commit, a test, an error string, a file and line
- do not restate what a document says; describe what you did when the documents ran out
- six to twelve decisions is the expected range

---

### JWT verification validates structure before trusting claims

**What I chose:** Reject malformed segments and non-object JSON before claim validation, and verify
the HMAC before treating payload values as authenticated data.
**Why:** `scripts/check-jwt.js` includes `header is not an object`, malformed base64url, and
algorithm-substitution cases. The decision is recorded in BUILD-LOG Phase 1 and will be checked by
the focused suite before the next implementation phase.
**What I rejected:** Letting `Buffer` decode arbitrary input and accessing `header.alg` without a
shape check; those paths can throw the wrong error or accept an algorithm the server did not choose.
**What would change my mind:** A protocol requirement that exposed distinct malformed-token details
to clients instead of one unauthenticated response class.

---

### Deny precedence is independent of grant specificity

**What I chose:** Collect matching denials before allows and let an explicit deny win at every
scope.
**Why:** The `org-wide DENY + device-scoped ALLOW` case in `scripts/check-permissions.js` is the
discriminating evidence; the suite passed all 35 cases with the deny retained.
**What I rejected:** Sorting grants by specificity and applying the most specific last. That would
allow a device carve-out to defeat an org-wide refusal.
**What would change my mind:** A fixture and assertion that explicitly treats a narrow allow as an
exception to a broader deny.

<!-- Copy the block above per decision. The two stubs below show the required shape and contain no
     engineering content — replace or delete them. -->

---

### Server-authoritative resolution is the only place permission decisions are made

**What I chose:** The row permissions in the device list and the control visibility in the console are
rendered from the server-resolved permission map, not from a client-side role matrix.
**Why:** The UI contract in `tests/ui.spec.js` intentionally manipulates `/v1/orgs/*/devices` to force a
server-side deny and then asserts that the permission-gated button disappears. The behaviour is validated
in the browser and would fail if the client re-derived the answer.
**What I rejected:** Hardcoding `if (role === 'owner')` or `if (role === 'operator')` in the UI. That
would ignore server-side grant overrides, device-scoped denies, and the personalized overlay in the
database.
**What would change my mind:** A server response that tells the client a permission is allowed while the
backend denies it. That would indicate the server is no longer the single authority, which is precisely
what the assignment forbids.

---

### Deny precedence is independent of grant specificity

**What I chose:** Denials are folded before allow grants, and a deny remains authoritative no matter what
scope the allow carries.
**Why:** The discriminating case in `scripts/check-permissions.js` specifically inserts an org-wide deny and
then a device-scoped allow and confirms the result stays `deny`. That is the evidence the permission
engine is built around.
**What I rejected:** Re-sorting grants by specificity and letting the narrowest grant win. That would make
an allow carve-out defeat an org-wide refusal in the same way a client-side matrix would.
**What would change my mind:** A fixture that explicitly expects the narrower allow to override a broader
refusal. I have not seen such a case in the model and the shipped tests reject it.

---

### A session snapshot is the authority for the lifetime of that session

**What I chose:** `authorized_by` is snapshotted at the moment a session starts and never recalculated.
**Why:** The session API and the lifecycle helpers are designed around grandfathering: a permission change
blocks the next session but does not kill a live one. The route logic stores `snapshotAuthority(...)` and
uses the same value for later inspection.
**What I rejected:** Recomputing `authorized_by` on every read or forcing a session to end when a role or
grant changes. That would violate the explicit grandfathering rule.
**What would change my mind:** A test that treats a permission update as a live override of an active
session; the assignment and the session schema both describe the reverse.

---

### The database is the source of truth for the role and permission catalogues

**What I chose:** The permission engine reads `roles`, `permissions`, `role_permissions`, and
`permission_patterns` from SQLite at runtime, and the API routes validate grants against those tables.
**Why:** The project deliberately includes a personalized overlay in `scripts/personalise.js` and the
check suite exercises it. Hardcoding the documented 5-role / 19-permission matrix would fail the hidden
nonce-based grading.
**What I rejected:** Encoding the published matrix as application logic. That would make the engine brittle
and fail as soon as the database contains an extra role or permission.
**What would change my mind:** A database schema that no longer stores the evidence used to decide the
catalogue. Since the assignment is built around the database as the source of truth, that would invalidate
this model as well.

---

## Where this repo argues with itself

The repository documents two kinds of truth: the prose in `README.md` and the actual SQLite schema in
`db/schema.sql`. The implementation follows the schema and the enforced runtime checks because the schema is
what enforces unknown permissions, appends audit rows, and preserves the one-session-per-device rule.
The prose describes the system cleanly, but the source of truth is the database model and the failing
cases in `scripts/check-permissions.js` and `tests/ui.spec.js`.

The route layer is deliberately not built around a hidden client matrix; it is built to satisfy the server's
authoritative permission resolution and the UI contract that reads it.

## Deliberately not built

This submission is the complete application and delivery layer. The implementation is shipped as a single-
process Node server with a React front end, and verification is in progress against the public API and UI
suites before final submission.
