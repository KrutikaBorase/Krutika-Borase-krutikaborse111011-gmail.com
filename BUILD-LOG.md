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

Not started. The route layer remains deliberately unimplemented while the shared server contract
is being built.

## Phase 4 — devices and grants

The permission engine is complete and its 35-case suite passes. Device and grant HTTP routes are
not yet implemented, so no end-to-end claim is made here.

## Phase 5 — sessions

Not started. Lifecycle helpers now provide session snapshots, expiry, last-owner protection, and
tenancy-event termination; route integration remains open.

## Phase 6 — audit

The append-only writer and denial wrapper are implemented, but the route-level audit contract is
not yet wired.

## Phase 7 — the console

Not started. The candidate web surface is still the supplied placeholder.

## Phase 8 — hardening

The clean checkout installs and resets on Windows. JWT and permission checks pass. Full API and UI
validation is intentionally pending until routes and the console exist.

## Open threads

Implement all route modules and the React console, then run the API and UI suites. Do not push or
submit this repository until those checks pass and the repository has been reviewed for accidental
reference imports.
