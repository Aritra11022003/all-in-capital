# B6 Training Data Plan — Loop 2 first email

Status: **plan only.** No dataset file has been built, no rows are sealed yet, and **no synthetic data has been generated.**

**Evidence labels**: **[SRC]** verified in source code · **[TEST]** verified by an executed test or script · **[CASE]** derived from supplied case material · **[INF]** inferred or proposed · **[NV]** not yet verified.

---

## 1. Source pool (real examples)

| Step | Rows | IDs affected | Label |
|---|---|---|---|
| Loop 2 export (use the CSV **or** the XLSX, not both: they are identical) | 60 | all rows | [TEST] |
| Drop duplicate sends (keep the earlier row) | −2 | drop the later copy of each of the 2 duplicate pairs | [TEST] |
| Exclude exceptional or off-standard sends | −3 | one final lengthened with fund boilerplate; one formal email with no slots or sign-off; one with an instruction instead of a question | [TEST] [INF] |
| **Clean real examples** | **55** | 23 unchanged; 9 greeting/sign-off only; 23 full rewrites of generic drafts | [TEST] |
| Kept, but slot dates masked | (3) | 3 rows propose public-holiday slots | [TEST] |

The excluded rows stay in the evaluation notes as **documented exceptions**. They are not deleted from the raw export.

**Loop 1 is not used for training** (see the Brief). Its 40 rows can feed a separate screening eval later, with the caveat that its inputs are summaries.

---

## 2. Row format (B6 template)

One row is one example, using the columns from `AIC_B6_Training_Data_Template.xlsx`: `example_id, source, set, input, output` **[CASE]**. Two columns are added: `origin_row` (the L2 ID, or blank for synthetic) and `notes`.

**Input layout** (fixed for every row, and the same layout the live app must send) **[INF]**:

```
Founder type: {software|hardware|services}
Sector: {sector}
Stage: {stage}
Background: {founder_background}
Traction: {fact 1}; {fact 2}; {fact 3}

Write the opening line and one diligence question for Riya's first email.
```

Removed from the template's example layout on purpose:

- **Founder name**: the greeting `Hi {first_name}` is filled in by code.
- **Startup name**: not needed. It appears in **0 of 60** of Riya's sent emails but in all 23 generic drafts **[TEST]**.
- **City**: appears in **0 of 60** sent emails **[TEST]**.

This is the "send less" principle (L8), and it keeps personal data out of the training set.

**Output layout:**

```
Opening: {one sentence built on a specific traction fact}
Question: {one diligence question}
```

**Rendered by code, not learned** **[INF]**:

- `Hi {first_name},`
- `{meeting_request}`: one sentence asking for a 30-minute call on `{slot_1}` or `{slot_2}` in the afternoon (wording set by the template, not learned); next Tue/Thu afternoons, skipping public holidays, from `scheduling.ts`
- `{partner_line}`: one sentence saying Aditya will join for the technical discussion, only when Sector = Deeptech, matching all 3 Deeptech rows
- `Riya\nAll In Capital`

To build the output column, the opening and question are extracted from each of Riya's sent emails. For the 23 unchanged rows, they come from the system draft, which equals the sent email.

---

## 3. Split (sealed before any training or synthesis)

| Set | Size | Composition | Rule |
|---|---|---|---|
| **test** | 15 real | ~6 generic-mode rows (where the system failed) and ~9 on-standard; at least 1 Deeptech; at least 1 hardware founder; all 5 sectors | Chosen with a fixed random seed; the IDs and SHA-256 of each row are recorded in a committed manifest; the data stays in `data/private/` |
| **validation** | 8 real | Stratified the same way | Used for early stopping and prompt iteration only |
| **train** | 32 real + synthetic | Remaining clean real rows | Synthetic rows only ever go here |

Leakage rules **[INF]**:

- No synthetic row may be generated from, or paraphrase, a test or validation row. Only train-row *patterns* and fictional fact sets may be used.
- Duplicate pairs were resolved before the split, so the same email cannot sit in two sets.
- The prompt + template baseline is scored on the **same sealed test set** as the fine-tuned model.

---

## 4. Synthetic extension (to about 300 rows; NOT started)

| Rule | Detail |
|---|---|
| Labelling | `source = synthetic` on every row, plus `notes` naming the generation method and reviewer. They are reported separately from real rows. |
| Never misrepresented | Synthetic rows are **never** described as Riya's corrections or as real founders |
| Inputs | Fictional startups and founders; traction facts in the same three-fact pattern (a reach metric, a behaviour/repeat metric, a business-model fact), covering all sectors and founder types, with extra hardware and Deeptech rows (only 4 hardware and 3 Deeptech real rows) |
| Outputs | Written to Riya's standard and checked by the same hard assertions as the test set; a human reviews a sample |
| Ratio risk | ~32 real to ~250 synthetic is heavily synthetic. A model may learn the generator's style rather than Riya's. Mitigate by keeping synthetic outputs close to real train patterns and by judging success **only** on real test rows. |
| Approval | Generation waits for your go-ahead (instruction §5) |

---

## 5. Hard assertions for the eval harness (applied to test outputs)

| # | Assertion | Severity |
|---|---|---|
| 1 | Every number in `Opening` appears in the input's traction facts (no invented facts) | **Critical** (kill) |
| 2 | No praise vocabulary (impressive, exciting, thrilled, congratulations, "caught our eye", "strong start" …) unless the same sentence contains an input fact | **Critical** (kill) |
| 3 | `Question` contains exactly one `?` and no second ask | **Critical** (kill) |
| 4 | Output contains no email address, phone number or URL | **Critical** (kill) |
| 5 | `Opening` uses the behaviour/repeat fact (fact 2) when one exists | High |
| 6 | Opening is 25 words or fewer; question is 25 words or fewer | Low |
| 7 | Soft: the question probes the *quality* of the opening metric (judge from a different model family, plus a 10% blind human sample) | High |

The rendered email is also checked for: two future Tue/Thu slots that are not public holidays (Critical); the Aditya line if and only if Deeptech (Critical); the sign-off (Low).

---

## 6. Privacy and storage

- Training data lives in `data/private/b6-training/`, which is git-ignored. Only the split manifest (row IDs and hashes) and aggregate results are committed **[INF]**.
- Data is pseudonymised before it leaves the machine: no founder name, city or startup name in inputs or outputs **[INF]**.
- Uploading to a free GPU notebook (a third-party service) counts as sharing founder data externally. It needs your approval, and a check against the founder agreement's "no outside parties without consent" clause, even after pseudonymisation **[CASE] [NV]**.
