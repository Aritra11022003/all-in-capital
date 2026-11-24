# Known Limitations

Status key: **Implemented & tested** · **Implemented, manually verified** · **Simulated** · **Specified, not built**.

| Area | Status | Limitation |
|---|---|---|
| AI evaluation | Simulated | MockAIProvider is rule-based. Its keyword signals can miss nuance a partner would catch, and phrasing different from the case documents may produce weaker signals. It reports what it found and labels every output simulated. |
| Untrusted-text screening | Implemented & tested | Pattern-based, sentence-level. Zero false positives on the 10 seed applications and the B6 export text. Rewording can still evade it (held-out paraphrases: 5/6 detected, an optimistic figure because the detectors were designed by the author of that set; a probe set of six other rewordings caught 4/6), and plain false claims are scored as unverified founder claims (policy P-B deferred). Planning assumptions written as "we assume…" with a figure are set aside as hypothetical; they stay visible and restorable. |
| Screening warning on the application header | Implemented | Refreshed on re-evaluation. Detailed per-passage status is in the Documents tab. |
| Document access (P-C) | Implemented & tested | Aditya's access and call attendance come only from Kushal's explicit, audited grant. In demo mode this is enforced in the browser domain layer; production needs the equivalent RLS policy (`application_access_grants`, not yet in the SQL). |
| External research | Not performed | No research provider is configured. All 10 applicant websites and LinkedIn URLs are `.example` placeholders. Research tasks are generated with source targets but stay *not started* until a human logs findings. Source verification rate is 0% by design. |
| Persistence | Implemented (browser) | Demo data lives in one browser's localStorage. It is not shared between users or devices and is lost if site data is cleared. Export JSON to keep it. |
| Supabase production mode | Specified, not built | Schema, RLS and storage policies are written but **not executed against a live project** (no Supabase CLI or Docker available during the build). The data-access adapter, signed-URL uploads and server job runner are not wired. |
| Authentication | Demo only | No login wall (grading requirement). The role switcher is not a security boundary. Invite-only Supabase Auth is specified only. |
| Server-side permission enforcement | Partial | Enforced in the domain layer (tested), which runs in the browser in demo mode. Real server enforcement depends on the RLS policies above. |
| OCR | Not enabled | Image-only PDFs are rejected with a clear message. Optional OCR (e.g. a WASM engine loaded only on demand) is not implemented, to avoid large downloads. |
| Form parsing | Implemented & tested | Tuned to the fund's form template (`Label value` lines, incl. the alternate StockSathi layout). Free-form documents fall back to deck patterns, and unknown fields stay blank. |
| Conflict detection | Implemented & tested | Covers counts with a status (paying/live/onboarded…), money metrics by meaning and period, gross vs net, seats × price, ARR vs MRR, vague magnitudes, deck credentials and credit-funding statements. Other kinds of inconsistency (dates, team size) are not compared. |
| Portfolio | Incomplete data | Only the 7 companies named in the case are known. Every "no match" result carries the incomplete warning until Kushal verifies a full list. Matching is term-based, so false alarms are expected. |
| Backtesting | Implemented & tested | Memos are undated, so point-in-time replay is approximate. The retrospective lexicon is in-sample (written from the same memos), so its agreement overstates reliability. n = 12 cannot establish accuracy. |
| Learning rules | Implemented & tested | Approved rules apply a bounded ±1 adjustment by sector and keyword. They do not change prompts or the rubric. |
| Scheduling | Implemented & tested | No calendar integration. Slots are confirmed by hand and exported as `.ics`. Time zone is fixed to IST. |
| Original files | Not stored in demo | Only extracted text with page provenance is kept. Production mode stores originals in a private bucket. |
| Concurrency | By design | Jobs run one at a time. A page reload during processing marks the in-flight job *Failed* (documents were in memory) and asks for a re-upload. |
| Accessibility | Partial | Keyboard-focusable controls, labelled inputs and accessible contrast. No full WCAG audit. |
| Mobile | Partial | Desktop-first, works on tablet. On phones the sidebar becomes a dropdown and tables scroll horizontally. |
