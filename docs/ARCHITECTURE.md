# Architecture

A modular monolith: one Next.js app and one pure TypeScript engine. Both the UI and the API call the same engine.

```
Browser (Next.js client)                          Vercel (Next.js server)
┌───────────────────────────────────────────┐    ┌──────────────────────────────┐
│ UI: 11 sections, role switcher            │    │ /api/health                  │
│ Store (zustand, versioned localStorage)   │    │ /api/process  (text → JSON)  │
│ Job queue (concurrency 1, retry)          │    │ uses the same engine         │
│      │                                    │    └──────────────────────────────┘
│      ▼                                    │
│ engine/extraction  PDF·PPTX·DOCX·XLSX·CSV·TXT → pages with provenance
│ engine/extraction  form parser → extracted_fields (label, value, page)
│ engine/evidence    claims + metric normaliser → conflicts (side by side)
│ engine/research    10 workstreams → research_tasks (provider: none)
│ engine/evaluation  AIProvider interface → MockAIProvider (rule-based)
│                    thesis vN + criteria vN + approved learning rules
│ engine/overlap     portfolio dataset vN → possible conflicts, always
│                    "incomplete" while dataset unverified
│ engine/reports     17-section report (Markdown / print)
│ engine/backtest    12 memos, retrospective vs approx. point-in-time
│ domain/permissions can(role, action) → used by every store mutation
└───────────────────────────────────────────┘
Production mode (specified, not wired): Supabase Postgres + Auth + RLS + private Storage
```

## Key flows

1. **Intake.** Riya drops a deck and a form, or pastes text. Each file is validated: type, size, empty file, SHA-256 duplicate. A job is enqueued.
2. **Processing.** The job moves Received → Extracting → Research queued → Evaluation in progress → Ready for review. Any failure sets **Failed** or **Needs attention**. The *decision* status never changes on a technical failure.
3. **Evidence.** Every extracted field and metric becomes a claim with source document, page and original text. Claims are `applicant-provided` until a human attaches independent evidence. Deck and form values for the same metric are compared. Disagreements become `conflicting` pairs.
4. **Evaluation.** The provider returns, per criterion: score (1–5 or null), evidence state, confidence, supporting and opposing claim IDs, unknowns and rationale. Learning rules that were approved and match the application are applied and listed.
5. **Review.** Riya corrects scores. Each correction needs a one-line reason, and the original is kept. She sends the application to partner review. Aditya comments on deeptech. Kushal records the outcome. A call outcome produces proposed slots and an `.ics` file.

## Separation of statuses

`processing_status` and `decision_status` are separate fields with separate enums. Only `recordDecision()` can change `decision_status`, and only Kushal can call it.

## AI provider interface

```ts
interface AIProvider { id; label; simulated: boolean; available(): ProviderStatus;
  evaluate(input: EvaluationInput): Promise<EvaluationOutput>; }
```
* `MockAIProvider`: default. Deterministic and stamped as simulated.
* `ExternalLLMProvider`: stub that reports *not configured* unless `AI_PROVIDER_API_KEY` is set server-side. It is never called with documents unless an admin enables it.
* `LocalAIProvider`: stub that reports *disabled*. The app never downloads models.

## Folder map

| Spec path | Implemented at |
|---|---|
| apps/web/app, components, lib, styles | `src/app`, `src/components`, `src/lib`, `src/app/globals.css` |
| workers/processing, extraction, research, evaluation, reports | `src/lib/engine/{jobs,extraction,research,evaluation,reports}` |
| packages/shared/schemas, types, constants | `src/lib/shared/{types,constants}` |
| supabase/migrations, seed | `supabase/migrations`, `supabase/seed.sql` |
| config/thesis, evaluation, research | `src/config/thesis.ts`, `src/config/portfolio.ts`, research tiers in `src/lib/engine/research/plan.ts` |
| tests/unit, integration, permissions, evaluation, backtesting | `tests/*` |
