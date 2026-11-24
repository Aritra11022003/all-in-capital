# B6 Fine-Tuning Brief — provisional draft

Status: **PROVISIONAL.** Nothing has been trained, generated or deployed. Lines 8 (Stop rule) and 9 (Payback) must be revisited once results exist (Case 05).

**Evidence labels**: **[SRC]** verified in source code · **[TEST]** verified by an executed test or script · **[CASE]** derived from supplied case material · **[INF]** inferred or proposed · **[NV]** not yet verified.

---

## Which step? Loop 2 (first email), not Loop 1 (screening)

I tested the working hypothesis rather than accepting it. Figures are from [B6_DATASET_AUDIT.md](B6_DATASET_AUDIT.md).

| Criterion | Loop 1 screening | Loop 2 first email | Favours |
|---|---|---|---|
| Real examples | 40 rows, 12 corrections | 60 rows: 58 unique, 55 clean | Loop 2 |
| Repeated correction pattern | 12 corrections spread over 10 categories | One dominant rewrite shape (23 rows), plus 9 house-style edits | Loop 2 |
| Clarity of desired output | Low: depends on the current thesis and on facts outside the row (2 summaries contain post-application answers) | High: a written standard ("short, one clear ask, no praise unless backed by a specific fact") and checkable rules | Loop 2 |
| Risk of learning inconsistent behaviour | High: thesis drift (two overturns cite what the fund backs now) and opposite calls on two deeptech applications | Low after removing 2 duplicates and 3 exceptions | Loop 2 |
| Train and run inputs match | No: the export holds summaries, while the live step reads a full deck and form | Yes: the export's input fields are what the drafting step receives | Loop 2 |
| Stakes of an error | High. The fund rule is that nothing is advanced or rejected automatically. | Low. Riya reads and edits every email before sending. | Loop 2 |
| Genuine held-out test set | 40 rows is too few to seal a meaningful test set | 15 real rows can be sealed | Loop 2 |
| Benefit to Riya | Screening takes 30 minutes per application, a large benefit if it worked | Minutes a month (see line 9) | **Loop 1** |
| Training and running cost | Similar | Similar | — |

**Conclusion** **[INF]**: test Loop 2. Do not fine-tune Loop 1. Encoding a moving thesis into model weights would make it harder to see and harder to correct than the current approved-rules-plus-review approach. Loop 1's weak spots (risk ownership, absent metrics, portfolio overlap, credentials over evidence) are better handled by rules, retrieval and evals. This repository already has rules for four of the five.

Caveat: Loop 2's *benefit* is small. The honest expected result may be **"stop: a prompt plus template captures most of the gain"**. Case 05 accepts stopping as a valid outcome.

---

## The Brief

| Line | Question | Provisional answer |
|---|---|---|
| **1. Task** | What is the one job? | Given a founder's startup facts (sector, stage, founder type, background, traction facts), write the **opening sentence and the single diligence question** of Riya's first email, to her standard. Greeting, meeting slots, partner line and sign-off are **deterministic code**, not learned: they are rule-shaped, and three sent emails carry holiday dates. **[INF]** |
| **2. Pass mark** | How good is good enough? | On the sealed, **real-only** test set (n = 15), at least **12/15 (80%) send-ready**. Send-ready means it passes every hard assertion **and** a blind reviewer (Riya, or a different-family judge audited by Riya) would send it with no more than greeting or sign-off edits. **Kill criteria, where one failure fails the run:** (a) a fact not present in the input; (b) praise not tied to a stated fact; (c) more than one question or ask; (d) founder contact details in the output. It must also beat the line-3 prompt baseline by at least 2 of 15 test examples. **[INF]** |
| **3. Baseline today** | What is the score now? | From the export's system drafts **[TEST]**: **25/60 (41.7%) sent unchanged**; 23/58 (39.7%) on unique sends. **34/60 (56.7%) send-ready** (unchanged, or greeting / sign-off edits only). **23/60 (38%) are wholly rewritten** generic-praise drafts. The baseline that matters most is not yet measured: **a prompt + template with no fine-tuning**, scored on the same test set. That must run first **[NV]**. |
| **4. Route** | Who trains it and where does it live? | Training: LoRA supervised fine-tuning on a free GPU notebook (unsloth catalogue) **[CASE]**, run by the builder. Data must be pseudonymised first (no founder names; `{first_name}` placeholder). **Where it lives is unresolved:** the fund has no cloud account and no engineer **[CASE]**. Options: (a) hosted fine-tuning at the fund's existing model-API vendor, if it offers it; (b) a per-token serverless LoRA host; (c) do not deploy (stop). Each new vendor is a new data processor and needs a consent check under the founder agreement **[CASE] [NV]**. **Decision needed from you.** |
| **5. Base model** | Which model do we start from? | A small instruct model in the 7–8B class that the free unsloth notebooks support and whose licence allows commercial use, e.g. a Llama-3.x-8B-Instruct or Qwen-7B-Instruct variant **[INF] [NV]**. Choose by which one can actually be hosted in line 4. If route (a) is chosen, use the vendor's smallest fine-tunable model instead. |
| **6. Data** | Where do examples come from, and how many? | Real: Loop 2 export, **55 clean of 60** (drop the 2 duplicate sends; exclude the 3 exceptions) **[TEST]**. Synthetic: extend to about **300 in total** **[CASE]**, every row labelled `source=synthetic`. They would be generated from **fictional** startup fact sets, never paraphrases of test rows, human-reviewed, and never presented as Riya's corrections. **Not generated yet.** Format: the B6 template (`example_id, source, set, input, output`) using its "email step" layout, with personal fields replaced by placeholders **[CASE] [INF]**. |
| **7. Split** | What do we hold back? | **Test: 15 real rows, sealed** before any training or synthesis. Stratified: about 6 from generic-mode drafts and 9 from on-standard; at least 1 Deeptech and 1 hardware founder; all 5 sectors. Chosen by a fixed seed and recorded by row ID and content hash. **Validation: 8 real rows.** **Train: the remaining 32 real rows plus synthetic.** Synthetic rows never enter test or validation **[INF]**. |
| **8. Stop rule** | When do we give up? | Stop and do not deploy if any of these hold: (1) the prompt + template baseline already meets the line-2 pass mark; (2) after **2 training runs** the model does not beat that baseline by at least 2 of 15, or trips any kill criterion; (3) there is no consent-compliant host whose running cost is below the line-9 saving; (4) more than **₹0** compute spend, or more than **one working day** of build time, is needed without your approval. **[INF]** Revisit after results. |
| **9. Payback** | Is it worth the effort? | See the arithmetic below. Today's saving ceiling is **about 12–22 minutes of Riya's time a month**, worth roughly **₹200–370 a month (₹2,400–4,400 a year)** **[INF]**. Free-GPU training costs ₹0 **[CASE]**. Any hosting with a fixed monthly fee, plus maintenance by a non-technical team, would likely cancel this out. **Provisional verdict: worth running as a cheap experiment; unlikely to be worth deploying unless the host is per-token and the prompt baseline falls short.** Revisit after results. |

---

## Line 9 arithmetic **[CASE] inputs, [INF] calculation**

| Input | Value | Source |
|---|---|---|
| Emails sent | ~17 a month | Operating facts |
| Edit time | ~1 minute when no change is needed; ~4 minutes for a rewrite | Operating facts |
| Today's mix (export) | 34/60 need ~1 minute (unchanged, or style-only edits, assumed ~1 minute); 26/60 are rewrites at ~4 minutes | Dataset audit; the minor-edit time is an assumption |
| Riya's time value | ~₹1,000 an hour, from L8 slide 27 (₹50,000 for ~100 applications at 30 minutes each = 50 hours) | L8 lecture |
| Loop 2 model cost | ₹0.21–1.13 per draft depending on model; ~100 drafts a month ≈ ₹21–113 a month | L8 slide 26 (illustrative prices, not quotes) |

| Scenario | Minutes per sent email | Minutes a month | Saving vs today |
|---|---|---|---|
| Today | (34×1 + 26×4) / 60 = 2.30 | ≈ 39 | — |
| Fine-tuned at the pass mark (80% send-ready) | 0.8×1 + 0.2×4 = 1.60 | ≈ 27 | ≈ 12 minutes ≈ ₹200 a month |
| Perfect (100% send-ready) | 1.00 | ≈ 17 | ≈ 22 minutes ≈ ₹370 a month |

At least 9 of the 35 edits (greeting and sign-off only) and part of the 23 rewrites (slots, partner line) can be removed by templating at no model cost. That is why the prompt + template baseline in line 3 must be measured before any training.

---

## What is needed before training starts

1. Your decision on line 4 (route and host) and on consent for any external processor.
2. The Loop 2 eval harness with hard assertions, run on the export's system drafts to confirm line 3 **[NV]**.
3. A prompt + template baseline built and scored on the sealed test set **[NV]**.
4. The sealed test set (IDs and hashes committed, data kept private). See [B6_TRAINING_DATA_PLAN.md](B6_TRAINING_DATA_PLAN.md).
