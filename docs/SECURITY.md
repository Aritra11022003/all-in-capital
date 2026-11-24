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

## Untrusted founder text and prompt injection (P2)

Applicant documents are untrusted. Before P2 the evaluator scored raw document text, so an instruction-framed fake figure could change a recommendation (ADV-02, found by the P1 eval harness). P2 changed this:

1. **Screening before reading** (`src/lib/engine/safety/untrusted.ts`): each document is normalised (hidden and look-alike characters) and split into sentences. Sentences that address the evaluating system, direct the outcome, fake system markup or ask for roles or access are set aside as *possible instructions*. Hypothetical figures are set aside as *hypothetical*. Applied identically on first processing (`pipeline.ts › analyseDocuments`) and on re-evaluation (`profile.ts › profileFromStore`).
2. **Nothing is deleted**: original pages, page numbers and wording are kept; set-aside passages are listed and highlighted in the Documents tab, with a flag on the evaluation. A flag prompts review; it is not proof of bad faith.
3. **Restoring is a reviewer action**: it needs the `screening.restore` permission (Riya or Kushal) and a reason, and is audited (`screening.restored` / `screening.restoration_revoked`). Restored text is scored as an unverified founder claim and is never verified evidence.
4. **Exact citations**: every signal cites the page and the passage that triggered it (`mock.ts › cite`).
5. **No contact details in generated text**: email addresses, phone numbers and links are removed from evaluation and research-task text (`redactContactDetails`). Source documents are untouched.
6. **The provider interface stays narrow**: `evaluate()` returns an Evaluation; there is no tool use, no decision method and no write access.

**Residual risks** (measured in the `residual-risks` eval suite): screening is pattern-based and can be evaded by rewording (ADV-16), and plain false claims are scored as applicant-provided evidence (ADV-13; policy P-B deferred). Any real LLM provider must also send only screened, minimised claims, wrap founder content in tagged untrusted blocks, and validate its output against the schema.

## Access control from identity, not content (P-C)

Document access and call attendance come from the signed-in user's role plus explicit per-application grants (`canViewDocuments`, `hasDocumentGrant`). Kushal and Riya see every application by role. Aditya sees an application's documents, and joins its calls, only after Kushal shares it (`access.grant`, audited). Sector, tags and anything written in a founder's documents never widen access.

## File validation

Extension allow-list; magic-byte check (`%PDF`, `PK`); size limit; empty-file check; encrypted-PDF detection; no-text detection (OCR is off by default); legacy-format rejection; SHA-256 duplicate detection.

## Backup / export

Admin → Export JSON downloads the full workspace. Import restores it (Kushal only). Reset requires confirmation. In production, use Supabase point-in-time recovery or scheduled `pg_dump`.

## Data minimisation

Only the fields needed for evaluation are extracted. Founder profile URLs are stored as text and never fetched. The raw case PDFs are excluded from the repository.
