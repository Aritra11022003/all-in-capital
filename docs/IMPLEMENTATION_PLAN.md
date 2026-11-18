# Implementation Plan

Priority order (from the spec): data correctness → evidence traceability → permissions → evaluation correctness → human decisions → reliability → usability → polish.

| Phase | Scope | Exit test |
|---|---|---|
| 0 | Audit, inventory, missing materials, data quality, architecture, decisions | Docs in `docs/` |
| 1 | Next.js + TS + Tailwind, navy design system, 11-section nav, role switcher, permission module, store, Supabase migrations + RLS | Permission unit tests; build passes |
| 2 | Intake: upload/paste, validation, SHA-256 duplicate detection, extractors (PDF/PPTX/DOCX/XLSX/CSV/TXT), form parser, extraction review | Extractor tests on the 10 real applications plus corrupted, empty, encrypted and wrong-type files |
| 3 | Claims, evidence ledger, metric normaliser, conflict detection, research tasks, manual evidence entry | Conflict tests (CAPilot, StockSathi, EarnWise, Talkbook) |
| 4 | Thesis (stated and revealed), criteria vN, hybrid scorecard, AIProvider + MockAIProvider, reports | Evaluation tests (credentials, repeat rate, founder vs path-to-market, risk ownership, deeptech milestones) |
| 5 | Portfolio dataset vN, overlap checks, partner decision room, audit log | Overlap tests (Talkbook→MeetRecord, incomplete dataset warning) |
| 6 | Corrections (original kept), reusable proposals, approval, versioned learning rules | Correction tests |
| 7 | Availability, slot proposal, manual confirmation, `.ics`, report export | Scheduling tests |
| 8 | Batch queue + monitor, backtesting (retrospective / approx. PIT, hindsight guard, disagreement causes) | Backtest tests |
| 9 | Full pipeline test, error states, docs, limitations, deploy guide | `npm test`, `npm run build`, browser walk-through |
