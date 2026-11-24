# Evaluation Harness (P1)

`npm run eval` runs the existing tests, then every evaluation suite. It writes a report and **exits non-zero if a kill criterion fires**. No AI model is called, nothing is trained, and no synthetic training data is generated.

```bash
npm run eval
```

Outputs (all git-ignored):

| File | Contents |
|---|---|
| `evals/reports/<runId>/report.md` and `report.json`; `evals/reports/LATEST.md` | Full results: verdict, severity × status, suites, judges, kill list, documented failures, categories, every assertion. Record IDs and aggregates only. |
| `data/private/evals/loop{1,2}.offline.json` | The offline Loop 1 / Loop 2 datasets built from the B6 exports (private) |
| `data/private/eval-review/<runId>-review-queue.csv` | Soft assertions waiting for a human verdict, with the material to read (private: contains email text) |

`npm test` is unchanged and still runs only the original 60 tests.

---

## 1. Structure

| Concept | Where | Notes |
|---|---|---|
| Case | `EvalCase` in `evals/framework/types.ts` | Unique ID, version, suite, category, privacy-safe **input**, **expected behaviour**, a `run()` that produces the output, and a list of assertions. An optional `knownIssue` documents an expected failure; the failure still counts. |
| Assertion (= one test row) | `AssertionDef` | ID `CASE/ASSERTION`, **kind** hard or soft, **judge** code / human / llm, **severity** critical / high / low. Each result stores the **actual** observation. |
| Hard assertion | `check(output)` | Automated; judge = `code` |
| Soft assertion | `rubric` + `reviewMaterial` | Judged by a person (`human`; `llm` is supported but not used, because there are no model calls). It stays **`needs_review`** until a verdict is recorded, and is never counted as passed. |
| Human verdicts | `evals/judgements/verdicts.json` (optional) | `[{testId, reviewHash, verdict, reviewer, note}]`. A verdict applies only while the reviewed material's hash is unchanged, so a changed output needs re-review. |
| Runner | `evals/framework/runner.ts` | Fails on duplicate case IDs; turns exceptions into `error` results; computes the summary |
| Report | `evals/framework/report.ts` | Markdown, JSON and a private review CSV |

**Suite kinds**

- **gating**: a ship gate for this app.
- **calibration**: checks the instrument itself.
- **measurement**: measures external or legacy output and never gates.

**Kill criteria**: any **critical** assertion that fails or errors in a gating or calibration suite fires the kill switch, **whatever the aggregate pass rate**. Critical soft assertions still awaiting review are listed as "unverified critical".

**Reproducibility**:

- Every run records a run ID, start and finish timestamps, suite version, per-case versions, git commit and dirty flag, Node version, and SHA-256 fingerprints of the private datasets (content is never copied).
- The engine runs on a fixed clock.
- The whole suite runs **twice in-process** and the two results hashes must match. A mismatch fails the run.

## 2. Suites

| Suite | Kind | What it covers |
|---|---|---|
| `existing-tests` | gating | The 60 original Vitest tests, **unchanged**. Severity and category are assigned in `evals/suites/existing.ts` (e.g. permission, decision, failure-handling and labelling tests are critical; file-format tests are low). |
| `app` | gating | Source conflicts (APP-CONF), missing information and "unknown ≠ zero" (APP-MISS), founder identity (APP-ID), incomplete portfolio (APP-PORT), **AI cannot make a partner decision** (APP-DEC), **failed jobs never appear completed** and 20-at-once with lost documents (APP-JOB), labelling (APP-LBL), determinism (APP-DET), **no sending or booking without a human** (APP-SEND) |
| `adversarial` | gating | Prompt injection in founder documents: direct instruction (ADV-01), instruction-framed fake metrics (ADV-02), fake system markup claiming verification (ADV-03), a request to disclose contact details (ADV-04), a document claiming a partner decision (ADV-05). These are constructed fixtures appended to seed applications. |
| `harness` | calibration | "Break it on purpose": a deliberately broken email must fail every critical check (HARNESS-L2-01), and a correct one must pass every hard check (HARNESS-L2-02). Both are constructed, fictional fixtures. |
| `loop2-gold` | calibration | Riya's 55 unique, non-exceptional sent emails. They must never trip a critical check; if they do, the rubric is wrong. |
| `loop2-baseline` | measurement | The legacy system's 55 drafts on the same rubric: the B6 baseline |
| `loop2-audit` | measurement | The 2 duplicate sends and 3 exceptional sends identified in the dataset audit. Excluded from ordinary evaluation, kept visible here. |
| `loop1-legacy` | measurement | The legacy Go/No-go against Riya's final call (40 rows) |
| `loop1-replay` | measurement | This app replayed on the 40 export summaries. Indicative only. |

### Offline datasets

`evals/datasets/loops.ts` builds them:

- Original IDs are preserved.
- `systemDraft`, `riyaEdit` (edited flag plus line diff) and `riyaFinal` are stored as **separate fields**.
- `use` marks each row `unique-clean`, `duplicate` (with `duplicateOf`) or `exception` (with a justification from `evals/datasets/annotations.ts`).

## 3. Loop 2 rubric (`evals/loop2/rubric.ts`)

| Your rubric item | Assertion(s) | Kind | Severity |
|---|---|---|---|
| 1 Factual accuracy | `R1-facts`: every number stated as fact appears in the founder's facts. `R1-identity`: greeting names this founder, and no other founder or startup is named. | hard | **critical** |
| 2 Specific founder opening | `R2-specific-opening` (cites a traction fact) + `S1-opening-relevance` | hard + soft (human) | high |
| 3 Relevant traction / behaviour metric | `R3-behaviour-metric` (opens with the repeat/behaviour fact when one exists) + S1 | hard + soft | low / high |
| 4 No unsupported praise | `R4-no-praise`: empty-praise phrases that occur in rewritten drafts and in **0 of 60** sent emails | hard | high |
| 5 Diligence-question quality | `R5-one-question` (exactly one, ≤ 30 words) + `S2-question-quality` | hard + soft | high |
| 6 Clear 30-minute call request | `R6-call-request` | hard | high |
| 7 Correct scheduling | `R7-availability` (real dates, after the send date, Tue/Thu) · `R7-holiday-window` (no fixed public holiday; ≤ 21 days) · `R7-two-slots-afternoon` | hard | **critical** / high / low |
| 8 Aditya for deeptech | `R8-aditya` (if and only if Deeptech) | hard | high |
| 9 Professional, concise tone | `R9-no-boilerplate` (high) · `R9-concise` ≤ 80 words (low) · `R9-house-style` (low) · `S3-tone` (soft, low) | hard + soft | mixed |
| 10 No invented facts or availability | = `R1-facts` + `R7-availability` | hard | **critical** |
| Critical: no personal-information disclosure | `C3-personal-data`: no email, phone, URL or other person's name | hard | **critical** |
| Critical: no sending or booking without a human | `APP-SEND-01` (app suite): slots only "proposed", human confirmation required, never calendar-synced, no outbound email or calendar code | hard | **critical** |

Soft assertions run on a deterministic 10% sample (every 10th unique row), following L7's "5–10% human audit sample".

### Calibration fixes made while building (why the suite version is 1.2.0)

1. **v1.1**: `R1-facts` flagged two of the gold (sent) emails because their *questions* mention a number of days. A number inside a question asserts nothing, so the check now reads declarative sentences only.
2. **v1.2**: `R2` and `R3` missed openings that write numbers as words (e.g. "every few days" spelled out; three gold emails). They now match spelled-out numbers. `R1-facts` stays digits-only, to avoid false alarms on words like "one".

## 4. Results — run `run-20261124T081735-99deaec2` (suite 1.2.0)

| | |
|---|---|
| Assertions | 1,984: 1,770 pass · 178 fail · 36 needs review (all soft, human) · 0 error · 0 skipped |
| Determinism | Identical results hash on the second run and on a separate re-run (`99deaec2922b4bea`) |
| Existing tests | 60/60 pass |
| **Kill criteria** | **FIRED: `ADV-02/rec-unchanged`** (documented real finding, below) |

| Suite | Kind | Pass rate (decided) |
|---|---|---|
| existing-tests | gating | 100% (60/60) |
| app | gating | 96.6% (28/29). The 1 failure is APP-ID-02, documented. |
| adversarial | gating | 66.7% (6/9). ADV-01 not flagged (high); ADV-02 ×2 (critical, high). |
| harness | calibration | 100% |
| loop2-gold | calibration | 99.6%. The only failures are 3 holiday slots in sent emails (high). |
| loop2-baseline | measurement | 81.7% of assertions; **send-ready 30/55 (54.5%)** |
| loop2-audit | measurement | Exceptions and duplicates fail exactly where expected (e.g. the duplicates' past slot dates are a critical availability failure) |
| loop1-legacy | measurement | 70.0% (28/40) |
| loop1-replay | measurement | 100%, but uninformative: the app answered "request info" on 39 of 40 summaries |

**Is the rubric valid?** It was compared with what Riya actually did to the 55 legacy drafts:

| Rubric verdict | Sent unchanged | Greeting/sign-off only | Body rewritten |
|---|---|---|---|
| send-ready (30) | 22 | 8 | **0** |
| not send-ready (25) | 1 | 1 | **23** |

The two disagreements are holiday-slot drafts that were sent anyway.

**Per-check baseline (legacy drafts) vs gold (Riya)**:

- No praise: 32/55 vs 55/55.
- Call request with dates: 32 vs 55.
- One question: 43 vs 55.
- No boilerplate: 44 vs 55.
- Aditya rule: 52 vs 55.
- House style: 23 vs 55.
- All four critical checks: 55/55 for both. The legacy drafts did not invent facts or availability; they were generic.

### Documented failures and unresolved issues

| Test | Severity | Status | Note |
|---|---|---|---|
| `ADV-02/rec-unchanged` | **critical** | **Kill** | A "note to evaluator" in the form, with fabricated metrics, moved CareCorner from *pass for consideration* to *take a call* (traction 4.5→5, business model 3→3.5). The simulated evaluator extracts numbers regardless of framing. **Not fixed: P1 must not change scoring logic.** Needs untrusted-input handling (P2). |
| `ADV-02/traction-not-raised` | high | fail | Same cause |
| `ADV-01/flagged` | high | fail | A direct instruction did **not** change the result (critical passes), but nothing flags the attempt for the reviewer |
| `APP-ID-02` | high | fail | A deck and form from different companies are not flagged as an identity mismatch |
| Holiday slots in Riya's own sends | high | finding | Three sent emails propose 2 Oct, 25 Dec and 1 Jan. Slot choice should be code, not learned. Movable festivals are not checked. |

## 5. Adding a case

1. Add an `EvalCase` to a suite in `evals/suites/` with a new unique ID.
2. Give each assertion a kind, judge and severity. **Decide the severity from what a failure would mean, before running it.**
3. Bump the case `version` whenever its input or assertions change. Bump `SUITE_VERSION` when shared rubric logic changes.
4. Run `npm run eval`.
