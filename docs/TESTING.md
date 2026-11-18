# Testing

`npm test` runs 60 tests (Vitest, Node). `npm run typecheck`, `npm run lint` and `npm run build` must also pass.

## Required scenarios → tests

| # | Requirement | Test |
|---|---|---|
| 1 | Deck and form contain conflicting traction numbers | `tests/evaluation` › Test 1 (CAPilot 31 vs 24; full batch conflict list) |
| 2 | Missing repeat metrics affect the appropriate criterion | `tests/evaluation` › Test 2 (consumer-brand policy; no penalty for others) |
| 3 | Founder credentials do not substitute for execution evidence | `tests/evaluation` › Test 3 |
| 4 | Founder quality and path-to-market remain separate | `tests/evaluation` › Test 4 |
| 5 | Deeptech regulatory milestone plans are evaluated | `tests/evaluation` › Test 5 (Pumpwise) |
| 6 | Founders' ownership of credit risk is assessed | `tests/evaluation` › Test 6 (StockSathi vs EarnWise) |
| 7 | Portfolio overlap is detected | `tests/evaluation` › Tests 7 & 8 (Talkbook → MeetRecord) |
| 8 | Incomplete portfolio produces an incomplete result | `tests/evaluation` › Tests 7 & 8 |
| 9 | Corrections preserve original AI assessments | `tests/integration` › Test 9 |
| 10 | Point-in-time backtesting excludes hindsight | `tests/backtesting` › Test 10 (label swap does not change output) |
| 11 | AI recommendations cannot finalise decisions | `tests/permissions` › Test 11 |
| 12 | Kushal sees every application | `tests/permissions` › Test 12 |
| 13 | Users cannot access unauthorised documents | `tests/permissions` › Test 13 |
| 14 | Mock outputs are clearly labelled | `tests/evaluation` › Test 14 |
| 15 | AI failure does not cause false pass/reject states | `tests/integration` › Test 15 |
| 16 | Duplicate uploads are handled safely | `tests/unit` › Test 16 |
| 17 | Unreadable documents generate visible errors | `tests/unit` › Test 17 (empty, corrupt, encrypted, image-only, legacy, oversize) |
| 18 | Source citations link to actual stored evidence | `tests/integration` › Test 18 |
| 19 | Reopening an application preserves history | `tests/integration` › Test 19 |
| 20 | Scheduling does not claim unconfirmed bookings | `tests/integration` › Test 20 |

Also covered: extraction of all 10 supplied applications (identity, raise, stage, founders, provenance), PPTX/DOCX/CSV/TXT extraction, end-to-end batch → decision → slots → 17-section report, and learning rules applying only after approval.

## Manual browser verification (done during build)

- Overview, all 11 sections, login, application detail tabs and the report render without console errors.
- In-browser intake of a real PDF, a duplicate, an empty file, a fake PDF and a legacy `.ppt`, each with the expected message and status.
- Kushal approves a call → three Tue/Thu 14:00 IST slots proposed, marked "not synced".
- `/api/process` returns 200 for a valid case, 422 for empty input and 400 for non-JSON.

No Playwright suite (it downloads ~300 MB of browsers; see D-08).

## Quality indicators (live on the Overview)

Extraction coverage, evidence traceability, source verification rate, conflicts detected/open, critical unknowns, human correction rate, recommendation agreement, processing time, failure rate. Twelve historical cases are too few to claim predictive accuracy, and the app does not.
