# All In Capital — Investment Intelligence Platform

A private decision-support platform for **All In Capital**, a Mumbai pre-seed fund (MESA MBA Case 03). It takes a week of inbound applications (pitch decks and application forms) and returns each one:

- extracted with page-level provenance,
- scored criterion by criterion against the fund's thesis (score 1–5, evidence state and confidence),
- with every claim traced to its source,
- with conflicts between documents shown side by side, never silently resolved,
- with what the system could not find out named explicitly,
- checked for overlap against the available portfolio dataset: the seven companies named in the case, **unverified and incomplete**, so "no overlap found" is not a clearance,
- with a suggested next action: take a call, request information, or pass for partner consideration.

**It never decides.** Only Kushal (Principal) records outcomes, and only after opening the application.

> **Demo mode.** The live link needs no login, no database and no API keys. Data lives in your browser.
>
> **What is simulated or not done:**
> - **The evaluator is simulated.** Every score, recommendation and draft comes from a deterministic, rule-based **MockAIProvider** and is labelled *simulated*. No AI model is called.
> - **No external research is performed.** Research tasks list where to look; they stay *not started* until a person logs findings. Nothing is verified against outside sources.
> - **Portfolio data is incomplete.** Only the seven companies named in the case are known, and they are unverified.
> - **Supabase has not been tested against a live project.** The schema and policies are written but have never been run.

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 60 tests: unit, integration, permissions, evaluation, backtesting
npm run build      # production build
```

Node ≥ 20.9. Nothing else is needed: no Python, no local model, no background worker.

## Running a new test case

1. Open **Applications → New intake**, or click **New intake** on the overview.
2. Drop the company's **deck** (PDF/PPTX) and **form** (PDF/DOCX/TXT). For a batch, name files `Company_Deck.pdf` and `Company_Form.pdf` and drop them all at once; they are grouped by company name. You can also **paste** deck and form text.
3. Click **Receive & process**. Status moves Received → Extracting → Research → Evaluation → **Ready for review**, about 20 ms per application.
4. Open the application. The tabs are **Overview** (profile, founders, conflicts, unknowns, decision panel), **Evaluation** (scorecard, cited evidence, stated vs revealed thesis), **Research & evidence**, **Documents** (page text and extracted-field review) and **Activity** (audit trail).
5. **Report** produces the 17-section assessment (print to PDF or download Markdown).

Invalid inputs never crash the app. Empty files, non-PDF content with a `.pdf` name, password-protected or image-only PDFs, legacy `.ppt/.doc`, unsupported types, files over 25 MB, duplicates and near-empty pasted text each get a specific message. Failed files are recorded with processing status **Failed** or **Needs attention**; the decision status stays **Not reviewed**.

There is also a stateless API: `POST /api/process` with `{ "deckText": "...", "formText": "..." }` returns the full structured assessment as JSON. `GET /api/health` reports provider status.

## What is in the box

| Area | Where |
|---|---|
| 11-section navy UI (Overview, Applications, Research, Thesis & Scoring, Portfolio, Reports, Learning, Decisions, Scheduling, Backtesting, Admin) + Login | `src/app/*` |
| Extraction (PDF, PPTX, DOCX, XLSX, CSV, TXT), form parser, validation | `src/lib/engine/extraction` |
| Evidence ledger, metric normaliser, conflict detection (numeric, definition, arithmetic, magnitude, credential, credit-funding) | `src/lib/engine/evidence` |
| AI provider interface, MockAIProvider, external/local adapters (disabled) | `src/lib/engine/evaluation` |
| Thesis (stated + revealed, cited) and proposed rubric | `src/config/thesis.ts` |
| Portfolio dataset (7 known companies, marked unverified) and overlap engine | `src/config/portfolio.ts`, `src/lib/engine/overlap` |
| Research planner (10 workstreams, 7-tier source hierarchy) | `src/lib/engine/research` |
| Backtesting (retrospective vs approximate point-in-time, hindsight guard) | `src/lib/engine/backtest` |
| Workspace domain model: permissions, decisions, corrections, learning rules, scheduling, audit | `src/lib/domain` |
| Supabase schema (25+ tables), RLS, private storage bucket — written, **not yet tested against a live Supabase project** | `supabase/migrations` |
| Tests | `tests/` |
| Docs | `docs/` |

## Supplied case results (simulated)

| Company | Overall | Suggested action | Why (abridged) |
|---|---|---|---|
| Pumpwise | 4.44 | Take a call (Aditya joins only if Kushal grants him access) | Paying customers, field discovery; certification has no milestone plan |
| GrainKind | 4.33 | Take a call | Cohort repeat 31→34→38%; inventory-heavy raise flagged |
| Talkbook | 4.06 | Request info | MRR conflict (2.1 L vs 1.9 L vs seats × price 1.7 L); **possible MeetRecord overlap** |
| StockSathi | 3.89 | Request info | 3 conflicts (38 vs 42 retailers, CAC, who funds credit); owns credit risk |
| Settlr | 3.83 | Pass for consideration | Series A, ₹30 Cr raise — outside the pre-seed mandate |
| CareCorner | 3.72 | Pass for consideration | Healthcare is outside the stated thesis; capex heavy |
| CAPilot | 3.50 | Take a call | Conflict: 31 vs 24 paying firms — resolve on the call |
| Yatrika | 3.39 | Request info | Deck says "thousands of travellers"; form says 1,300 |
| RentRoute | 3.11 | Request info | Gross shown as revenue; card-network rule dependency |
| EarnWise | 2.89 | Pass for consideration | Deck credentials (Ex-Goldman/Google/IIM-A) not supported by form; credit risk not owned |

## Documentation

- [Project inventory](docs/PROJECT_INVENTORY.md) · [Missing materials](docs/MISSING_MATERIALS.md) · [Data quality](docs/DATA_QUALITY_REPORT.md)
- [Architecture](docs/ARCHITECTURE.md) · [Implementation plan](docs/IMPLEMENTATION_PLAN.md) · [Assumptions & decisions](docs/ASSUMPTIONS_AND_DECISIONS.md)
- [Data dictionary](docs/data-dictionary/DATA_DICTIONARY.md) · [Security](docs/SECURITY.md) · [Deployment](docs/DEPLOYMENT.md)
- [User guide](docs/user-guide/USER_GUIDE.md) · [Testing](docs/TESTING.md) · [Known limitations](docs/KNOWN_LIMITATIONS.md) · [Demo script](docs/DEMO_SCRIPT.md)

## Data notice

Raw case PDFs are **not** in this repository (`data/` is git-ignored). The demo batch is loaded from text derived from them in `src/data/seed/`. Set `NEXT_PUBLIC_LOAD_CASE_SEED=false` to start empty.

## Credits

- India map geometry on the Overview: [`@svg-maps/india`](https://github.com/VictorCazanave/svg-maps/tree/master/packages/india) by Victor Cazanave, licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Used unmodified as path data; city pins are placed by the app.
