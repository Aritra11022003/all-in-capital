# Evaluation Harness (P1)

`npm run eval` runs the existing tests, then every evaluation suite. It writes a report and **exits non-zero if a kill criterion fires**. No AI model is called, nothing is trained, and no synthetic training data is generated.

```bash
npm run eval
```

Outputs (all git-ignored):

| File | Contents |
|---|---|
| `evals/reports/<runId>/report.md` and `report.json`; `evals/reports/LATEST.md` | Full results: verdict, severity × status, suites, judges, kill list, documented failures, categories, every assertion. Record IDs and aggregates only. |
| `data/private/evals/loop{1,2}.offline.json` | The offline Loop 1 / Loop 2 datasets built from the B6 exports (private). Written **only** by `npm run eval:review-queue` (`EVAL_WRITE_PRIVATE=1`); a normal `npm run eval` reads `data/private` and writes nothing there. |
| `data/private/eval-review/<runId>-review-queue.csv` | Soft assertions waiting for a human verdict, with the material to read (private: contains email text). Written **only** by `npm run eval:review-queue`. It is a reading list, never a source of verdicts. |

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
| `adversarial` | gating | Prompt injection in founder documents. ADV-01 to ADV-05 (P1): direct instruction, instruction-framed fake metrics, fake markup, contact-detail request, fake decision. ADV-06 to ADV-15 (P2): citation integrity, hypothetical figures, page-boundary absorption, disguised characters, learning-rule triggering, the same attack on re-evaluation, contact-detail leakage, founder text widening access (P-C), role/access requests. Constructed fixtures appended to seed applications. |
| `regression` | gating | P2 guards: REG-01 seed batch vs the current frozen baseline (`evals/baseline/seed-baseline.v2.json`, v2) and zero false positives; REG-06 v1 (`seed-baseline.json`) matches the SHA-256 recorded in v2, then v2 differs from v1 only by approved changes; REG-07 baselines cannot be overwritten and a missing or modified v1 is detected; REG-02 genuine caveats not screened; DIST-01 plain claims not treated as instructions and cited exactly; REG-04 `/api/process` statuses; REG-05 scoring weights and recommendation thresholds unchanged (vs v2); REST-01 audited reviewer restoration, never verified. |
| `data-integrity` | gating | P3 (`evals/suites/p3.ts`): DI-01 to DI-16 — identity, founders, roles, raise/valuation (all values, within one document), founded vs incorporated, stage, as-of updates, periods and units, location, team size, re-checks after human edits and P2 restorations, resolution carry-over, one-sided facts, no score change on the seeds; EXG-01/EXG-02 extraction guards (GrainKind ₹380, RentRoute market sizing). |
| `residual-risks` | measurement | Accepted, deferred risks kept visible: ADV-13 plain false claims (P-B deferred); ADV-16 held-out reworded instructions (detection rate). |
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

## 4. Results — P2 (suite 1.3.0, two identical runs, results hash `ceb32d98…`)

| | |
|---|---|
| Assertions | 2,020 + held-out (see below); **no kill criterion fired**; `npm run eval` exits 0 |
| Determinism | Two separate runs gave identical results hashes |
| Existing tests | 60/60 pass. Test 13 and the Pumpwise scheduling assertion were updated for the approved P-C policy (access and call attendance now need Kushal's explicit grant). |
| ADV-02 | **Passes because the vulnerability is fixed.** Same assertions, same severity, no application-specific exception. |

| Suite | Kind | Result |
|---|---|---|
| existing-tests | gating | 60/60 |
| app | gating | 28/29. APP-ID-02 (deck/form identity mismatch) is still a documented high failure, out of P2 scope. |
| adversarial | gating | **30/30** (ADV-01 to ADV-12, ADV-14, ADV-15) |
| regression | gating | **14/14**: seed batch identical to the pre-P2 baseline (one intended P-C wording change on Pumpwise's deeptech flag); 0 false positives |
| residual-risks | measurement | ADV-13 fails (plain claims flip CareCorner; P-B deferred). ADV-16: 5/6 held-out paraphrases detected (0/6 before the v2 detector families). **Optimistic:** the same author wrote the held-out set and then designed the v2 families knowing it, so this is not an independent estimate. A truly unseen set (e.g. written by someone else) is needed for a fair rate. |
| harness, loop2-gold, loop2-baseline, loop2-audit, loop1-legacy, loop1-replay | — | Unchanged from P1 |

**Screening precision**:
- Set aside on real text: 0 of 10 seed applications; 0 of 40 Loop 1 summaries; 0 of 60 Loop 2 founder fact sets; 0 of 120 Loop 2 emails (drafts and finals).
- Benign probes: 13/15 clean. The 2 flagged were planning statements with figures ("we assume 3% churn", "imagine 10,000 clinics"), set aside as *hypothetical* by design: visible and restorable.

**Baseline** (as of P2): v1 was captured with `npm run eval:baseline`. Since P3, baselines are versioned and that command only writes a new version file; it never overwrites one (see §4b).

## 4b. Results — P3 (results hash `d1cf375b…`, identical on two full runs; `npm run eval` exits 0)

| Suite | Result |
|---|---|
| existing-tests | 60/60 (unchanged tests) |
| app | **29/29** — APP-ID-02 now passes (identity is compared across documents) |
| adversarial | 30/30 |
| regression | **18/18** — REG-01 against baseline v2; REG-06 checks v2 differs from v1 only by approved changes |
| data-integrity | All decided assertions pass; **1 item pending human review** (DI-16 review list). No verdict is recorded in `evals/judgements/verdicts.json`, so it stays `needs_review` and is not counted as passed. (Separately, you approved the two findings for the v2 baseline; that approval is not a recorded DI-16 verdict.) |

**Baselines (versioned, frozen):**
- `evals/baseline/seed-baseline.json` — **v1**, captured at `aec236a` before P2. Unchanged; used by REG-06 (lineage) and DI-16 (pre-P3 comparison).
- `evals/baseline/seed-baseline.v2.json` — **v2**, the current baseline (REG-01, REG-05). Captured from an **uncommitted** working tree based on `783c5e9`; `source` records the HEAD commit, `workingTreeClean: false` and a checksum of the changes. Identical to v1 except two approved flag-only seed conflicts and the approved P-C flag wording:
  - EarnWise: team size 5 vs 12, possible definition discrepancy (the form counts outsourced developers), medium.
  - Yatrika: raise INR 1.2 Cr stated only in the form, one-sided information, low.

**History rewrite before public release.** Before the first push, the five local commits were rebuilt so that no committed version contains private wording (record IDs, row-level paraphrases or copied phrases from the B6 exports; see the dataset audit). Commit subjects, authorship, dates, code, tests and evaluation behaviour are unchanged, and the frozen baselines are byte-for-byte identical. Old → new commit IDs: `001c7e9` → `74d0c1c` (P0), `aec236a` → `03a3c4b` (P1), `c056e74` → `5f98bdb` (P2), `783c5e9` → `391202d` (P2.1), `7241e23` → the P3 commit that contains this note. The frozen baselines keep their original provenance fields: v1's `gitCommit: aec236a` and v2's `supersedes` and `source.headCommit: 783c5e9` name the pre-rewrite commits, which are not in the published history; their code matches `03a3c4b` and `391202d` except for documentation and evaluation-annotation wording. v2's `source.diffSha256` was computed against the pre-rewrite tree and cannot be recomputed from published commits; the snapshot content it describes is unaffected (REG-01, REG-06).

`npm run eval:baseline` captures the last entry of `BASELINE_RELEASES` (`evals/baseline/snapshot.ts`) and creates the file atomically (exclusive create): it fails if the file already exists, so no version can be overwritten. A new version needs a new release entry with a new file name, and explicit approval. v2 records v1's SHA-256 (`supersedesSha256`), which REG-06 verifies before comparing. Capture also records `source` provenance (HEAD commit, whether the tree was clean, and a checksum of any uncommitted changes) and never labels an uncommitted tree as a commit.

## 5. Adding a case

1. Add an `EvalCase` to a suite in `evals/suites/` with a new unique ID.
2. Give each assertion a kind, judge and severity. **Decide the severity from what a failure would mean, before running it.**
3. Bump the case `version` whenever its input or assertions change. Bump `SUITE_VERSION` when shared rubric logic changes.
4. Run `npm run eval`.
