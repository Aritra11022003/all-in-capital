# Missing Materials

Nothing in this list was invented to fill the gap. Each item shows how the app behaves without it.

| # | Missing item | Evidence it is missing | How the system handles it |
|---|---|---|---|
| M-01 | **Fund portfolio list** | The case says the portfolio "is not given". Only 7 names appear in the materials: ePlane, Unbox Robotics, Wint Wealth, Giva, SuperK, Jai Kisan (invested memos) and MeetRecord (partner notes, meeting 4). | Portfolio dataset v1 contains those 7, marked `verified: false`. Every overlap check shows **"Portfolio overlap check incomplete — portfolio dataset not fully verified."** Admins can add companies, which creates a new dataset version. |
| M-02 | Formal investment thesis, criteria definitions, anti-thesis list | The case says these are not published. | The stated thesis is limited to the public line (pre-seed; fintech, deeptech, consumer tech, consumer brands). The revealed thesis is built from memos and notes, cited by memo number. Weights are **proposed** (thesis v1, status `proposed`), not fund policy. |
| M-03 | Original PPTX decks | The StockSathi form says "Pair with … Application_01_StockSathi_Deck.pptx"; only PDF exports were supplied. | No impact on content. PPTX intake is supported and tested with generated PPTX files. |
| M-04 | Decision dates for the 12 historical deals | No memo is dated. | True point-in-time replay is **not possible**. The replay mode removes decision rationale and post-decision commentary (e.g. the Prepnest note that "a competitor … has since done well") and labels the result "approximate point-in-time". |
| M-05 | Ledgerly memo | Meeting 5: "older, not in the memo pack". | Listed as a known missing deal. It is not included in backtesting. |
| M-06 | AeroDrop/Petalry first-pass scores beyond the notes | Notes give Riya's 7.5 and 6.5 only. | Shown as historical associate scores; not used as ground truth. |
| M-07 | External research for applicants | Websites are `*.example` and LinkedIn URLs end in `-example`; they are placeholders. | Research tasks are generated with source targets but stay **Not started — no research provider configured**. Nothing is marked verified. |
| M-08 | Fund I founder list / warm-intro network | StockSathi says it was introduced "through a founder in your Fund I portfolio" but does not name the founder. | Recorded as an unverified claim with a research task. |
| M-09 | Kushal and Aditya calendars | Not supplied. | Scheduling uses manually kept availability (Tue/Thu afternoons). The app never claims a booking is confirmed by a calendar. |
| M-10 | Hidden test cases | The grader supplies them later. | Intake accepts any PDF/PPTX/DOCX/XLSX/CSV/TXT deck + form, or pasted text. |
