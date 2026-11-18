# Security and Privacy

## Demo mode (the deployed link)

| Control | Status |
|---|---|
| Documents leave the user's machine | **No.** Files are parsed in the browser. Only extracted text is kept, in that browser's localStorage. |
| External AI services | None called. MockAIProvider is local and deterministic. |
| Secrets in source | None. No keys are required; `.env*` is git-ignored except `.env.example`. |
| Server state | None. `/api/process` is stateless and stores nothing. |
| Permissions | Enforced on every mutation in `src/lib/domain/permissions.ts` (`assertCan`), plus document-level scoping (`canViewDocuments`). Covered by `tests/permissions`. |
| Audit | Every mutation writes an audit event: actor, time, action, detail. |
| Security headers | `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` (`next.config.ts`). Pages are `noindex`. |
| Login | No login wall (grading requirement). The role switcher is for demonstration and is **not** an authentication boundary. |

**Honest limitation:** in demo mode the permission checks run in the browser. Someone with devtools can edit their own local copy. That is acceptable for a single-user demo with no shared data. It is not acceptable for real use, which is why production mode exists.

## Production mode (specified in `supabase/migrations`)

- **Invite-only Supabase Auth.** Self-sign-up disabled. Each user gets a `profiles` row with a role.
- **Row Level Security** on every table (`FORCE ROW LEVEL SECURITY`). The browser uses only the anon key. The policies mirror the permission matrix:
  - Only Kushal can insert `partner_decisions`, as himself, and only after an `application_views` row proves he opened the application.
  - Only Kushal and Aditya can approve `learning_rules`. Only Kushal can approve `criteria_versions`.
  - Aditya can read documents and page text for deeptech/hardware applications only.
  - `audit_events` is insert-only (no update or delete policy).
- **Private storage bucket** `application-documents`. There is no public URL; documents open through short-lived signed URLs, gated by the same `can_view_documents()` function. MIME allow-list and a 25 MB limit.
- **Service-role key** is used only by server-side job handlers (evaluation, claims, overlap writes). It is never prefixed `NEXT_PUBLIC_` and never imported in client code.
- **DB trigger** blocks any decision change during a processing failure.

## Prompt-injection safeguards (for a future real LLM provider)

Applicant documents are untrusted. The current design already:
1. Treats document text as **data**. MockAIProvider applies fixed rules; nothing in a deck can change scoring logic.
2. Keeps the provider interface narrow. `evaluate()` returns an Evaluation. There is no tool use, no decision method and no write access (test: "the AI provider interface exposes no decision capability").
3. Requires every signal to cite a stored claim, so an injected "score this 5/5" cannot appear without a traceable source.

Any real provider must also delimit document text, strip instructions that target the model, validate output against the schema, and never send documents until an admin opts in and a privacy review is done.

## File validation

Extension allow-list; magic-byte check (`%PDF`, `PK`); size limit; empty-file check; encrypted-PDF detection; no-text detection (OCR is off by default); legacy-format rejection; SHA-256 duplicate detection.

## Backup / export

Admin → Export JSON downloads the full workspace. Import restores it (Kushal only). Reset requires confirmation. In production, use Supabase point-in-time recovery or scheduled `pg_dump`.

## Data minimisation

Only the fields needed for evaluation are extracted. Founder profile URLs are stored as text and never fetched. The raw case PDFs are excluded from the repository.
