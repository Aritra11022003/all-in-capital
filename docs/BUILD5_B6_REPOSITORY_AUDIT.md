# Build 5 / B6 — Repository Audit

Audit date: 24 Nov 2026. This is a read-only audit of the existing All In Capital repository. No feature, prompt, schema or provider was changed. The one change made during the audit is listed in §1.

**Evidence labels**: **[SRC]** verified in source code · **[TEST]** verified by an executed test or script · **[CASE]** derived from supplied case material · **[INF]** inferred or proposed · **[NV]** not yet verified.

---

## 1. Repository state and protection

| Item | Finding | Label |
|---|---|---|
| Branch | `main`, tracking `origin/main` (public GitHub repo), in sync before the audit | [TEST] |
| HEAD | `02401b6` "One app-wide 'Evergreen & Brass' palette …". Earlier commits: `b500e77`, `ee300a3` | [TEST] |
| Uncommitted work before the audit | None (clean tree) | [TEST] |
| Change made during the audit | `.gitignore` now also ignores `/data/**/*.csv` and `/data/private/`. Before this, PDFs and XLSX under `data/` were ignored but **CSV files were not**, so the Loop exports (which contain founder names) could have been committed by accident. Not committed yet. | [SRC] [TEST] |
| Case files placed | `data/private/b6-case/` (6 files), `data/private/loop1/` (2), `data/private/loop2/` (2). `git check-ignore` confirms they are ignored; `git status` shows only `.gitignore` modified. | [TEST] |
| Secrets in repo | None. No API keys, no `process.env` reads apart from `NEXT_PUBLIC_LOAD_CASE_SEED`. `.env*` is ignored except `.env.example`, which has empty placeholders. | [SRC] |
| Committed case-derived content | `src/data/seed/applications.json` and `deal_memos.json` hold text extracted from the case PDFs: founder names, LinkedIn URLs on `.example` domains, and one contact address on an `.example` domain. Decision D-07 in `ASSUMPTIONS_AND_DECISIONS.md` is still marked "needs your confirmation". | [SRC] |

---

## 2. Materials inventory

| Material | Location | Status |
|---|---|---|
| MESA_T2-L7_Evals.pdf (39 pp) | `data/private/b6-case/` | Read in full (text). Not attached to your message; copied from Downloads. [TEST] |
| MESA_T2_Case 05 Fine-tuning (3 pp) | `data/private/b6-case/` | Read [TEST] |
| AIC_B6_Operating_Facts (1 p) | `data/private/b6-case/` | Read [TEST] |
| AIC_B6_Training_Data_Template.xlsx | `data/private/b6-case/` | Read (3 sheets) [TEST] |
| MESA_T2-L8 From Prototype to Production (32 pp) | `data/private/b6-case/` | Read in full (text). Slide images were not inspected. [TEST] |
| Case 04 Prototype to Production (2 pp) | `data/private/b6-case/` | Read [TEST] |
| Loop 1 export CSV + XLSX | `data/private/loop1/` | Audited; identical copies [TEST] |
| Loop 2 export CSV + XLSX | `data/private/loop2/` | Audited; identical copies [TEST] |
| 10 decks + 10 forms (20 PDFs) | `data/applications/` | Present (ingested in the original build) [TEST] |
| 12 deal memos | `data/deal_memos/` (one PDF) | Present [TEST] |
| Partner meeting notes | `data/meeting_notes/` | Present [TEST] |
| Case 03 brief, component map | `data/other/` | Present [TEST] |
| Portfolio list | `data/portfolio/` holds a README only | **Missing as a separate file.** The 7 portfolio companies come from case text; the full portfolio is unknown. [TEST] [CASE] |
| **B4 eval results** | not in repo | **Missing.** Case 05 says to "start with the weak spots your B4 evals showed". No B4 artefact exists, so the B6 choice rests on the exports instead. [TEST] [CASE] |
| Remaining ~240 of ~300 sent emails | not supplied | **Missing** [CASE] |
| Unsent drafts (~83 a month) | not supplied | **Missing**: no negative examples [CASE] |
| unsloth notebook catalogue | external URL | Not accessed (no network fetch made) [NV] |

---

## 3. Architecture (verified)

| Layer | Implementation | Label |
|---|---|---|
| Framework | Next.js 16.4.6 App Router, React 19, TypeScript, Tailwind v4 | [SRC] |
| State | Client-side zustand store persisted to **browser localStorage** (`src/lib/store.ts`), versioned (`WORKSPACE_VERSION = 3`) | [SRC] |
| Engine | Pure TypeScript in `src/lib/engine/`: extraction → claims and metrics → conflicts → overlap → research plan → evaluation. It runs in the browser for intake and on the server for `/api/process`. | [SRC] |
| Domain layer | `src/lib/domain/`: workspace mutations, permissions, intake, job runner, scheduling | [SRC] |
| Server routes | `POST /api/process` (stateless, text in → JSON out, 200,000-character cap); `GET /api/health` | [SRC] [TEST] |
| Database | Supabase schema (`0001_schema.sql`, 30 tables) and RLS (`0002_rls.sql`, 29 policies plus private-bucket policies) are **written but not executed or wired** | [SRC] |
| Hosting | Vercel (Hobby), auto-deploys from `main`; live at all-in-capital.vercel.app | [TEST] (checked earlier in this session) |
| Auth | Demo role switcher. No login wall, by grading requirement. | [SRC] |

---

## 4. Feature status

| Feature | Status | Label |
|---|---|---|
| Intake (PDF, PPTX, DOCX, XLSX, CSV, TXT, paste), SHA-256 duplicate check, visible rejection reasons | Implemented and tested | [SRC] [TEST] |
| Field extraction with page provenance; deck vs form conflict detection | Implemented and tested | [SRC] [TEST] |
| 9-criterion evaluation and 3-way recommendation | **Simulated**: deterministic rule-based MockAIProvider | [SRC] [TEST] |
| Stated vs revealed thesis (RP-1 … RP-9) | Implemented (rules) | [SRC] [TEST] |
| Portfolio overlap (7 companies, incomplete warning) | Implemented (term matching) | [SRC] [TEST] |
| Research plan | Tasks generated; **no research is performed** | [SRC] |
| Corrections → learning rules → partner approval | Implemented and tested (bounded ±1) | [SRC] [TEST] |
| Partner decision room (Kushal only; must open the application first) | Implemented and tested | [SRC] [TEST] |
| Scheduling | Proposes Tue/Thu 30-minute slots and exports `.ics`. **No email is sent and no calendar is booked or read.** | [SRC] [TEST] |
| Backtesting on 12 deal memos | Implemented and tested (in-sample warning) | [SRC] [TEST] |
| Report (17 sections), JSON export/import, audit log, failure drill | Implemented | [SRC] |
| **First-email drafting (Loop 2)** | **Not implemented** | [SRC] |
| Reply reading, follow-ups, counter-proposals, two-calendar booking (described in Case 04) | **Not implemented** | [SRC] [CASE] |
| Server-side persistence, server job queue, real auth | Specified in SQL only; not wired | [SRC] |

Case 04 describes a system that "drafts a personalised email … reads the founder's reply … books the meeting in both calendars". This repository does not do those things. The B5 tasks that assume real model calls (Portkey, Langfuse, cost) therefore have nothing to attach to yet **[SRC] [CASE]**.

---

## 5. AI / model providers and every model-call location

| Provider | File | State | Network? | Label |
|---|---|---|---|---|
| `MockAIProvider` ("mock-v1") | `src/lib/engine/evaluation/provider.ts`; logic in `mock.ts` (550 lines of regex and rule signals) | **Active, the only one used.** `activeProvider()` always returns it (`provider.ts:83`). | **No.** In-process function. | [SRC] |
| `ExternalLLMProvider` | `provider.ts` | Stub; `evaluate()` throws "not configured" | No | [SRC] |
| `LocalAIProvider` | `provider.ts` | Disabled stub | No | [SRC] |

Call sites of `activeProvider().evaluate(...)`:

1. `src/lib/engine/process.ts:36`: every new application, from browser intake, the case seed and `/api/process`.
2. `src/lib/domain/runner.ts:89`: re-evaluation of an existing application.

There are **no other model calls**. A repository-wide search finds no `fetch(` to any external host, no AI SDK, and no Portkey or Langfuse code **[SRC]**.

### What the evaluation call receives (relevant to prompt minimisation)

`EvaluationInput` (`provider.ts`) carries `profile`, which includes `bundle.deckText` and `bundle.formText`: the **full extracted deck and form text**. That text includes founder names, LinkedIn URLs and any contact details printed on the form. It also carries all claims, conflicts, the full thesis, the criteria, learning rules and the overlap result **[SRC]**. This causes no exposure today because the mock never leaves the process. If a hosted model adapter were plugged into the same interface unchanged, it would send everything. See the gap analysis, §A.

---

## 6. Prompts

**There are no prompts, prompt templates or prompt versions in the repository** **[SRC]**. The evaluator is code. The versioned artefacts that do exist, and are stamped on every evaluation, are `thesisVersionId` (thesis-v1), `criteriaVersionId` (criteria-v1), `portfolioDatasetVersion` and `provider` ("mock-v1") **[SRC]**. A prompt registry would be new work.

---

## 7. Loop 1 (screening) as implemented here

| Aspect | Case 05 Loop 1 | This repository | Label |
|---|---|---|---|
| Output | One score out of 10; Go or No-go | 9 criteria scored 1–5 (or n/a), evidence state, confidence, overall score; recommendation `take_call` / `request_info` / `pass_for_consideration` | [SRC] [CASE] |
| Human override | Riya overturns the call and writes one line | Riya corrects a **criterion** with a one-line reason (≤ 240 characters), a category and a scope; the original is preserved (Test 9). The final **decision** is Kushal's (`recordDecision`). | [SRC] [TEST] |
| Learning mechanism | Past corrections retrieved into the prompt | A reusable correction proposes a learning rule (sector and keyword condition, ±1 bounded). It needs partner approval (`decideLearningRule`), then applies to future evaluations and is named on them. The past evaluation is unchanged (tested). | [SRC] [TEST] |
| Agreement metric | n/a | "Recommendation agreement" quality indicator (`workspace.ts:689`) | [SRC] |

---

## 8. Loop 2 (first email) as implemented here

**Not present** **[SRC]**. There is no draft generator, no edit capture and no send path. The nearest artefact is `scheduling.ts`, which proposes slots, adds Aditya for deeptech (`attendeesFor`) and builds an `.ics` file. Those rules match what Riya does in the Loop 2 export (Tue/Thu afternoon slots; Aditya for deeptech), so they can be reused when Loop 2 is built **[SRC] [INF]**.

---

## 9. Evaluation and test harness

| Item | Finding | Label |
|---|---|---|
| Suite | Vitest, 5 files, **60 tests, all passing** on 24 Nov 2026 (`npm test`) | [TEST] |
| Other checks run | `npm run typecheck` ✓ · `npm run lint` ✓ · `next build` ✓ (18 routes) | [TEST] |
| Fixed inputs | The 10 case applications (`src/data/seed/applications.json`), 12 deal memos, PDF fixtures (blank, encrypted) | [SRC] |
| Coverage | The 20 required scenarios (conflicts, repeat policy, credentials, credit-risk ownership, overlap, corrections, hindsight-free backtest, permissions, labelling, failure handling, duplicates, unreadable files, citations, reopening, scheduling) | [SRC] [TEST] |
| Hard assertions | Yes: every test is a hard assertion | [SRC] |
| Soft assertions or LLM judge | **None** (nothing generative to judge) | [SRC] |
| Severity tags (critical / high / low) | **None** | [SRC] |
| Kill criteria | **Not encoded.** A single failure fails the Vitest run, which acts as a de-facto kill switch, but there is no severity report and no aggregate pass rate that could hide a critical. | [SRC] [INF] |
| Borderline cases | Some (no-repeat-data non-brand not penalised; incomplete portfolio never "clear"; stage-label artefact) | [SRC] |
| Adversarial / prompt-injection cases | **None** | [SRC] |
| Black-box HTTP harness (the L7 pattern) | **None.** Tests import internal code; the L7 harness talks only to the HTTP endpoint. | [SRC] [CASE] |
| Reproducible | Yes: deterministic, same verdict every run | [TEST] |
| Loop 1 / Loop 2 export evals | **None yet** | [SRC] |

---

## 10. Queue, retry, logging, tracing, cost

| Mechanism | Finding | Label |
|---|---|---|
| Queue | In-browser FIFO, concurrency 1 (`runner.ts:67 drain`). Jobs move `queued → running → succeeded/failed` with an `attempts` counter and duration. | [SRC] |
| Retry | **No automatic retry.** A failed job stays Failed with its reason, and the user re-uploads. A page reload mid-job marks the job Failed with "Interrupted by page reload" (`store.ts:180`), so it is visible, not lost. | [SRC] |
| Server queue | `jobs` table with a `locked_until` lease column exists in SQL but is not wired | [SRC] |
| Rate limiting | **None** on `/api/process` (public, unauthenticated) | [SRC] |
| Logging | Business audit log (`audit()`, `workspace.ts:111`) of human and system actions, stored in the browser. No server logs are written by the app. | [SRC] |
| Tracing | **None** (no Langfuse or OpenTelemetry) | [SRC] |
| Token / cost tracking | **None.** No per-call usage, no ledger, no budget. | [SRC] |

---

## 11. Authentication, permissions, data protection

| Control | Finding | Label |
|---|---|---|
| Role permissions | `can` / `assertCan` (`permissions.ts:65-69`) enforced in the domain layer: only Kushal decides; Aditya sees deeptech documents only; Riya cannot approve rules | [SRC] [TEST] |
| Security boundary | In demo mode the domain layer runs in the browser, so the role switcher is **not** a security boundary (documented) | [SRC] |
| RLS | 29 policies plus a private storage bucket with signed URLs, written but **not executed** against a live project | [SRC] [NV] |
| Document handling | Files are read in the browser; only extracted text is stored, in localStorage. Originals are not kept. Nothing is sent to an AI service. | [SRC] |
| Decision safety | A processing failure never changes decision status (DB trigger in SQL; Test 15 in code) | [SRC] [TEST] |
| Headers | `nosniff`, `Referrer-Policy`, `X-Frame-Options: SAMEORIGIN` | [SRC] |

---

## 12. Supabase, hosting and environment

| Item | Finding | Label |
|---|---|---|
| `.env.example` | `NEXT_PUBLIC_LOAD_CASE_SEED`, empty Supabase URL / anon / service-role placeholders, `AI_PROVIDER=mock`, empty `AI_PROVIDER_API_KEY` | [SRC] |
| Vercel env vars in use | None required | [SRC] |
| Supabase project | None connected | [SRC] |
| Portkey / Langfuse accounts or keys | None in the repo; none created | [SRC] |

---

## 13. Bottom line

The repository is a working, tested **decision-support demo with a simulated evaluator**. For B5 and B6 it lacks three foundations that the case material assumes:

1. Any real model call (and so prompts, tokens and cost).
2. Loop 2 email drafting.
3. Server-side persistence and queueing.

Every B5 integration (Portkey, Langfuse, cost, volume) needs a single server-side model gateway first. See [BUILD5_PRODUCTION_READINESS_GAP_ANALYSIS.md](BUILD5_PRODUCTION_READINESS_GAP_ANALYSIS.md) and [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md).
