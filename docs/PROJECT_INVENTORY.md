# Project Inventory — Phase 0

Audit date: 2026-11-18. Every file below was opened and its text extracted page-by-page (pypdf for the audit, `unpdf` inside the app). No file was password-protected, corrupted or image-only. SHA-256 prefixes are recorded so duplicate uploads can be detected.

Raw case files live in `data/` and are **git-ignored** (they are course materials). The app ships with text derived from them in `src/data/seed/` (see `ASSUMPTIONS_AND_DECISIONS.md`, D-07).

## Environment inspected

| Item | Value |
|---|---|
| OS | macOS (Darwin 24.5), 16 GB RAM, ~80 GB free |
| Node / npm | v24.21.0 / 11.19.0 |
| Framework | Next.js 16.4.6, React 19.3, TypeScript 5, Tailwind CSS 4.3 |
| Python | system python3 with pypdf (audit only, not an app dependency) |
| GitHub CLI | installed and authenticated |
| Vercel CLI / Supabase CLI | not installed (not required; see deployment doc) |
| Local AI models | none installed, none required |

## Case documents (24 files)

| # | Path | Type | Bytes | SHA-256 | Pages/slides | Role in system |
|---|---|---|---|---|---|---|
| 1 | data/other/MESA_T2_Case 03_All in Capital.pdf | PDF | 78,552 | 9c731ba515c9 | 2 | Case brief (fund, roles, the ask) |
| 2 | data/other/All_In_Capital_Build_Component_Map.pptx | PPTX | 31,969 | b52807648eef | 1 slide | Build component map (14 components, review gates) |
| 3 | data/deal_memos/MESA_T2_Case 03_Deal Memos.pdf | PDF | 135,398 | 5b35c1d1737c | 6 | 12 historical deal memos (6 invested, 6 passed) |
| 4 | data/meeting_notes/MESA_T2_Case 03_Partner Meeting Notes.pdf | PDF | 103,301 | a5ec113025e5 | 5 | 5 partner meetings (Riya's informal notes) |
| 5–24 | data/applications/*_Deck.pdf, *_Form.pdf | PDF | 29–101 KB | see below | 8–11 / 2–3 | 10 inbound applications, deck + form each |

### Inbound applications

| Company | Deck (pages) | Form (pages) | Form sector | Stage | Raise |
|---|---|---|---|---|---|
| StockSathi | 11 | 3 | Consumer tech | Pre-seed | INR 2 Cr |
| CAPilot | 9 | 2 | Fintech | Pre-seed | INR 1.5 Cr |
| CareCorner | 8 | 2 | Other (Healthcare) | Pre-seed | INR 3 Cr |
| EarnWise | 8 | 2 | Fintech | Pre-seed | INR 2 Cr |
| GrainKind | 10 | 2 | Consumer brands | Pre-seed | INR 2.5 Cr |
| Pumpwise | 11 | 2 | Deeptech | Pre-seed | INR 2.2 Cr |
| RentRoute | 9 | 2 | Fintech | Pre-seed | INR 1.8 Cr |
| Settlr | 9 | 2 | Fintech | **Series A** | **INR 30 Cr** |
| Talkbook | 10 | 2 | Consumer tech | Pre-seed | INR 2 Cr |
| Yatrika | 10 | 2 | Consumer tech | Pre-seed | Deck: not stated · Form: INR 1.2 Cr |

### Historical deals (from the memo pack)

| # | Company | Sector | Source | Decision |
|---|---|---|---|---|
| 1 | The ePlane Company | Deeptech (aerial mobility) | Warm intro, Fund I network | Invested |
| 2 | Petalry | Consumer brand (D2C beauty) | Public form | Passed |
| 3 | Unbox Robotics | Deeptech (warehouse robotics) | Warm intro, co-investor | Invested |
| 4 | HopBox | Consumer tech (10-min delivery) | Warm intro | Passed |
| 5 | Wint Wealth | Fintech (bonds) | Founder referral | Invested |
| 6 | CampusCredit | Fintech (student credit) | Public form | Passed |
| 7 | Giva | Consumer brand (jewellery) | Public form | Invested |
| 8 | AeroDrop | Deeptech (drone delivery) | Warm intro | Passed |
| 9 | SuperK | Consumer tech (small-town retail) | Warm intro, Fund I founder | Invested |
| 10 | Coinlane | Web3 (crypto) | Public form | Passed |
| 11 | Jai Kisan | Fintech (rural credit) | Warm intro | Invested |
| 12 | Prepnest | Consumer tech (exam prep) | Warm intro | Passed |

## Files excluded from the case dataset

`~/Downloads` also contains `MESA_Case 03_Problem Statement.pdf`. It describes a different case (Aangan Studio, phone enquiries) and was **excluded**. Other MESA course files in Downloads were not imported.
