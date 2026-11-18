-- All In Capital — canonical schema (production mode). Supabase Postgres.
-- Mirrors src/lib/shared/types.ts. See docs/data-dictionary/DATA_DICTIONARY.md.
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- enums
create type app_role as enum ('kushal', 'aditya', 'riya');
create type processing_status as enum ('received','extracting','research_queued','research_in_progress','evaluation_queued','evaluation_in_progress','ready_for_review','failed','needs_attention');
create type decision_status as enum ('not_reviewed','awaiting_partner_review','information_requested','on_hold','call_approved','passed_by_partner','reopened');
create type doc_kind as enum ('deck','form','other');
create type evidence_class as enum ('applicant_provided','independent','corroborated','conflicting','unverified','inaccessible');
create type criterion_id as enum ('founder_quality','founder_market_fit','market','traction','business_model','product_tech','path_to_market','capital_fit','thesis_fit');
create type evidence_state as enum ('strong','mixed','weak','insufficient','conflicting');
create type confidence_level as enum ('high','medium','low');
create type recommendation as enum ('take_call','request_info','pass_for_consideration');
create type partner_decision_type as enum ('approve_call','request_info','hold','pass');
create type pass_reason as enum ('thesis_mismatch','founder_concern','business_model','capital_mismatch','regulatory_market_risk','insufficient_evidence','other');
create type research_status as enum ('not_started','in_progress','answered','blocked','inaccessible');
create type version_status as enum ('proposed','approved','superseded');

-- ---------------------------------------------------------------- 1. profiles (1:1 with auth.users; invite-only)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role app_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- 2-4. companies, founders
create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  website text,
  location text,
  incorporated text,
  created_at timestamptz not null default now()
);
create unique index companies_name_uq on companies (lower(name));

create table founders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  background text,
  profile_url text,
  created_at timestamptz not null default now()
);

create table company_founders (
  company_id uuid not null references companies(id) on delete cascade,
  founder_id uuid not null references founders(id) on delete cascade,
  role_title text,
  source_label text not null,           -- e.g. "Form p1"
  primary key (company_id, founder_id)
);

-- ---------------------------------------------------------------- 5-6. applications and cycles (one company → many applications → many cycles)
create table applications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  batch_id text not null,
  one_liner text,
  sector_selected text,
  sector_key text not null default 'unknown',
  tags text[] not null default '{}',
  stage text,
  raise_inr numeric check (raise_inr is null or raise_inr >= 0),
  valuation_inr numeric check (valuation_inr is null or valuation_inr >= 0),
  source text,
  processing_status processing_status not null default 'received',
  decision_status decision_status not null default 'not_reviewed',
  current_cycle_id uuid,
  errors text[] not null default '{}',
  warnings text[] not null default '{}',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index applications_company_idx on applications (company_id);
create index applications_status_idx on applications (processing_status, decision_status);

create table application_cycles (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  number int not null check (number >= 1),
  reason text not null,
  opened_by uuid references profiles(id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (application_id, number)
);
alter table applications add constraint applications_current_cycle_fk foreign key (current_cycle_id) references application_cycles(id) deferrable initially deferred;

create table application_views (       -- proves Kushal opened an application before deciding
  application_id uuid not null references applications(id) on delete cascade,
  user_id uuid not null references profiles(id),
  first_viewed_at timestamptz not null default now(),
  primary key (application_id, user_id)
);

-- ---------------------------------------------------------------- 7-8. documents and extracted fields
create table documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  cycle_id uuid not null references application_cycles(id),
  kind doc_kind not null,
  original_filename text not null,
  ext text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text,                     -- private bucket "application-documents"
  extraction_method text,
  status text not null check (status in ('extracted','failed','needs_attention')),
  error text,
  warnings text[] not null default '{}',
  uploaded_by uuid references profiles(id),
  uploaded_at timestamptz not null default now()
);
create index documents_sha_idx on documents (sha256);
create index documents_app_idx on documents (application_id);

create table document_pages (
  document_id uuid not null references documents(id) on delete cascade,
  page_index int not null check (page_index >= 1),
  text text not null,
  primary key (document_id, page_index)
);

create table extracted_fields (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  document_id uuid references documents(id) on delete set null,
  field text not null,
  label text not null,
  value text,                            -- null = not found; never invented
  original_value text,
  original_text text not null default '',
  page int,
  method text not null check (method in ('form-label','deck-pattern','derived')),
  validation text not null check (validation in ('parsed','missing','human_confirmed','human_edited')),
  confidence numeric not null check (confidence between 0 and 1),
  edited_by uuid references profiles(id),
  extracted_at timestamptz not null default now()
);
create index extracted_fields_app_idx on extracted_fields (application_id, field);

-- ---------------------------------------------------------------- 9-11. claims, evidence, links
create table claims (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  cycle_id uuid not null references application_cycles(id),
  text text not null,
  metric text,
  value numeric,
  bound text check (bound in ('eq','lte','gte')),
  unit text,
  period text,
  source_document_id uuid not null references documents(id),
  page int,
  excerpt text not null,
  classification evidence_class not null default 'applicant_provided',
  criteria criterion_id[] not null default '{}'
);
create index claims_app_idx on claims (application_id);

create table evidence_sources (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  source_type text not null,
  title text not null,
  publisher text,
  url text check (url is null or url ~* '^https?://'),
  published_at date,
  retrieved_at timestamptz not null default now(),
  excerpt text not null,
  location text,
  direction text not null check (direction in ('supports','contradicts','context')),
  verification evidence_class not null,
  independent boolean not null,
  criteria criterion_id[] not null default '{}',
  reviewer_notes text,
  research_task_id uuid,
  added_by uuid references profiles(id)
);

create table claim_evidence (
  claim_id uuid not null references claims(id) on delete cascade,
  evidence_id uuid not null references evidence_sources(id) on delete cascade,
  primary key (claim_id, evidence_id)
);

create table conflicts (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  type text not null,
  metric text not null,
  label text not null,
  claim_a uuid references claims(id),
  claim_b uuid references claims(id),
  side_a jsonb not null,                 -- display, source label, excerpt (both sides always kept)
  side_b jsonb not null,
  note text not null,
  severity text not null check (severity in ('high','medium','low')),
  status text not null default 'open' check (status in ('open','explained','confirmed')),
  resolution_note text,
  resolved_by uuid references profiles(id),
  criteria criterion_id[] not null default '{}'
);

-- ---------------------------------------------------------------- 12. research tasks
create table research_tasks (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  workstream text not null,
  question text not null,
  priority text not null check (priority in ('high','medium','low')),
  status research_status not null default 'not_started',
  suggested_sources jsonb not null default '[]',
  sources_examined text[] not null default '{}',
  findings text not null default '',
  unanswered text[] not null default '{}',
  conflicts text not null default '',
  failure_reason text,
  retrieved_at timestamptz,
  reviewer_status text not null default 'pending' check (reviewer_status in ('pending','reviewed')),
  provider_note text not null,
  check (status <> 'answered' or (length(findings) > 0 and cardinality(sources_examined) > 0)),
  check (status not in ('blocked','inaccessible') or failure_reason is not null)
);
alter table evidence_sources add constraint evidence_task_fk foreign key (research_task_id) references research_tasks(id) on delete set null;

-- ---------------------------------------------------------------- 13-14. thesis and criteria versions
create table thesis_versions (
  id text primary key,
  version int not null unique,
  status version_status not null,
  stated jsonb not null,
  revealed jsonb not null,               -- patterns with citations
  change_note text not null,
  created_by uuid references profiles(id),
  approved_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table criteria_versions (
  id text primary key,
  version int not null unique,
  status version_status not null,
  criteria jsonb not null,               -- id, name, definition, weight, missing-metric policy
  change_note text not null,
  created_by uuid references profiles(id),
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index one_approved_criteria on criteria_versions ((status)) where status = 'approved';

-- ---------------------------------------------------------------- 15-16. evaluations and criterion assessments
create table evaluations (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  cycle_id uuid not null references application_cycles(id),
  thesis_version_id text not null references thesis_versions(id),
  criteria_version_id text not null references criteria_versions(id),
  portfolio_dataset_version text not null,
  provider text not null,
  provider_label text not null,
  simulated boolean not null,
  overall numeric check (overall is null or overall between 1 and 5),
  coverage numeric not null check (coverage between 0 and 1),
  recommendation recommendation not null,
  recommendation_reasons text[] not null,
  flags jsonb not null default '[]',
  stated_thesis jsonb not null,
  revealed_thesis jsonb not null,
  applied_learning_rules text[] not null default '{}',
  critical_unknowns text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index evaluations_app_idx on evaluations (application_id, created_at desc);

create table criterion_assessments (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references evaluations(id) on delete cascade,
  criterion criterion_id not null,
  score numeric check (score is null or score between 1 and 5),   -- null = insufficient evidence (not zero)
  evidence_state evidence_state not null,
  confidence confidence_level not null,
  supporting jsonb not null default '[]',   -- signals with claim_id + source label
  opposing jsonb not null default '[]',
  notes jsonb not null default '[]',
  unknowns text[] not null default '{}',
  rationale text not null,
  applied_rules text[] not null default '{}',
  unique (evaluation_id, criterion),
  check (score is not null or evidence_state = 'insufficient')
);

create table assessment_evidence (       -- relational link from assessments to cited claims
  assessment_id uuid not null references criterion_assessments(id) on delete cascade,
  claim_id uuid not null references claims(id),
  direction text not null check (direction in ('supporting','opposing','note')),
  primary key (assessment_id, claim_id, direction)
);

-- ---------------------------------------------------------------- 17-18. feedback and learning
create table feedback_corrections (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  evaluation_id uuid not null references evaluations(id),
  criterion criterion_id not null,
  original jsonb not null,               -- AI assessment snapshot (never modified)
  revised jsonb not null,
  reviewer uuid not null references profiles(id),
  at timestamptz not null default now(),
  reason text not null check (length(reason) between 1 and 240),
  category text not null,
  scope text not null check (scope in ('case_specific','reusable')),
  approval text not null check (approval in ('not_required','pending','approved','rejected')),
  criteria_version_id text not null references criteria_versions(id),
  provider text not null,
  learning_rule_id text
);

create table learning_rules (
  id text primary key,
  version int not null default 1,
  source_correction_id uuid not null references feedback_corrections(id),
  criterion criterion_id not null,
  condition jsonb not null,
  adjustment numeric not null check (adjustment between -1 and 1),
  note text not null,
  status version_status not null default 'proposed',
  proposed_by uuid not null references profiles(id),
  proposed_at timestamptz not null default now(),
  decided_by uuid references profiles(id),
  decided_at timestamptz
);

-- ---------------------------------------------------------------- 19-20. portfolio and overlap
create table portfolio_datasets (
  version text primary key,
  verified boolean not null default false,
  note text not null,
  created_at timestamptz not null default now()
);

create table portfolio_companies (
  id uuid primary key default gen_random_uuid(),
  dataset_version text not null references portfolio_datasets(version) on delete cascade,
  name text not null,
  sector text,
  description text,
  category_terms text[] not null check (cardinality(category_terms) > 0),
  customer_terms text[] not null default '{}',
  channel_terms text[] not null default '{}',
  source text not null,
  verified boolean not null default false,
  unique (dataset_version, name)
);

create table portfolio_overlap_checks (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  dataset_version text not null references portfolio_datasets(version),
  dataset_verified boolean not null,
  compared_count int not null,
  compared_names text[] not null,
  results jsonb not null default '[]',
  status text not null check (status in ('possible_conflicts','no_match_incomplete','no_match_verified')),
  status_text text not null,
  reviewer_decision text not null default 'pending' check (reviewer_decision in ('pending','confirmed_conflict','false_alarm')),
  reviewed_by uuid references profiles(id),
  review_note text,
  checked_at timestamptz not null default now(),
  check (dataset_verified or status <> 'no_match_verified')   -- incomplete data can never be "clear"
);

-- ---------------------------------------------------------------- 21. partner decisions
create table partner_decisions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  cycle_id uuid not null references application_cycles(id),
  decision partner_decision_type not null,
  pass_reason pass_reason,
  rationale text not null check (length(rationale) > 0),
  decided_by uuid not null references profiles(id),
  decided_at timestamptz not null default now(),
  recommendation_at_time recommendation,
  evaluation_id uuid references evaluations(id),
  check (decision <> 'pass' or pass_reason is not null)
);

-- ---------------------------------------------------------------- 22-23. scheduling
create table availability_rules (
  id uuid primary key default gen_random_uuid(),
  person app_role not null,
  weekday int not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  active boolean not null default true,
  check (start_time < end_time)
);

create table meeting_slots (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  attendees app_role[] not null,
  status text not null check (status in ('proposed','confirmed_manual','cancelled')),
  calendar_synced boolean not null default false,   -- true only when a connected calendar confirms
  notes text not null default '',
  created_by uuid references profiles(id),
  confirmed_by uuid references profiles(id),
  check (ends_at > starts_at)
);

-- ---------------------------------------------------------------- 24-25. audit and jobs
create table audit_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid references profiles(id),     -- null = system
  action text not null,
  entity text not null,
  entity_id text not null,
  application_id uuid references applications(id) on delete set null,
  detail text not null
);
create index audit_app_idx on audit_events (application_id, at desc);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  type text not null check (type in ('process_application','reevaluate')),
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed')),
  step text not null default 'queued',
  attempts int not null default 0,
  locked_until timestamptz,              -- short-lived worker lease (Vercel function)
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index jobs_queue_idx on jobs (status, created_at) where status in ('queued','running');

-- A technical failure must never set a decision.
create or replace function guard_decision_on_failure() returns trigger language plpgsql as $$
begin
  if new.processing_status = 'failed' and new.decision_status is distinct from old.decision_status then
    raise exception 'decision_status cannot change as part of a processing failure';
  end if;
  return new;
end $$;
create trigger applications_failure_guard before update on applications for each row execute function guard_decision_on_failure();
