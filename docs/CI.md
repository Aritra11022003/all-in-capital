# Continuous integration

Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). It runs on every pull request, on pushes to any branch except `main`, and on demand (`workflow_dispatch`). It needs **no secrets, API keys, paid services, AI providers or Vercel credentials**, and it never deploys, publishes or pushes. It costs ₹0 because the repository is public (GitHub Actions minutes are free for public repositories).

## What CI checks

Two jobs run in parallel. A pull request is mergeable only when both pass (once branch protection is set up; see below).

**App** (`ubuntu-24.04`, Node 24):

| Step | Command | Fails when |
|---|---|---|
| Install | `npm ci` | `package-lock.json` is out of sync with `package.json`, or a package cannot be installed |
| Typecheck | `npm run typecheck` (`next typegen && tsc --noEmit`) | A TypeScript error. `next typegen` generates Next.js route types (e.g. `LayoutProps`) that a clean checkout does not have yet |
| Lint | `npm run lint` | An ESLint error |
| Unit tests | `npm test` | Any of the 60 Vitest tests fails |
| Evaluation | `npm run eval` | A kill criterion fires (any critical failure in a gating or calibration suite), the two in-run passes give different result hashes, or the unit tests fail. `data/private` does not exist on runners, so the private Loop 1 and Loop 2 suites are reported as unavailable and skipped. The results hash therefore differs from a local run that has the private exports |
| Build | `npm run build` | `next build` fails |

**Database** (`ubuntu-24.04`, Docker on the runner, Supabase CLI 2.120.0):

1. **Guard**: fails if any hosted-database setting is present (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_URL`, `DATABASE_URL`, or a linked-project marker).
2. **Static order check** (`scripts/ci/check-migration-order.mjs`): every file in `supabase/migrations/` must be named `NNNN_lower_snake_name.sql`, non-empty, uniquely numbered and contiguous from `0001`. It prints the apply order.
3. **Pinned CLI**: downloads the exact release tarball and verifies its SHA-256 before use.
4. **Disposable stack**: `supabase start` runs a local Supabase stack in Docker (Postgres with the real `auth` and `storage` schemas). Studio, image proxy, edge runtime, logging and realtime are excluded.
5. **Fresh reset**: `supabase db reset --local` drops the local database and applies **all** migrations in version order, then `supabase/seed.sql`. It stops at the first failing statement; the output is in the job log.
6. **Applied = present**: compares `supabase_migrations.schema_migrations` with the files in `supabase/migrations/`. This catches a migration the CLI silently skipped, for example because of a bad filename.
7. **Expected final schema** (`scripts/ci/verify-schema.sql`): read-only catalog assertions:
   - all 30 expected tables, and no unexpected ones;
   - row-level security **enabled and forced** on every table;
   - at least one policy per table, 53 public policies, and both storage policies;
   - 13 enum types, the 5 security/guard functions and the decision-guard trigger;
   - the `application-documents` bucket exists and is **private**;
   - the seed contains reference data only (1 portfolio dataset, 7 companies, 6 availability rules; zero applications and documents).
8. **Teardown**: `supabase stop --no-backup` always runs. Nothing persists between runs.

## How the disposable database works

- It runs **only** inside the CI runner's Docker (or your own Docker locally). `supabase/config.toml` holds no project ref, access token or password, and the workflow never calls `supabase link`, `--linked` or `--db-url`.
- Every run starts from an empty Docker volume, and `supabase db reset` then recreates the database from migrations. Results never depend on a previous run.
- Data: only `supabase/seed.sql` (the 7 portfolio companies named in the case and team availability). **No founder, application or private data is ever loaded**, and `data/private` is git-ignored.
- The local stack prints well-known local development keys on start. The workflow writes that output to a file instead of the log.

## Running the same checks locally

App checks need only Node ≥ 20.9:

```bash
npm ci
```

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm test
```

```bash
npm run eval
```

```bash
npm run build
```

Locally, `npm run eval` also runs the private Loop suites if `data/private` exists, so its hash differs from CI's.

Database checks need Docker (Docker Desktop or another engine; check Docker Desktop's licence terms for your organisation) and the Supabase CLI 2.120.0:

```bash
node scripts/ci/check-migration-order.mjs
```

```bash
supabase start -x studio,imgproxy,edge-runtime,logflare,vector,realtime
```

```bash
supabase db reset --local
```

```bash
docker exec -i "$(docker ps --filter name=supabase_db_ --format '{{.Names}}' | head -n 1)" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/ci/verify-schema.sql
```

```bash
supabase stop --no-backup
```

## What CI does not validate

- **Authorisation behaviour.** CI proves that RLS is enabled and policies *exist*; it does not prove the policies are *correct*. The known policy defects (`docs/PRODUCTION_READINESS_AUDIT.md` DB-1 to DB-6) still pass this check. Behavioural RLS tests are backlog task 0.5.
- **The app against the database.** The app still runs in demo mode from browser storage; no app code talks to Supabase yet (backlog Phase 1).
- **End-to-end browser flows, accessibility, performance or security scanning** (backlog TST-2, TST-4).
- **The private Loop 1 / Loop 2 evaluation suites** (no private data on runners, by design).
- **Hosted Supabase or Vercel behaviour, backups or production configuration.**
- **Independent validation.** DI-16 stays `needs_review` and ADV-16 stays exploratory; CI cannot supply a human reviewer.

## Interpreting failures

| Failing step | Usual cause | What to do |
|---|---|---|
| Install | Lockfile drift | Run `npm install` locally and commit the updated `package-lock.json` |
| Typecheck | Type error, or new routes without regenerated types | Run `npm run typecheck` locally |
| Evaluation | A kill criterion fired: the log's "Kill criteria" line names the test IDs | Open `evals/reports/LATEST.md` after a local `npm run eval`. Never weaken a test to pass; fix the behaviour |
| Static order check | Misnamed, duplicated, empty or out-of-sequence migration | Rename to the next free `NNNN_` number. Never renumber a migration that has been applied anywhere |
| Start stack | Docker image pull or CLI problem (infrastructure, not your change) | Re-run the job. If it persists, check the pinned CLI version |
| Reset / apply | SQL error in a migration or the seed. The log shows `Applying migration NNNN_…` just before the error | Fix the SQL in a new migration if the broken one was ever applied elsewhere; otherwise fix it in place |
| Applied = present | The CLI skipped a file | Check the filename pattern |
| Expected schema | A migration changed tables, RLS, policies, enums, functions, the bucket or the seed. The message lists each problem | If the change is intended, update `scripts/ci/verify-schema.sql` **in the same pull request**; if not, fix the migration |

## GitHub settings needed (repository owner)

These are not changed by this repository and need a person with admin rights. Current state, read on 25 Nov 2026: `main` has **no branch protection and no rulesets**; Actions are enabled; the default workflow token is read-only; any action is allowed; SHA pinning is not enforced.

1. **Protect `main`** (Settings → Rules → Rulesets → New branch ruleset, target `main`):
   - require a pull request before merging;
   - require status checks to pass: **CI / App — typecheck, lint, tests, evaluation, build** and **CI / Database — apply all migrations to a disposable Supabase stack** (they appear in the picker after the workflow has run once);
   - require branches to be up to date;
   - block force pushes and deletions.
2. **Actions → General**: keep "Read repository contents" as the default token permission (already set). Optionally enable "Require actions to be pinned to a full-length commit SHA" (this workflow already complies) and limit allowed actions to GitHub-owned ones (this workflow uses only `actions/checkout` and `actions/setup-node`).
3. **Fork pull requests**: require approval before workflows run for first-time contributors (Settings → Actions → General).
4. **Vercel** (backlog task 0.2): decide whether pushes to `main` should keep auto-deploying. CI itself never deploys.
