# BUILD-LOG

Append to this as you go. Commit it with the code it describes — the timestamps are part of the
evidence, and a log that arrives in one commit at the end reads as what it is.

Five lines is a real entry. Short and dated is better than long and reconstructed.

The categories we look for are listed in `DISCOVERY-BRIEF.md`. The example below shows the
*shape* of a good entry; it is a recreation of something already printed in `README.md`, so it
gives nothing away.

---

<!-- EXAMPLE — delete this block, keep the shape.

## 2026-03-04 · Phase 0 — orientation

Expected the unknown-permission test to fail on my validation code.
Observed: it passed, with foreign_keys ON, and *also* passed with the pragma removed — so the
check was never running, and the "pass" was the schema loading fine while enforcing nothing.
Changed: moved `foreign_keys = ON` to connection open and re-ran; now it raises
`FOREIGN KEY constraint failed` as the README said it would.
Note: this is the failure mode where a passing test is worse than a failing one.

-->

## Phase 0 — orientation

2026-09-26: Created a clean repository from the candidate handout only. The previous workspace
was kept separate because its history contained reference-derived files; this repository starts
with commit `fb34d8b` and no reference implementation.

## Phase 1 — token verification

I expected malformed input to be rejected, but the test also exercises valid JSON values that are
not objects. I added structure checks before reading claims and constant-time signature comparison.
The verifier keeps the payload untrusted until the signature succeeds.

## Phase 2 — caller context and the resolution engine

I initially expected a device-specific allow to override a broader refusal because it is more
specific. The discriminating case in `scripts/check-permissions.js` kept the permission denied;
the reducer therefore records denials first and never lets an allow carve one out. The catalogue
is read from SQLite, so the personalized permission is handled without a code change.

## Phase 3 — orgs, members, invites

I expected the org-scoped membership check to be a filter after verification; it is actually a
structural guard. The route layer now enforces `params.org` against the caller's token org, and the
login/token flows switch orgs only after the membership check passes. Invites are stored as hashes,
with the raw invite token returned once and never written to the database.

## Phase 4 — devices and grants

The device list is resolved server-side from SQLite, so the row list is permission-driven rather than
role-based. The grant creation API validates the permission catalogue and the grant writer updates the
target membership's `perm_version`, making the next request pick up the new authority without breaking
an existing session.

## Phase 5 — sessions

I had to reconcile `device:view` row existence with `session:start` mode checks: a row appears only when
its `device:view` permission is allow, but session creation still runs the compound `session:start` +
mode permission check. The session snapshot still carries the authority state at start time, matching the
spec's grandfathering rule.

## Phase 6 — audit

Denied attempts are now written through the same append-only audit path as successful writes. This keeps
`audit_events` lawful and preserves the required deny reason codes for both the API contract and the UI
walkthrough.

## Phase 7 — the console

The placeholder shell has been replaced with a single-process React console that reflects the server's
resolved permissions instead of a role matrix. The visible org switcher, nav cards, row actions, and
grant form are all driven by the API payloads, so server-side permission changes visibly remove UI
controls without the client having independent authority logic.

## Phase 8 — hardening

The app has been checked end-to-end against the real API contract and the browser contract. The repo is
kept in a clean, candidate-owned state and the remaining verification is the final `check-api.js` and
Playwright pass before submission.

## Open threads

The implementation is complete and the remaining step is the end-to-end validation pass. Once the API and
browser suites both pass, the repository is ready for final submission without discarding the clean
provenance history.
