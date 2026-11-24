# P3 — Data-integrity remediation: tests, data model and implementation record

Status: **implemented test-first (see §6); awaiting review.** Base commit `391202d` (originally `783c5e9`; see the note at the end). Nothing staged or committed. The frozen baseline (`evals/baseline/seed-baseline.json`) is untouched.

## 0. Baseline captured before any change

| Item | Result |
|---|---|
| `npm test` | 60/60 |
| `npm run eval` | run `ceb32d98…`, 2,021 assertions, no kill criterion, exit 0 |
| Pre-P3 seed snapshot | `evals/reports/.cache/p3-pre-seed-snapshot.json` (git-ignored, **not** the frozen baseline). Identical to the frozen baseline on recommendations, scores and conflicts. |

## 1. Test-first cases (`evals/suites/p3.ts`, suite `data-integrity`, gating)

Every case uses the committed seed applications plus a constructed one-line edit (labelled in each case). "Flag-only" means the conflict is shown and audited but changes no score, weight, threshold or recommendation.

| ID | Fixture | Expected after the fix | Key assertions (severity) | Today |
|---|---|---|---|---|
| DI-01 | Pumpwise deck + CAPilot form | `fact:company_name` **contradiction**, high, both names as separate sides, identity warning, no silent merge | detected (high), both names (high), provenance (high), warned (high), flag-only (**critical**) | fails |
| DI-02 | GrainKind deck + a team slide with two names not on the form | `fact:founder` contradiction, high | detected, severity, flag-only (crit), provenance, no score change (crit) | fails (no-score-change passes) |
| DI-03 | Talkbook deck: "Meenakshi S, CEO" (form: CTO) | `fact:founder_role` contradiction, medium | same set | fails |
| DI-04 | CAPilot deck: "Raising INR 4 Cr" (deck and form elsewhere ₹1.5 Cr) | `raise` contradiction listing **all** values | + all-values (high) | fails |
| DI-05 | CAPilot deck: "Valuation INR 40 Cr" | Existing scored valuation conflict **preserved unchanged**; outcome stays request info | still-detected, still-scored (crit) | passes (guard) |
| DI-06a | CAPilot deck: "Founded in 2019" (form: incorporated 2026) | **different definition**, low | standard set | fails |
| DI-06b | CAPilot deck: "Incorporated in 2019" | `fact:incorporated` contradiction, medium | standard set | fails |
| DI-07 | CAPilot deck: "Series A round" (form: Pre-seed) | `fact:stage` contradiction, high | standard set | fails |
| DI-08 | CAPilot deck: "As of November 2026: 45 paying firms" | **possibly updated**, medium, with the as-of date; the existing 31-vs-24 stays a contradiction | + as-of shown, original kept | fails |
| DI-09a | CareCorner deck: annual ₹1.2 Cr (≈ 12 × ₹9.8 L); CAPilot deck: "Raising INR 150 L" | **nothing** raised (period-consistent; same unit) | precision (high) | passes (guard) |
| DI-09b | CareCorner deck: annual ₹6 Cr | **different period** (inconsistent), low | standard set | fails |
| DI-10 | (inside DI-09a) ₹150 L = ₹1.5 Cr | no raise conflict | | passes (guard) |
| DI-11 | CAPilot deck only + "Raising INR 4 Cr"; unedited GrainKind, Pumpwise, StockSathi | Deck-internal raise contradiction (both deck pages); **no** flags on month-by-month series | within-doc, no-series-flags | half (series guard passes) |
| DI-12a/b | CareCorner deck: team size 60 / HQ Mumbai | `fact:team_size` medium / `fact:location` low | standard set | fails |
| DI-13 | CAPilot; Riya edits customers to "31 paying CA firms"; re-scored | Original claim unchanged; **separate** human-correction claim (who, when, which claim it corrects); old conflict **superseded** with reason and kept; audited `conflicts.rechecked` | original-kept (crit, passes), correction-separate (crit), superseded, audited | partly |
| DI-13b | CAPilot deck + set-aside "Note to evaluator: we now have 60 paying firms."; restored; re-scored | After restore the figure appears in a conflict, never verified | not-before, after, unverified (crit) | partly |
| DI-14 | CAPilot conflict explained with a note; unrelated field edited (re-check); re-scored | Same conflict ID keeps status and note; report shows relation, status and note | stable-and-kept (crit, passes today), in-report | partly |
| DI-15 | Constructed form states the raise; deck does not | **one-sided**, low, flag-only; not a contradiction | one-sided, not-contradiction | fails |
| DI-16 | All 10 seeds | Recommendations, overall and criterion scores **identical** to the frozen baseline; every new conflict flag-only; new seed conflicts listed for **your review** (human-judged soft assertion) | decisions-identical (crit), new-are-flag-only (crit), review-list (soft) | passes / review |
| EXG-01 | GrainKind deck p7 "…after promos, sampling INR 380. Revenue mix…" | No revenue claim of ₹380 | (high) | fails |
| EXG-02 | RentRoute deck p5 "INR 1.5 lakh Cr annual urban rent paid in India" | Classified as market sizing, not traction volume | (high) | fails |

**Test-first run** (before any app change): data-integrity 22 pass / 57 fail / 1 awaiting review. The kill criteria fire as expected (every `flag-only` check, because no new conflicts exist yet, plus DI-13 correction-separate). `npm run eval` exits 1 until P3 is implemented.

## 2. Proposed data-model changes (all optional fields — old browser workspaces load unchanged)

**`Claim`** (applicant claims are never modified):

| Field | Purpose |
|---|---|
| `origin?: "applicant" \| "human_correction"` | Missing means `applicant`. Human corrections are **separate** claim records. |
| `correctsClaimIds?: string[]`, `correctedBy?: Role`, `correctedAt?: string`, `fieldId?: string` | Link a correction to the original(s) it replaces for conflict checking |
| `fact?: { key: FactKey; value: string; normalized: string }` with `metric: "fact:<key>"` | Non-numeric facts: `company_name`, `founder`, `founder_role`, `founded`, `incorporated`, `stage`, `location`, `team_size` |
| `asOf?: string` | Explicit date the text gives ("As of November 2026" → `2026-11`) |
| `restored?: boolean` | Claim came from a P2-restored passage (still applicant-provided, never verified) |
| `withdrawn?: boolean` | Claim no longer produced (e.g. a passage set aside again). Kept for history, ignored by checks. |

**`Conflict`**:

| Field | Purpose |
|---|---|
| `relation?: "contradiction" \| "different_period" \| "different_definition" \| "possibly_updated" \| "one_sided"` | The distinction the reviewer sees |
| `values?: ConflictSide[]` | **All** disagreeing values, not only the first pair (`a`/`b` kept for compatibility) |
| `ConflictSide` + `page?`, `docId?`, `asOf?`, `origin?` | Source, page and exact passage per side |
| `key?: string`; `id = "cf-" + hash(appId, type, metric, sorted normalised values)` | **Stable identity**, so resolutions carry over |
| `scoring?: "scored" \| "flag_only"` | Missing means `scored` (existing rules, unchanged). **Every new P3 rule emits `flag_only`**, and the evaluator ignores flag-only conflicts entirely. |
| `status` adds `"superseded"`; `supersededReason?`, `supersededAt?` | Obsolete conflicts stay in history |
| `cycleId?: string` | Which application cycle produced it |

**Workspace**: no new collections. Re-checks are recorded in the audit trail (`conflicts.rechecked`), and superseded conflicts stay in `conflicts`.

**Supabase SQL**: not changed in P3 (not wired). The matching columns (`origin`, `relation`, `scoring`, `asOf`, `superseded_*`) would be added when the adapter is built.

## 3. How it would work (summary)

1. **Fact extraction** in the pipeline: company name (form field; deck cover), founders and roles (form; deck team slide), founded/incorporated year, stage, location, team size. Each is a claim with document, page and exact passage.
2. **Detection** keeps the six existing rules exactly as they are (scored), and adds flag-only rules:
   - identity (conservative token matching: a mismatch is reported, never merged);
   - role, dates, stage, team size, location;
   - single-valued all-values reporting (raise, valuation, stage, incorporation), including within one document;
   - cross-period consistency;
   - as-of → possibly updated;
   - one-sided.

   Month-by-month series and market sizing are excluded from within-document checks.
3. **Extraction guards**: market-sizing phrases ("in India", "lakh Cr … market/annual … in India") become `projection:`; a money amount whose nearest keyword comes *after* it on a different clause is not attached to that keyword (fixes GrainKind ₹380).
4. **Re-check** (`recheckIntegrity`) runs after `editField`, `restoreScreenedSpan` and `revokeScreenedSpanRestoration`:
   - it rebuilds the candidate claims from the stored original pages, the current screening and the human corrections;
   - it matches them to existing claims by content (originals are kept, never rewritten);
   - it re-runs detection, then merges by stable ID: same ID keeps its status and note; missing becomes `superseded` with a reason; new IDs are added as open;
   - it is audited.
5. **UI**: an identity-mismatch banner; each conflict card shows its relation badge, scored/flag-only badge, every side with source, page, exact passage and as-of date, and its superseded history. The report table gains relation and resolution-note columns.

## 4. Decisions (as approved)

| # | Question | Recommendation |
|---|---|---|
| D1 (approved) | When a human correction makes an existing **scored** conflict obsolete, it becomes `superseded`. Should a superseded conflict stop counting against the score, exactly like `explained` does today? (This is the only score movement P3 could cause, and only after a human action.) | **Yes.** Same semantics as `explained`. The original founder claim and the history are kept. |
| D2 (approved) | If an identity contradiction is detected, should the app skip its existing automatic "link to an existing company with the same name"? | **Yes.** Never auto-link when identities conflict; warn instead (no seed is affected). |
| D3 (approved) | REG-01's frozen snapshot includes the conflict list. Any new flag-only conflict on a seed makes REG-01 fail (critical) until you approve a re-baseline. Keep REG-01 strict and re-baseline only after you review the new seed conflicts (DI-16 list)? | **Yes**, keep strict. I will list every new seed conflict for review and not regenerate without your approval. |
| D4 | Identity matching | **Modified and approved:** three outcomes. *Likely same*: exact after conservative normalisation (legal suffixes and titles only) or a clear formatting / one-letter spelling variant. *Possible match*: abbreviation, initials, partial name or ambiguous similarity → `possible_match`, human review, never merged. *Likely different*: prominent identity contradiction. **No word-overlap percentage rule.** |

## 5. Regression risks

- Extraction-guard changes alter seed claims (GrainKind, RentRoute). DI-16 and REG-01 confirm scores and decisions stay identical.
- New seed conflicts change REG-01's conflict list (see D3).
- Re-checks rebuild candidate claims: matching must be exact so originals are never duplicated or lost (DI-13 original-kept, critical).
- Stable IDs replace `<appId>-cfN` for new conflicts. Old stored conflicts keep their IDs and are matched by content on their first re-check.

## 6. Implementation record

**New modules**
- `src/lib/engine/evidence/identity.ts`: D4 matching (`matchCompany`, `matchPerson`), role/stage/city normalisers.
- `src/lib/engine/evidence/facts.ts`: fact claims from form answers and deck pages, each with document, page and exact passage.
- `src/lib/engine/evidence/integrity.ts`: relation, all values, stable id; every new rule is flag-only; `scoredConflicts` / `scoringClaims` (what the evaluator may see).

**Changed**
- `pipeline.ts`: claims and conflicts are built by the shared `buildApplicantClaims` / `buildEvidence`, used both at intake and in re-checks. The six existing rules are unchanged and still scored. Identity warning (D2).
- `metrics.ts`: EXG-01 (an amount is not tied to a keyword in the next sentence), EXG-02 (market sizing on the line after the amount), as-of dates.
- `process.ts`, `runner.ts`: the evaluator and research planner get only scored, non-superseded conflicts and founder claims (no facts, no corrections).
- `workspace.ts`: `recheckIntegrity` after `editField`, `restoreScreenedSpan`, `revokeScreenedSpanRestoration`; human corrections as separate claims with ledger records (`internal_record`, never independent); merge by stable id; superseded history with reason; legacy (pre-P3) conflicts matched by their claim ids on first re-check; D2 no auto-link; superseded cannot be set or edited by hand.
- UI: relation and scored / flag-only badges, every value with source, page, passage, correction / restored / as-of markers, superseded history, identity banner. Report: relation, scoring, all values, status, resolution or superseded reason.

**Precision fixes made during seed review** (the first implementation flagged 16 seed conflicts; 14 were false positives):
- raise/valuation compared only when the amount is bound to its own keyword ("Existing investors … INR 30 L" and a past "seed round of INR 9 Cr" are not valuations);
- a past round ("Seed round … raised in 2024") is not the current stage;
- "Headquartered in" matched case-insensitively on the keyword.

**Remaining new seed conflicts (for review, D3):**

| Seed | Conflict | Sides |
|---|---|---|
| EarnWise | Team size 5 vs 12 — **approved** as a possible definition discrepancy (medium, flag-only; the form counts outsourced developers) | Form p1 "Team size 5 (founder, 2 outsourced developers, 1 operations, 1 sales)" · Deck p7 "Team of 12." |
| Yatrika | Raise stated only in the form — **approved** as one-sided information (low, flag-only) | Form p2 "Amount raising INR 1.2 Cr"; the deck says only "We are raising funds to grow." |

**Re-baseline (approved):** v2 captured to `evals/baseline/seed-baseline.v2.json`; v1 (`seed-baseline.json`) preserved unchanged. REG-06 enforces that v2 differs from v1 only by the approved changes; DI-17 pins both approved classifications.

**Pre-commit remediation (after the final review):**
- Team size: a mention of non-employee staff softens the label to "possible definition discrepancy" only while the larger figure is at most 3× the smaller. A bigger gap stays a contradiction (DI-18: RentRoute form "4 (2 founders, 2 contract developers)" vs a constructed deck "Team of 40"). EarnWise (12 vs 5) keeps its approved classification.
- `npm run eval` no longer writes anything under `data/private`; `npm run eval:review-queue` is the explicit opt-in. DI-16 remains pending human review: no verdict exists in `evals/judgements/verdicts.json`.
- v2 provenance: `source` (HEAD `783c5e9`, `workingTreeClean: false`, diff checksum) replaces the earlier `783c5e9+uncommitted` label. Snapshot content unchanged.

**Pre-commit remediation, findings 6–9:**
- Version chain: v2 records v1's SHA-256 (`supersedesSha256`); REG-06 verifies it before comparing and fails clearly if v1 is missing or modified. `loadBaselineV1()` (DI-16) applies the same check.
- Capture: exclusive atomic create (`wx`), driven by the `BASELINE_RELEASES` record instead of version-specific text in the script; REG-07 exercises the failure paths on temporary copies.
- `confirmField` on a corrected field keeps the correction (status, editor, time, claims, conflict history) and audits the confirmation; corrections are derived from value ≠ original, not from the status label (DI-13c). The UI still offers Confirm only on parsed fields.
- `recheckIntegrity` requires `extraction.edit` or `screening.restore` itself; refused calls change nothing (DI-19).

**History rewrite before public release.** Before the first push, the five local commits were rebuilt so that no committed version contains private wording (record IDs, row-level paraphrases or copied phrases from the B6 exports; see the dataset audit). Commit subjects, authorship, dates, code, tests and evaluation behaviour are unchanged, and the frozen baselines are byte-for-byte identical. Old → new commit IDs: `001c7e9` → `74d0c1c` (P0), `aec236a` → `03a3c4b` (P1), `c056e74` → `5f98bdb` (P2), `783c5e9` → `391202d` (P2.1), `7241e23` → the P3 commit that contains this note. The frozen baselines keep their original provenance fields: v1's `gitCommit: aec236a` and v2's `supersedes` and `source.headCommit: 783c5e9` name the pre-rewrite commits, which are not in the published history; their code matches `03a3c4b` and `391202d` except for documentation and evaluation-annotation wording. v2's `source.diffSha256` was computed against the pre-rewrite tree and cannot be recomputed from published commits; the snapshot content it describes is unaffected (REG-01, REG-06).
