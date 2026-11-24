# B6 Dataset Audit — Loop 1 and Loop 2 exports

Audit date: 24 Nov 2026. Scope: the two B6 exports only. No model was run and no synthetic data was created.

**Evidence labels**: **[SRC]** verified in source code · **[TEST]** verified by an executed test or script · **[CASE]** derived from supplied case material · **[INF]** inferred or proposed · **[NV]** not yet verified.

Privacy: this report gives **aggregate counts and patterns only**. It contains no record IDs, no founder or startup names, no contact details, and no row-level paraphrase or quotation of a partner's reasons or emails. The raw exports are stored in `data/private/` (git-ignored, see `.gitignore`) and must stay there. The evaluation harness keeps its few row-level annotations keyed by one-way fingerprints of the private rows (`evals/datasets/annotations.ts`), so they can be matched only by someone who already holds the export.

How the figures were produced: a Node script parsed the CSVs (RFC 4180 quoting, multi-line cells) and the XLSX files (sheet XML via JSZip), then compared them cell by cell. The script lives in the session scratchpad, not the repo. Every figure below came from that run **[TEST]**.

---

## 1. Files and duplication

| File pair | CSV rows | XLSX rows | Headers | Cell differences | Verdict |
|---|---|---|---|---|---|
| `AIC_B6_Loop1_Screening_Export` (.csv / .xlsx) | 40 | 40 (sheet "Loop 1 export") | identical (12 columns) | **0** | Same 40 records twice; use one copy **[TEST]** |
| `AIC_B6_Loop2_Email_Export` (.csv / .xlsx) | 60 | 60 (sheet "Loop 2 export") | identical (12 columns) | **0** | Same 60 records twice; use one copy **[TEST]** |

The first comparison showed apparent differences in cells containing `₹`. They came from the audit script's XML decoder not handling `&#8377;`. After fixing the decoder the copies match exactly. Treat the two formats as one dataset: counting both would double every example.

`AIC_B6_Training_Data_Template.xlsx` has three sheets: an empty "Training data" grid with columns `example_id, source, set, input, output`; "Input layout", with an email-step and a screening-step example; and "How to use" **[TEST]**.

---

## 2. Loop 1 — screening calls

### 2.1 Headline figures

| Measure | Value | Label |
|---|---|---|
| Records | **40**, no duplicate IDs or startups | [TEST] |
| Date range | 2025-05-19 → 2026-10-26, sorted | [TEST] |
| System calls | Go 23 · No-go 17 | [TEST] |
| Final partner calls | Go 19 · No-go 21 | [TEST] |
| **Disagreements** | **12 of 40 (30%)**, agreement 70% | [TEST] |
| System Go → partner No-go | 8 | [TEST] |
| System No-go → partner Go | 4 | [TEST] |
| Overturns with a reason / without | 12 / 0. No reason is ever given on agreements. | [TEST] |
| System threshold | Fully consistent: every Go scores ≥ 6.6, every No-go ≤ 6.4. No row breaks a 6.5 cut-off. | [TEST] |
| Mix | Sector: Fintech 11, Consumer tech 11, Consumer brands 8, Deeptech 5, Commerce infrastructure 5 · Stage: Pre-seed 28, Seed 12 · Founder type: software 31, hardware 6, services 3 | [TEST] |
| Overturns by sector | Consumer tech 4, Fintech 4, Deeptech 2, Consumer brands 1, Commerce infrastructure 1 | [TEST] |

The system is 1.5 times more likely to be too generous (8) than too harsh (4).

### 2.2 Overturns, categorised (aggregate)

Each overturn has one short reason. The categories below are interpretations assigned by reading the reasons; they are not labels from the export **[INF]**. Only categories and counts are published here.

| Category | Overturns | Direction | Maps to an existing app rule |
|---|---|---|---|
| Missing metric should count against the application | 1 | Go → No-go | Consumer-brand repeat policy (Test 2) |
| Deeptech regulatory path undervalued | 1 | No-go → Go | RP-3 regulator-facing milestone plan |
| Portfolio conflict not disclosed in the application | 1 | Go → No-go | Portfolio overlap check (Tests 7 & 8) |
| Credentials weighted over business evidence | 1 | Go → No-go | Credentials recorded, not scored (Test 3) |
| Credit-risk ownership | 2 | one each way | RP-1 risk ownership (Test 6) |
| Thesis drift (what the fund backs now) | 2 | one each way | RP-9 drift (shown, not scored) |
| Capital intensity | 1 | Go → No-go | RP-4 avoid capital-heavy at pre-seed |
| Presentation bias (plain deck, real repeat) | 1 | No-go → Go | (no rule) |
| Founder behaviour (candour about retention) | 1 | Go → No-go | Founder candour signal (partial) |
| Outside thesis / regulatory dependency | 1 | Go → No-go | Stated-thesis exclusion |
| **Total** | **12** | 8 Go → No-go · 4 No-go → Go | |

### 2.3 Recurring judgement errors **[INF]**

1. **Surface signals beat behaviour.** The system rewards pedigree, polish (in reverse: a plain deck is penalised) and technology without a revenue path, and under-rewards repeat behaviour. Five of the 12 overturns turn on repeat or retention.
2. **It does not assess risk ownership.** The two lending overturns go in opposite directions on the same principle: who carries the credit risk.
3. **Absence is treated as neutral.** A missing repeat metric, or a refusal to give one, did not lower the score.
4. **No portfolio check** in the system that produced the export.
5. **The thesis is moving.** Two overturns cite what the fund is backing *now*, and two deeptech applications received opposite calls. Judgement depends on time and context, which is a warning sign for fine-tuning a screening model (see the Brief).

All five already have a rule or signal in this repository's evaluator, except presentation bias. That match is consistent with the case; it is not proof that the app would have made the partner's calls. The app scores 9 criteria from 1 to 5 from full deck and form text, while the export holds only one-paragraph summaries, so the app cannot be replayed on the export as it stands **[SRC] [INF]**.

### 2.4 Data-quality issues

| Issue | Evidence | Impact |
|---|---|---|
| Inputs are summaries, not documents | `application_summary` is one paragraph; the live system reads a deck and a form | A model trained on these inputs would see a different input at run time **[CASE] [INF]** |
| Some summaries contain post-application information | 2 summaries include follow-up facts gathered after the application | Hindsight leakage if used as screening inputs **[TEST] [INF]** |
| Raise amount missing | 30 of 40 summaries never state a raise | Capital-fit cannot be judged **[TEST]** |
| No repeat or retention metric | 19 of 40 summaries | The fund's most-cited signal is often absent **[TEST]** |
| Sector taxonomy differs from the stated thesis | "Commerce infrastructure" (5 rows) is not in the stated sector list | Needs a mapping **[TEST] [CASE]** |
| Reasons only on overturns | 28 agreements carry no rationale | No positive explanations to learn from **[TEST]** |
| Score scale differs from the app | Export: one score out of 10. App: 9 criteria scored 1–5, plus a 3-way recommendation | Not directly comparable **[SRC] [TEST]** |
| Small sample | 40 rows, 12 overturns, 10 distinct reason categories | Too few per category to learn from **[TEST]** |

---

## 3. Loop 2 — first emails

### 3.1 Headline figures

| Measure | Value | Label |
|---|---|---|
| Records | **60**, dates 2025-05-15 → 2026-10-26, sorted | [TEST] |
| **Unchanged** (draft = sent, ignoring trailing whitespace and line-ending differences) | **25** | [TEST] |
| **Edited** | **35** | [TEST] |
| First 10 records | 7 edited, 3 unchanged | [TEST] |
| Duplicate sends | 2 pairs (same founder, startup, facts and text; different send dates). All four are unchanged. | [TEST] |
| Unique sends | **58**: 23 unchanged, 35 edited | [TEST] |
| Edit rate over time | First 30 rows: 17 edited · last 30: 18 edited. No improvement trend. | [TEST] |
| Mix | Fintech 16, Consumer tech 15, Commerce infrastructure 14, Consumer brands 12, Deeptech 3 · software 48, services 8, hardware 4 · Pre-seed 38, Seed 22 | [TEST] |

### 3.2 What changed (edit categories)

The categories come from rule-based comparison of draft against final: greeting line, sign-off block, praise terms, fund boilerplate, generic asks, the opening paragraph, the question paragraph, the meeting slots, and whether the deeptech partner is mentioned **[TEST]**. One email can fall into several categories.

| Category | Edited emails | Note |
|---|---|---|
| Sign-off changed (a generic sign-off → the fund's house sign-off) | 28 | Includes 4 sign-off-only edits |
| Diligence question replaced or added | 24 | |
| Unsupported praise removed | 23 | Every praising draft was rewritten. **0 of 23 survived.** |
| Generic ask replaced (e.g. a "quick chat") | 23 | |
| Factual opening replaced | 23 | |
| Specific meeting request added (two dated 30-minute slots) | 23 | Every generic draft lacked dated slots |
| Fund boilerplate paragraph removed | 11 | |
| Greeting changed (`Hello` → `Hi`) | 6 | Includes 5 greeting-only edits |
| Deeptech partner added | 3 | All 3 Deeptech rows; the partner never appears for other sectors |
| Scheduling changed | 1 | Exceptional (slots removed) |
| Boilerplate **added** in the final | 1 | Exceptional |
| Other | 1 | Exceptional |

### 3.3 The system's failure has two modes **[TEST] [INF]**

| Draft mode | Rows | What happens |
|---|---|---|
| **Generic / praise template** | 23 (38%) | All rewritten in full. 21 of 23 open with the *first* traction fact, usually a reach figure (followers, downloads, sign-ups) or a technical spec. **All 4 hardware-founder drafts and all 3 Deeptech drafts are in this mode.** |
| **On-standard** | 37 (62%) | 25 unchanged, 9 greeting- or sign-off-only edits, 3 exceptional rewrites |

The sent emails open with the *second* traction fact, the behaviour or repeat metric, in 53 of 60 cases **[TEST]**. The standard is stable and machine-checkable: `Hi {first name}`, one factual opening built on a behaviour metric, one diligence question probing that metric, two dated Tue/Thu afternoon 30-minute slots, a partner line for Deeptech, and the fund's house sign-off. The median length is 48 words for both draft and final. The sent emails never name the startup or the city (0 of 60), while all 23 generic drafts name the startup. The greeting uses the founder's first name in 59 of 60 **[TEST]**.

So an edit does not always mean poor quality. Greeting and sign-off edits are house style and can be fixed in a template (code). The genuinely judgement-heavy part is choosing the right fact and writing the question.

### 3.4 Exceptional or inconsistent examples, not to be used as ordinary training examples

| Kind | Count | Recommended handling |
|---|---|---|
| Duplicate sends (the later copy's slot dates fall on or before its own send date) | 2 | Drop the later copy; keep the first |
| Final email lengthened with a fund-boilerplate paragraph, against the "short, one ask" standard | 1 | Exclude from training; keep as a documented exception |
| Formal greeting, no dated slots, no fund sign-off | 1 | Exclude from training; possibly a relationship-specific exception |
| Diligence question replaced by an instruction (the only sent email with no question) | 1 | Exclude from training; record as a tone exception |
| Slots fall on fixed public holidays and were sent that way | 3 | Keep the text; make slot generation deterministic code, never learned; mask dates in training data |

Usable real examples for training or evaluation: 60 − 2 duplicates − 3 exceptions = **55 clean examples** **[TEST] [INF]**.

### 3.5 Other data-quality notes

- **The export holds only 60 of about 300 sent emails** **[CASE]**. The remaining ~240 are not available. Selection bias is unknown **[NV]**.
- **Drafts that were not sent are absent** **[CASE]**. The ~83 drafts a month that are not sent are not in the export, so there are no negative examples.
- **No edit reasons**, by design **[CASE]**. Categories must be inferred, as above.
- **Personal data**: founder names, city and background. No email addresses or phone numbers are in the export **[TEST]**. Names are needed only for the greeting, which a template placeholder can supply.
- **Slot dates**: every weekday matches its date and every slot is on a Tuesday or Thursday **[TEST]**. Only the two duplicates propose past dates.

---

## 4. Summary for decision-making

| | Loop 1 | Loop 2 |
|---|---|---|
| Real examples | 40 (12 corrections) | 60 (58 unique, 55 clean) |
| Correction pattern | 10 categories over 12 rows; context- and time-dependent | One dominant, repeated pattern (23 identical-shape rewrites) plus house-style fixes |
| Clarity of target output | Low: the "right" call depends on the current thesis and on facts outside the row | High: a written standard, checkable rules and 37 on-standard examples |
| Risk of learning inconsistent behaviour | High (thesis drift; opposite deeptech calls) | Low, once the 5 exceptions and 2 duplicates are removed |
| Stakes of an error | High (screening outcome; human must decide) | Low (every email is reviewed before sending) |

The fine-tuning recommendation is in [B6_FINE_TUNING_BRIEF_DRAFT.md](B6_FINE_TUNING_BRIEF_DRAFT.md).
