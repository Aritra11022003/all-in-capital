# Database security tests (RLS)

Suite: [`supabase/security-tests/rls_attacks.sql`](../supabase/security-tests/rls_attacks.sql). Fix: [`supabase/migrations/0003_security_model.sql`](../supabase/migrations/0003_security_model.sql). It runs in the CI **Database** job after the schema check (see [CI.md](CI.md)).

## What it proves

The suite talks to PostgreSQL **directly** as real database roles, the same way PostgREST or supabase-js would. It does not use the app's permission helpers:

- `authenticated` with a JWT `sub` for each fictional user;
- `anon`;
- `service_role`.

It exercises RLS policies, column privileges, triggers and security-definer functions.

- **Attack cases (`ATK-*`)** must obtain nothing: zero rows, zero rows changed, or a privilege error. `TRUNCATE` cases must be refused outright, because `TRUNCATE` reports zero rows even when it succeeds.
- **Workflow cases (`WF-*`)** must keep working.

| Group | What is attempted |
|---|---|
| ATK-1 | The partner reads a deeptech application's documents, page text or storage object **without an explicit grant**; also after a grant is revoked |
| ATK-2 | The same founder content reached through child tables while document access is denied: claims, extracted fields, evidence, conflicts, claim/assessment links, research findings, evaluations, assessments (signal excerpts), corrections, overlap results, founder background, job errors, audit details |
| ATK-3 | The associate (or anyone) changes `decision_status` directly, creates a pre-approved application, records or edits a partner decision, rewrites conflict severity, or reopens an application |
| ATK-4 | Members forge (as themselves, as the principal, as "system"), edit, delete or truncate audit records |
| ATK-5 | Storage objects: reading another application's deck; uploading into an application the user may not write to, into a malformed path or into a non-existent application; moving stored files |
| ATK-6 | Direct database bypass: research, evidence and corrections on inaccessible applications; self-granting access; forging a grant row; promoting oneself to principal; non-members and deactivated members; `TRUNCATE`; a grant on one application widening to another; deciding without having opened the application |
| ATK-7 | Anonymous requests: reading any table or stored document, inserting, `TRUNCATE`, calling the RPC functions |
| WF-1 | Principal and associate read every application by role; the partner still sees the application list; reference seed data is readable |
| WF-2 | The principal grants the partner access to one application (audited). The partner then reads its documents, claims, assessments and deck, and updates research and evidence. Revocation removes access (audited) |
| WF-3 | The associate edits intake fields, uploads into a valid path, resolves a conflict, creates an application and submits it for partner review (audited) |
| WF-4 | The principal opens the application and records `approve_call`. `decision_status` follows the decision record (audited). The principal reopens it into cycle 2 (audited) |
| WF-5 | The audit trail is readable by the principal, is written by the database, and is immutable even for `service_role` |

**Identities and data.** All identities and records are fictional:

- `principal@example.test`, `partner@example.test` and so on, plus a deactivated member and a signed-in user with no profile;
- "Fictional Orbital Labs" (deeptech + hardware) and "Fictional Ledger Co" (fintech).

Kushal, Aditya and Riya are the fictional case-study roles (`kushal`, `aditya`, `riya` in `app_role`). The whole suite runs in one transaction that is rolled back, and every attack write is rolled back on its own as well.

## Evidence

| State | Where | Attacks blocked | Workflows working |
|---|---|---|---|
| Before 0003 (0001 + 0002 only) | GitHub Actions run [45554603085](https://github.com/Aritra11022003/all-in-capital/actions/runs/45554603085), real local Supabase stack, commit `5bb76ce` | 28 / 70 | 18 / 32 |
| After 0003 | The CI run on the pull request (see its checks) | 70 / 70 | 32 / 32 |

**The before-run failures were genuine vulnerabilities:**

- **DB-1:** the partner read deeptech documents with no grant (ATK-1.1, 1.2, 5.1), and kept access after a "revocation" (ATK-1.4).
- **DB-2:** document excerpts were readable through every child table, for every application (ATK-2.*, 6.13).
- **DB-3:** the associate, and the principal without a decision record, could set `decision_status` directly. The associate could create pre-approved applications and rewrite conflict severity (ATK-3.1–3.3, 3.7, 3.8, 3.12).
- **DB-4:** members could insert self-attributed audit events. The `service_role` could rewrite and delete history (ATK-4.1, WF-5.3, 5.4).
- **DB-5:** uploads were accepted into malformed paths and into non-existent applications (ATK-5.4, 5.5).
- **DB-6:** the partner could update research, add evidence and correct scores on applications he could not see (ATK-6.1–6.3).
- **New finding:** `anon` and `authenticated` could **`TRUNCATE`** public tables, including the audit log. Supabase's default grants include `TRUNCATE`, and RLS never applies to it (ATK-4.6, 6.11, 7.8).

Some before-run failures (ATK-3.10, 6.4–6.6, 7.9, 7.10 and the WF-2/3/4 cases) failed because the mechanism did not exist yet: there were no grant, submit or reopen functions, and no decision-to-status link. The supplemental local run on PGlite (PostgreSQL 17 with Supabase-like roles, grants and stubs) produced the same per-case verdicts before the fix. It was used during development only. CI on the real Supabase stack is the evidence.

## Design decisions in 0003

1. **Grants.**
   - Grants are per user and per application (`application_access_grants`), created and revoked only by the principal, through `grant_document_access` and `revoke_document_access`.
   - Each grant or revocation records a reason and an audit event. Grants can only go to an active partner: the principal and the associate already have access by role.
   - Sector and tags no longer affect access.
2. **Child tables (fail closed).**
   - Every table carrying founder-document content, or derived from it, uses the same predicate as `documents`.
   - That covers evaluations and assessments, because assessment signals quote source sentences.
   - Audit events about an application follow it.
   - The application list itself (`applications`, `companies`), cycles, views, partner decisions, scheduling and reference data stay visible to every member, as in the product.
3. **Decisions.**
   - Clients can update only intake columns of `applications`.
   - `decision_status` changes only through:
     - a `partner_decisions` insert (principal only, after opening; must target the current cycle), via a trigger that sets the status and writes the audit event;
     - `submit_for_partner_review` (associate or principal);
     - `reopen_application` (principal).
   - Recorded decisions cannot be updated or deleted.
4. **Audit.**
   - Clients cannot insert, update, delete or truncate audit events.
   - The database writes them (`write_audit`, callable only by the functions and triggers above).
   - Triggers make the table append-only for every role, including `service_role`. The one exception is the automatic `ON DELETE SET NULL` of `application_id`.
5. **Storage.**
   - Object paths must be `{application_id}/{document_id}/{file}` with UUIDs and an existing application.
   - Reads follow document access; uploads need the upload role plus access to that application.
   - No client may update or delete objects.
6. **Privileges.**
   - `anon` has no privileges on any public table or sequence and cannot call the RPC functions.
   - `authenticated` loses `TRUNCATE`, `REFERENCES` and `TRIGGER`. This also applies to future tables, through default privileges.

**Product note for the partners.** In demo mode, the application page tells the partner, for applications not shared with him, that "scores, evidence and the report remain visible". With 0003, production mode hides those too, because they quote founder documents. The demo is unchanged. When production mode is built (backlog Phase 1), its UI must match the database, or the partners must decide on a redacted summary view.

## Not covered (remaining limitations)

- **Not tested in a real browser:** the hosted Supabase Auth and Storage API path (signed URLs, JWT issuance). The tests set the JWT claims inside the database, so this needs Phase 1 and end-to-end tests.
- **Role edits on learning rules and criteria:** the partner and principal can still change any column of a learning rule or criteria version they may decide on. This is within their role, but it is not column-restricted.
- **Partner decisions:** `partner_decisions.rationale` and cycle reasons are visible to all members. They are written by the principal, not taken from founder documents.
- **Role names:** they are still person-named (`kushal`, `aditya`, `riya`), and there is only one partner role (backlog 0.7).
- **Not handled by this suite:** server-side upload validation (DOC-1), retention and deletion (DB-11), and schema parity with P2–P4 (DB-7).
- **No independent review:** these are automated tests written by the same engineer who wrote the fix. No external penetration test (backlog 3.4) has been done.

## Adding a case

Add a `perform rls_test.deny_read | deny_write | deny_strict | allow_read | allow_write | fact(...)` line to the right group. Use the fictional IDs from `rls_test.u()`. Never weaken an existing case to make it pass.

Database checks need Docker and the Supabase CLI. These are the same commands as in [CI.md](CI.md), plus:

```bash
docker exec -i "$(docker ps --filter name=supabase_db_ --format '{{.Names}}' | head -n 1)" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off -f - < supabase/security-tests/rls_attacks.sql
```
