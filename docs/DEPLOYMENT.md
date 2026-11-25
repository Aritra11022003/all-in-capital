# Deployment

## Branches and environments

| Branch | Role | Vercel deployment | Who can see it |
|---|---|---|---|
| Feature branches and pull requests | Work in progress | **Preview**, one per push, on a branch URL such as `all-in-capital-git-<branch>-abc-49e3.vercel.app` | Only signed-in members of the Vercel team (Vercel Authentication, Standard Protection) |
| `main` | **Integration branch.** Changes arrive only through pull requests with green CI (GitHub ruleset) | **Preview** at `all-in-capital-git-main-abc-49e3.vercel.app` | Only signed-in team members |
| `production` | **The only release branch.** It moves only by deliberate fast-forward to a commit already on `main` | **Production**, assigned to `all-in-capital.vercel.app` | Everyone (public demo) |

**Preview vs Production.**
- A Preview deployment is a protected build of a branch, for checking a change before it is released.
- A Production deployment is the build that the public domain `all-in-capital.vercel.app` points at.
- Vercel's Deployments list labels each one, and exactly one Production deployment is marked **Current**.
- The project has no environment variables, so both kinds run the same demo-mode code with the mock evaluator.

**Transition status.**
- The `production` branch was created at `05bb255`, the commit live when it was created.
- Until the Vercel production branch setting is changed from `main` to `production` (Settings → Environments → Production → Branch Tracking), every push to `main` still goes live. Treat merges to `main` as releases until then.

## Releasing

A release is a fast-forward of `production` to a commit that is already on `main` and passed CI in its pull request. Never release a commit that is not on `main`, and never edit `production` directly.

1. Pick the commit and check it is on `main`:

   ```bash
   git fetch origin
   ```

   ```bash
   git merge-base --is-ancestor <sha> origin/main && echo "on main"
   ```

2. Check that the commit's pull request had green **App** and **Database** checks, and preview it on the protected `main` Preview URL.
3. Fast-forward `production`. A plain push, never `--force`; the ruleset refuses anything that is not a fast-forward:

   ```bash
   git push origin <sha>:refs/heads/production
   ```

## Verifying a release

1. Vercel → Deployments: the newest deployment shows **Production**, branch `production`, the released commit, status **Ready**, and **Current**.
2. Its Domains list includes `all-in-capital.vercel.app`.
3. The public site works:
   - `https://all-in-capital.vercel.app/` loads the overview with the 10 case applications (the first visit seeds them in the browser);
   - `https://all-in-capital.vercel.app/api/health` returns `{"ok":true,...}` with `"mode":"demo"`.
4. GitHub shows a successful **Vercel** status on that commit.

## Rolling back

- **Preferred: roll forward.**
  1. Revert the bad change on `main` through a normal pull request with green CI.
  2. Release that revert commit as above.

  `production` only ever moves forward, so its history is the release record.
- **Emergency: Vercel Instant Rollback.**
  1. Vercel → Deployments → the previous good Production deployment → **Instant Rollback**.
  2. This switches the domain back immediately without a build.
  3. Vercel then stops automatically assigning the domain to new production deployments, so after the fix is released, check that the newest Production deployment is **Current**. If it is not, promote it from its deployment page.

  On the Hobby plan, rollback may be limited to the previous production deployment, and deployment retention deletes old deployments. Do not rely on older ones.
- **Never** move `production` backwards, force-push or delete it. The ruleset blocks this.

## Setting up Vercel from scratch (demo mode, no configuration)

1. On vercel.com: **Add New → Project → Import** the repository. Framework preset: Next.js. Root directory: repository root. No environment variables are required.
2. Settings → Environments → Production → Branch Tracking: set the branch to `production`, and keep **Auto-assign Custom Production Domains** enabled.
3. Settings → Deployment Protection: keep **Vercel Authentication** with **Standard Protection**, so previews stay private.

Do not deploy with `vercel --prod` from a laptop: it bypasses the reviewed `main` → `production` path.

**Free-tier note:** Vercel Hobby is for personal, non-commercial use. It suits this MBA prototype but must not be used as commercial production hosting. Use a Pro/Team plan for that. Nothing in demo mode needs a paid service.

## Production mode (Supabase) — specified, not wired

1. Create a Supabase project. Disable email sign-ups under Auth → Providers (invite-only).
2. Run `supabase/migrations/0001_schema.sql`, then `0002_rls.sql`, then `supabase/seed.sql`, in the SQL editor or with `supabase db push`.
3. Invite Kushal, Aditya and Riya (Auth → Users → Invite) and insert their `profiles` rows with roles.
4. Set Vercel environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` (server-only).
5. Remaining engineering work (see KNOWN_LIMITATIONS): implement the Supabase adapter behind the workspace functions, the upload-to-private-bucket path, and the server-side job runner (a short-lived route handler that leases `jobs` rows).

Check current Supabase free-tier terms before relying on them. Free projects pause after inactivity.
