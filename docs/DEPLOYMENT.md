# Deployment

## Vercel (demo mode — no configuration)

1. Push this repository to GitHub.
2. On vercel.com: **Add New → Project → Import** the repository. Framework preset: Next.js. Root directory: repository root. No environment variables are required.
3. Deploy. Vercel builds with `next build`, and every push to `main` redeploys the same code.

Or from a terminal:

```bash
npx vercel login
```

```bash
npx vercel --prod
```

Checks after deploy:
- `https://<your-app>.vercel.app/` loads the overview with the 10 case applications (first visit seeds them in the browser).
- `https://<your-app>.vercel.app/api/health` returns `{"ok":true,...}`.

**Free-tier note:** Vercel Hobby is for personal, non-commercial use. It suits this MBA prototype but must not be used as commercial production hosting. Use a Pro/Team plan for that. Nothing in demo mode needs a paid service.

## Production mode (Supabase) — specified, not wired

1. Create a Supabase project. Disable email sign-ups under Auth → Providers (invite-only).
2. Run `supabase/migrations/0001_schema.sql`, then `0002_rls.sql`, then `supabase/seed.sql`, in the SQL editor or with `supabase db push`.
3. Invite Kushal, Aditya and Riya (Auth → Users → Invite) and insert their `profiles` rows with roles.
4. Set Vercel environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` (server-only).
5. Remaining engineering work (see KNOWN_LIMITATIONS): implement the Supabase adapter behind the workspace functions, the upload-to-private-bucket path, and the server-side job runner (a short-lived route handler that leases `jobs` rows).

Check current Supabase free-tier terms before relying on them. Free projects pause after inactivity.
