# Release status

**Status: demo-ready with disclosed limitations.** The prototype is **not independently validated** and **not production-ready**.

Last updated after P4 (code commit `8468737`). Evaluation suite results hash `660326f9d4f0fd49`, identical on two full runs; `npm run eval` exits 0 with no kill criterion fired.

## What each kind of evidence shows

| Kind of evidence | Status | What it does and does not establish |
|---|---|---|
| **Automated checks** | Passing | Unit tests (60/60), typecheck, lint, build and every gating and calibration suite pass deterministically: app 29/29, adversarial 48/48, regression 25/25, data-integrity 101 decided. This shows the code behaves as specified on the committed fixtures and the frozen seed baselines. It does not show that the judgements are right for real applications. |
| **Simulated case-study roles** | Used in tests only | Riya (Associate), Kushal (Principal) and Aditya (Partner) are fictional roles from the All In Capital case study. Tests use them to exercise permissions, audit trails, restorations, evidence logging and decision controls. No test action by these roles is a human decision or sign-off. |
| **Independent human validation** | Not done | No independent person has reviewed the system's outputs or written test material for it. The two open items are listed below. |

## Open items

1. **DI-16, human review pending.** Two flag-only seed findings need human confirmation:
   - EarnWise team size 5 (form) vs 12 (deck): possible definition discrepancy.
   - Yatrika ₹1.2 Cr raise stated only in the form: one-sided information.

   Neither affects any score or recommendation, and the automated parts of DI-16 pass. The case's reviewers are fictional, so no genuine sign-off exists. No verdict has been recorded or invented, and the check stays `needs_review` (review hash `6031e5654d5ddda4`). This is a review limitation, not a failed automated check.
2. **ADV-16, no independent detection rate.** The 6/6 result on the reworded-instruction set is exploratory and optimistic: the outcome-statement detector was written after the set's one miss was seen. That sentence remains in the set unchanged. A blind test on a set written by someone who has not seen the detectors is future work.

## Other disclosed limitations

The evaluator is simulated (rule-based `MockAIProvider`; no AI model is called). No external research is performed. The portfolio dataset has seven unverified companies. Supabase has never been run against a live project. Plain-text percentages are not extracted as claims, so the P3 cross-checks cannot see them. Pattern screening can still be evaded by rewording. Full list: [Known limitations](KNOWN_LIMITATIONS.md). Evaluation details: [EVALS §4c–4d](EVALS.md).

## What "demo-ready" means here

The app can be run and demonstrated end to end with the case material: intake, extraction, conflicts, scoring with cited evidence, reviewer controls and reports. Every output is labelled simulated. It must not be used to make real investment decisions.
