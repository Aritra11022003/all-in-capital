# Data Quality Report

## Extraction quality

| Check | Result |
|---|---|
| Readable text layer | 24/24 files. No OCR needed. |
| Password-protected | 0 |
| Corrupted | 0 |
| Exact duplicates (SHA-256) | 0 |
| Near-duplicates | Deck vs form for the same company overlap by design. Yatrika's deck repeats its "Our vision" slide (pages 6 and 8). |
| Ligatures | Some forms use `ﬁ`/`ﬂ` glyphs (e.g. "ﬁrms"). The extractor normalises these. |
| Layout | Forms use `Label value` lines. StockSathi's form uses a different header ("INBOUND APPLICATION 1 OF 10") and puts some values on the line after the label. The parser handles both. |
| Page numbering | Decks show a printed slide number that is one higher than the PDF page (cover is unnumbered). Provenance uses **PDF page index**. |

## Deck vs form conflicts found in the supplied batch

These conflicts are the main test of the evidence system. The app shows each one side by side and never picks a winner.

| Company | Deck says | Form says |
|---|---|---|
| StockSathi | 38 retailers onboarded (p5) | 42 retailers onboarded |
| StockSathi | Blended CAC INR 2,860 (p7) | "Our CAC is under INR 2,000" |
| StockSathi | Credit "funded from our own capital for now. NBFC partnership in discussion" (p8) | "Credit is provided through our NBFC partner. We take the first-loss risk." Also "Not registered as an NBFC." |
| CAPilot | 31 paying CA firms (p4) | 24 paying firms + 7 on free trial |
| EarnWise | 3 enterprise clients live (p5) | 1 live, 2 in pilot |
| EarnWise | "Ex-Goldman Sachs. Ex-Google. MBA, IIM Ahmedabad." (p7) | 10-week internship at an investment bank; 5-month vendor contract at a tech company; tier-2 MBA |
| Talkbook | MRR INR 2.1 L (p5) | MRR INR 1.9 L. Also 340 seats × INR 500 = INR 1.7 L, which matches neither. |
| RentRoute | "INR 11 L revenue" (p4) | INR 11 L **gross**; INR 5.5 L net after partner fees |
| Yatrika | "thousands of travellers", "3x growth" (p3) | ~1,300 travellers, 410 bookings; growth not quantified |
| Yatrika | Raise amount not stated | INR 1.2 Cr |

## Gaps that matter for scoring

* **Repeat / retention:** given by GrainKind (cohorts), Yatrika (14%), StockSathi (22 of 38/42), Settlr (NRR). Missing for CareCorner, RentRoute, Talkbook.
* **CAC:** not measured by CAPilot or RentRoute (they say so). EarnWise does not give one.
* **Founder backgrounds:** only from the applicant. All LinkedIn URLs are placeholders.
* **Customer-reported value:** Pumpwise's downtime savings are explicitly "customer-reported, not audited".

## Historical memos

* No dates, so strict point-in-time replay is not possible (see M-04).
* Founder assessments were written after the partner call. They existed at decision time, so they are allowed in point-in-time mode. The "Why we invested/passed" paragraph is the label and is always excluded from model input.
* The partner notes contain hindsight (the Prepnest competitor). This text is blocked from point-in-time replay.

## Partner notes as policy

The notes say they are "not minutes and not a statement of policy". The app treats them as **revealed-thesis evidence** with citations. They are never treated as approved rules. Kushal said explicitly "no" to writing the CampusCredit risk rule down. That rule appears as a revealed pattern, not as a hard filter.
