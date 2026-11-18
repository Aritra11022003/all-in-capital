# Data Dictionary

The canonical schema is `supabase/migrations/0001_schema.sql`. The demo store (`src/lib/domain/workspace.ts`) holds the same entities in browser storage. TypeScript types are in `src/lib/shared/types.ts`.

| # | Table | Purpose | Key fields | Integrity rules |
|---|---|---|---|---|
| 1 | `profiles` | Team members (invite-only) | `id` = auth user, `role` ∈ kushal/aditya/riya, `active` | 1:1 with `auth.users` |
| 2 | `companies` | A company, independent of any application | `name` (unique, case-insensitive), `legal_name`, `website`, `location`, `incorporated` | One company → many applications |
| 3 | `founders` | People | `name`, `background`, `profile_url` | — |
| 4 | `company_founders` | Founder ↔ company link | `role_title`, `source_label` (e.g. "Form p1") | PK (company, founder) |
| 5 | `applications` | One submission | `processing_status`, `decision_status` (separate enums), `sector_selected` vs `sector_key`, `tags`, `raise_inr`, `errors[]`, `current_cycle_id` | Trigger blocks any decision change during a processing failure |
| 6 | `application_cycles` | Review cycles; reopening creates a new one | `number`, `reason`, `opened_by`, `closed_at` | Unique (application, number) |
| — | `application_views` | Proves who opened an application | (application, user), `first_viewed_at` | Required before Kushal can decide (RLS) |
| 7 | `documents` | Uploaded file metadata | `original_filename`, `kind`, `size_bytes`, `sha256`, `storage_path`, `extraction_method`, `status`, `error`, `uploaded_by/at` | sha256 format check; duplicate lookup index |
| — | `document_pages` | Extracted text per page/slide | (document, `page_index`), `text` | Provenance anchor for every claim |
| 8 | `extracted_fields` | Structured fields | `field`, `label`, `value` (null = not found), `original_value`, `original_text`, `page`, `method`, `validation`, `confidence`, `edited_by` | Values are never invented; human edits keep the original |
| 9 | `claims` | Each statement or metric | `text`, `metric`, `value`, `bound`, `period`, `source_document_id`, `page`, `excerpt`, `classification`, `criteria[]` | Must point to a stored document |
| 10 | `evidence_sources` | Evidence ledger entries | `source_type` (7-tier hierarchy), `title`, `publisher`, `url`, `published_at`, `retrieved_at`, `excerpt`, `location`, `direction`, `verification`, `independent`, `criteria[]`, `reviewer_notes`, `added_by` | URL must be http(s) |
| 11 | `claim_evidence` | Many-to-many claim ↔ evidence | (claim, evidence) | — |
| — | `conflicts` | Disagreements between sources | `type`, `metric`, `side_a`, `side_b`, `severity`, `status`, `resolution_note` | Both sides always stored; never auto-resolved |
| 12 | `research_tasks` | Research per workstream | `workstream`, `question`, `priority`, `status`, `suggested_sources`, `sources_examined[]`, `findings`, `unanswered[]`, `failure_reason`, `reviewer_status`, `provider_note` | Answered needs findings and sources; blocked or inaccessible needs a reason |
| 13 | `thesis_versions` | Stated + revealed thesis | `stated` (JSON), `revealed` (patterns with citations), `status` | Versioned |
| 14 | `criteria_versions` | Rubric | `criteria` (definition, weight, missing-metric policy), `status`, `approved_by` | At most one approved |
| 15 | `evaluations` | One AI run | `cycle_id`, `thesis_version_id`, `criteria_version_id`, `portfolio_dataset_version`, `provider`, `simulated`, `overall`, `coverage`, `recommendation`, `flags`, `applied_learning_rules` | Linked to cycle and versions |
| 16 | `criterion_assessments` | Per-criterion result | `score` (1–5 or null), `evidence_state`, `confidence`, `supporting/opposing/notes` (signals with claim IDs), `unknowns[]`, `rationale` | Null score only with `insufficient` |
| — | `assessment_evidence` | Relational link assessment → claims | (assessment, claim, direction) | Keeps evidence references queryable |
| 17 | `feedback_corrections` | Human corrections | `original` (AI snapshot), `revised`, `reviewer`, `at`, `reason` (≤240), `category`, `scope`, `approval`, `criteria_version_id`, `provider` | AI assessment is never modified |
| 18 | `learning_rules` | Reusable corrections | `condition` (sectors, keywords), `adjustment` (−1..+1), `status`, `decided_by` | Applies only when approved, to future evaluations |
| 19 | `portfolio_companies` (+ `portfolio_datasets`) | Portfolio by dataset version | `category_terms`, `customer_terms`, `channel_terms`, `source`, `verified` | Dataset versioned; at least one category term |
| 20 | `portfolio_overlap_checks` | Overlap result | `dataset_version`, `dataset_verified`, `compared_count`, `compared_names`, `results`, `status`, `reviewer_decision` | An unverified dataset can never return "no_match_verified" |
| 21 | `partner_decisions` | Final outcomes | `decision`, `pass_reason`, `rationale`, `decided_by`, `decided_at`, `recommendation_at_time`, `evaluation_id`, `cycle_id` | A pass needs a reason; Kushal only (RLS) |
| 22 | `availability_rules` | Manual availability | `person`, `weekday`, `start_time`, `end_time` | start < end |
| 23 | `meeting_slots` | Proposed / confirmed calls | `starts_at`, `ends_at`, `attendees`, `status`, `calendar_synced` | `calendar_synced` stays false without a connected calendar |
| 24 | `audit_events` | Append-only log | `at`, `actor`, `action`, `entity`, `entity_id`, `application_id`, `detail` | No update/delete policy |
| 25 | `jobs` | DB-backed queue | `type`, `status`, `step`, `attempts`, `locked_until`, `error` | Short-lived worker leases |

## Status vocabularies

- **Processing:** received, extracting, research_queued, research_in_progress, evaluation_queued, evaluation_in_progress, ready_for_review, failed, needs_attention.
- **Decision:** not_reviewed, awaiting_partner_review, information_requested, on_hold, call_approved, passed_by_partner, reopened.
- **Evidence class:** applicant_provided, independent, corroborated (2+ independent supporting sources), conflicting, unverified, inaccessible.
- **Evidence state (per criterion):** strong, mixed, weak, insufficient, conflicting.
