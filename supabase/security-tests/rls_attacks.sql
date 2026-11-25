-- Row Level Security attack and workflow tests (Tasks 0.4 + 0.5). See docs/SECURITY_TESTS.md.
--
-- Runs as `postgres` against the DISPOSABLE local database after all migrations and the seed. Each case switches to a
-- real database role (`authenticated` with a JWT `sub`, `anon`, or `service_role`) and talks to PostgreSQL directly, so
-- RLS, column privileges, triggers and functions are exercised exactly as PostgREST / supabase-js would hit them —
-- not through the app's permission helpers.
--
-- Everything happens inside ONE transaction that is rolled back at the end: identities and records are fictional and
-- never persist. Attack writes are additionally rolled back per case (savepoint), so one attack cannot help another.
--
-- Result per case: PASS / FAIL. The script prints every result and then fails (non-zero exit with ON_ERROR_STOP) if any
-- case failed.

begin;

-- ============================================================================================ harness
create schema rls_test;
grant usage on schema rls_test to anon, authenticated, service_role;

create table rls_test.results (
  n serial primary key,
  id text not null,
  kind text not null check (kind in ('attack', 'workflow')),
  descr text not null,
  passed boolean not null,
  observed text not null
);

-- Fixed fictional identifiers (readable names in test SQL).
create function rls_test.u(name text) returns uuid language sql immutable as $$
  select (case name
    when 'kushal'   then 'a0000000-0000-4000-8000-000000000001'  -- principal (fictional case-study role)
    when 'aditya'   then 'a0000000-0000-4000-8000-000000000002'  -- partner
    when 'riya'     then 'a0000000-0000-4000-8000-000000000003'  -- associate
    when 'inactive' then 'a0000000-0000-4000-8000-000000000004'  -- deactivated associate
    when 'stranger' then 'a0000000-0000-4000-8000-000000000005'  -- signed-in auth user with no profile
    when 'A1'       then 'b0000000-0000-4000-8000-000000000001'  -- deeptech + hardware application
    when 'A2'       then 'b0000000-0000-4000-8000-000000000002'  -- fintech application
    when 'C1'       then 'c0000000-0000-4000-8000-000000000001'
    when 'C2'       then 'c0000000-0000-4000-8000-000000000002'
    when 'CYC1'     then 'd0000000-0000-4000-8000-000000000001'
    when 'CYC2'     then 'd0000000-0000-4000-8000-000000000002'
    when 'D1'       then 'e0000000-0000-4000-8000-000000000001'
    when 'D2'       then 'e0000000-0000-4000-8000-000000000002'
    when 'CL1'      then 'f0000000-0000-4000-8000-000000000001'
    when 'CL2'      then 'f0000000-0000-4000-8000-000000000002'
    when 'EV1'      then 'f1000000-0000-4000-8000-000000000001'
    when 'EV2'      then 'f1000000-0000-4000-8000-000000000002'
    when 'CF1'      then 'f2000000-0000-4000-8000-000000000001'
    when 'CF2'      then 'f2000000-0000-4000-8000-000000000002'
    when 'RT1'      then 'f3000000-0000-4000-8000-000000000001'
    when 'RT2'      then 'f3000000-0000-4000-8000-000000000002'
    when 'E1'       then 'f4000000-0000-4000-8000-000000000001'
    when 'E2'       then 'f4000000-0000-4000-8000-000000000002'
    when 'CA1'      then 'f5000000-0000-4000-8000-000000000001'
    when 'CA2'      then 'f5000000-0000-4000-8000-000000000002'
    when 'F1'       then 'f6000000-0000-4000-8000-000000000001'
  end)::uuid
$$;
grant execute on function rls_test.u(text) to anon, authenticated, service_role;

-- Become a database identity for the rest of the current statement block (reset with `reset role`).
create function rls_test.act_as(who text) returns void language plpgsql as $$
begin
  if who = 'anon' then
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
  elsif who = 'service' then
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    execute 'set local role service_role';
  else
    perform set_config('request.jwt.claim.sub', rls_test.u(who)::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', rls_test.u(who), 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
  end if;
end $$;

-- Count rows a query returns for an identity: 'rows:N' or 'err:SQLSTATE message'.
create function rls_test.see(who text, q text) returns text language plpgsql as $$
declare n bigint; r text;
begin
  perform rls_test.act_as(who);
  begin
    execute format('select count(*) from (%s) s', q) into n;
    r := 'rows:' || n;
  exception when others then
    r := 'err:' || sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  return r;
end $$;

-- Run a statement as an identity: 'ok:ROWCOUNT' or 'err:SQLSTATE message'. Unless keep, the effect is rolled back.
create function rls_test.attempt(who text, stmt text, keep boolean) returns text language plpgsql as $$
declare rc bigint; r text;
begin
  perform rls_test.act_as(who);
  begin
    execute stmt;
    get diagnostics rc = row_count;
    r := 'ok:' || rc;
    if not keep then raise exception using errcode = 'RTROL', message = r; end if;
  exception
    when sqlstate 'RTROL' then r := sqlerrm;
    when others then r := 'err:' || sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  return r;
end $$;

create function rls_test.rec(id text, kind text, descr text, passed boolean, observed text) returns void language sql as $$
  insert into rls_test.results (id, kind, descr, passed, observed) values (id, kind, descr, passed, left(observed, 160))
$$;

-- ATTACK: the identity must obtain nothing (zero rows, or a privilege error).
create function rls_test.deny_read(id text, who text, q text, descr text) returns void language plpgsql as $$
declare r text := rls_test.see(who, q);
begin perform rls_test.rec(id, 'attack', descr, r = 'rows:0' or r like 'err:42501%', r); end $$;

-- ATTACK: the statement must have no effect (zero rows changed, or a privilege error).
create function rls_test.deny_write(id text, who text, stmt text, descr text) returns void language plpgsql as $$
declare r text := rls_test.attempt(who, stmt, false);
begin perform rls_test.rec(id, 'attack', descr, r = 'ok:0' or r like 'err:42501%', r); end $$;

-- ATTACK: the statement must be REFUSED with a privilege error. Used for TRUNCATE, which reports zero rows even when it
-- succeeds and is not subject to RLS.
create function rls_test.deny_strict(id text, who text, stmt text, descr text) returns void language plpgsql as $$
declare r text := rls_test.attempt(who, stmt, false);
begin perform rls_test.rec(id, 'attack', descr, r like 'err:42501%', r); end $$;

-- WORKFLOW: the identity must see at least `atleast` rows.
create function rls_test.allow_read(id text, who text, q text, descr text, atleast int default 1) returns void language plpgsql as $$
declare r text := rls_test.see(who, q);
begin perform rls_test.rec(id, 'workflow', descr, r like 'rows:%' and split_part(r, ':', 2)::bigint >= atleast, r); end $$;

-- WORKFLOW: the statement must succeed and change/return at least one row. keep = persist for later cases.
create function rls_test.allow_write(id text, who text, stmt text, descr text, keep boolean default false) returns void language plpgsql as $$
declare r text := rls_test.attempt(who, stmt, keep);
begin perform rls_test.rec(id, 'workflow', descr, r like 'ok:%' and split_part(r, ':', 2)::bigint >= 1, r); end $$;

-- WORKFLOW/ATTACK: a boolean fact about the database, checked as postgres.
create function rls_test.fact(id text, kind text, q text, descr text) returns void language plpgsql as $$
declare b boolean; r text;
begin
  begin execute q into b; r := coalesce(b::text, 'null');
  exception when others then r := 'err:' || sqlstate || ' ' || sqlerrm; end;
  perform rls_test.rec(id, kind, descr, r = 'true', r);
end $$;

-- ============================================================================================ fictional fixtures
-- Inserted as postgres (bypasses RLS). No real person, company, founder or application data.
insert into auth.users (id, email, aud, role) values
  (rls_test.u('kushal'),   'principal@example.test', 'authenticated', 'authenticated'),
  (rls_test.u('aditya'),   'partner@example.test',   'authenticated', 'authenticated'),
  (rls_test.u('riya'),     'associate@example.test', 'authenticated', 'authenticated'),
  (rls_test.u('inactive'), 'former@example.test',    'authenticated', 'authenticated'),
  (rls_test.u('stranger'), 'stranger@example.test',  'authenticated', 'authenticated');

insert into profiles (id, full_name, role, active) values
  (rls_test.u('kushal'),   'Test Principal', 'kushal', true),
  (rls_test.u('aditya'),   'Test Partner',   'aditya', true),
  (rls_test.u('riya'),     'Test Associate', 'riya',   true),
  (rls_test.u('inactive'), 'Former Associate', 'riya', false);

insert into companies (id, name) values (rls_test.u('C1'), 'Fictional Orbital Labs'), (rls_test.u('C2'), 'Fictional Ledger Co');
insert into founders (id, name, background) values ('a1000000-0000-4000-8000-000000000001', 'Test Founder One', 'Fictional background text from a deck.');
insert into company_founders (company_id, founder_id, source_label) values (rls_test.u('C1'), 'a1000000-0000-4000-8000-000000000001', 'Form p1');

insert into applications (id, company_id, batch_id, one_liner, sector_key, tags, processing_status, decision_status, current_cycle_id) values
  (rls_test.u('A1'), rls_test.u('C1'), 'test-batch', 'Fictional satellite hardware', 'deeptech', array['deeptech','hardware'], 'ready_for_review', 'not_reviewed', rls_test.u('CYC1')),
  (rls_test.u('A2'), rls_test.u('C2'), 'test-batch', 'Fictional ledger software', 'fintech', '{}', 'ready_for_review', 'not_reviewed', rls_test.u('CYC2'));
insert into application_cycles (id, application_id, number, reason) values
  (rls_test.u('CYC1'), rls_test.u('A1'), 1, 'Initial submission'), (rls_test.u('CYC2'), rls_test.u('A2'), 1, 'Initial submission');

insert into documents (id, application_id, cycle_id, kind, original_filename, ext, size_bytes, status, storage_path) values
  (rls_test.u('D1'), rls_test.u('A1'), rls_test.u('CYC1'), 'deck', 'deck.pdf', 'pdf', 1000, 'extracted', 'b0000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000001/deck.pdf'),
  (rls_test.u('D2'), rls_test.u('A2'), rls_test.u('CYC2'), 'deck', 'deck.pdf', 'pdf', 1000, 'extracted', 'b0000000-0000-4000-8000-000000000002/e0000000-0000-4000-8000-000000000002/deck.pdf');
insert into document_pages (document_id, page_index, text) values
  (rls_test.u('D1'), 1, 'CONFIDENTIAL page text A1'), (rls_test.u('D2'), 1, 'CONFIDENTIAL page text A2');

insert into extracted_fields (application_id, document_id, field, label, value, original_text, page, method, validation, confidence) values
  (rls_test.u('A1'), rls_test.u('D1'), 'revenue', 'Revenue', '10', 'EXCERPT revenue sentence A1', 1, 'deck-pattern', 'parsed', 0.9),
  (rls_test.u('A2'), rls_test.u('D2'), 'revenue', 'Revenue', '20', 'EXCERPT revenue sentence A2', 1, 'deck-pattern', 'parsed', 0.9);
insert into claims (id, application_id, cycle_id, text, source_document_id, page, excerpt) values
  (rls_test.u('CL1'), rls_test.u('A1'), rls_test.u('CYC1'), 'Revenue is 10', rls_test.u('D1'), 1, 'EXCERPT claim A1'),
  (rls_test.u('CL2'), rls_test.u('A2'), rls_test.u('CYC2'), 'Revenue is 20', rls_test.u('D2'), 1, 'EXCERPT claim A2');
insert into evidence_sources (id, application_id, source_type, title, excerpt, direction, verification, independent) values
  (rls_test.u('EV1'), rls_test.u('A1'), 'web', 'Source A1', 'EXCERPT evidence A1', 'supports', 'independent', true),
  (rls_test.u('EV2'), rls_test.u('A2'), 'web', 'Source A2', 'EXCERPT evidence A2', 'supports', 'independent', true);
insert into claim_evidence (claim_id, evidence_id) values (rls_test.u('CL1'), rls_test.u('EV1')), (rls_test.u('CL2'), rls_test.u('EV2'));
insert into conflicts (id, application_id, type, metric, label, side_a, side_b, note, severity) values
  (rls_test.u('CF1'), rls_test.u('A1'), 'metric', 'revenue', 'Revenue', '{"excerpt":"EXCERPT side A1"}', '{"excerpt":"EXCERPT side B1"}', 'n', 'high'),
  (rls_test.u('CF2'), rls_test.u('A2'), 'metric', 'revenue', 'Revenue', '{"excerpt":"EXCERPT side A2"}', '{"excerpt":"EXCERPT side B2"}', 'n', 'high');
insert into research_tasks (id, application_id, workstream, question, priority, provider_note, findings) values
  (rls_test.u('RT1'), rls_test.u('A1'), 'market', 'Q1', 'high', 'manual', 'FINDINGS A1'),
  (rls_test.u('RT2'), rls_test.u('A2'), 'market', 'Q2', 'high', 'manual', 'FINDINGS A2');
insert into thesis_versions (id, version, status, stated, revealed, change_note) values ('thesis-test', 9001, 'superseded', '{}', '{}', 'test');
insert into criteria_versions (id, version, status, criteria, change_note) values ('criteria-test', 9001, 'superseded', '{}', 'test');
insert into evaluations (id, application_id, cycle_id, thesis_version_id, criteria_version_id, portfolio_dataset_version, provider, provider_label, simulated, coverage, recommendation, recommendation_reasons, stated_thesis, revealed_thesis) values
  (rls_test.u('E1'), rls_test.u('A1'), rls_test.u('CYC1'), 'thesis-test', 'criteria-test', 'portfolio-v1', 'mock', 'Mock', true, 0.5, 'request_info', array['REASON quoting A1'], '{}', '{}'),
  (rls_test.u('E2'), rls_test.u('A2'), rls_test.u('CYC2'), 'thesis-test', 'criteria-test', 'portfolio-v1', 'mock', 'Mock', true, 0.5, 'request_info', array['REASON quoting A2'], '{}', '{}');
insert into criterion_assessments (id, evaluation_id, criterion, score, evidence_state, confidence, supporting, rationale) values
  (rls_test.u('CA1'), rls_test.u('E1'), 'traction', 3, 'mixed', 'low', '[{"excerpt":"EXCERPT signal A1"}]', 'r'),
  (rls_test.u('CA2'), rls_test.u('E2'), 'traction', 3, 'mixed', 'low', '[{"excerpt":"EXCERPT signal A2"}]', 'r');
insert into assessment_evidence (assessment_id, claim_id, direction) values (rls_test.u('CA1'), rls_test.u('CL1'), 'supporting'), (rls_test.u('CA2'), rls_test.u('CL2'), 'supporting');
insert into feedback_corrections (id, application_id, evaluation_id, criterion, original, revised, reviewer, reason, category, scope, approval, criteria_version_id, provider) values
  (rls_test.u('F1'), rls_test.u('A1'), rls_test.u('E1'), 'traction', '{}', '{}', rls_test.u('riya'), 'test', 'other', 'case_specific', 'not_required', 'criteria-test', 'mock');
insert into portfolio_overlap_checks (application_id, dataset_version, dataset_verified, compared_count, compared_names, status, status_text) values
  (rls_test.u('A1'), 'portfolio-v1', false, 7, '{}', 'no_match_incomplete', 'test');
insert into jobs (application_id, type, error) values (rls_test.u('A1'), 'process_application', 'deck.pdf parsed');
insert into audit_events (actor, action, entity, entity_id, application_id, detail) values
  (null, 'document.uploaded', 'document', 'e0000000-0000-4000-8000-000000000001', rls_test.u('A1'), 'deck.pdf uploaded');
insert into storage.objects (bucket_id, name) values
  ('application-documents', 'b0000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000001/deck.pdf'),
  ('application-documents', 'b0000000-0000-4000-8000-000000000002/e0000000-0000-4000-8000-000000000002/deck.pdf');

-- ============================================================================================ ATTACKS
do $t$ begin
  -- ATK-1 · Aditya reads a deeptech application's documents with NO explicit grant from Kushal (P-C).
  perform rls_test.deny_read('ATK-1.1', 'aditya', $q$select * from documents where application_id = rls_test.u('A1')$q$, 'Aditya reads deeptech A1 documents without a grant');
  perform rls_test.deny_read('ATK-1.2', 'aditya', $q$select * from document_pages where document_id = rls_test.u('D1')$q$, 'Aditya reads deeptech A1 page text without a grant');
  perform rls_test.deny_read('ATK-1.3', 'aditya', $q$select * from documents where application_id = rls_test.u('A2')$q$, 'Aditya reads fintech A2 documents without a grant');

  -- ATK-2 · Same application's founder-document content through child tables while document access is denied.
  perform rls_test.deny_read('ATK-2.1', 'aditya', $q$select * from claims where application_id = rls_test.u('A1')$q$, 'claims.excerpt (A1, no grant)');
  perform rls_test.deny_read('ATK-2.2', 'aditya', $q$select * from extracted_fields where application_id = rls_test.u('A1')$q$, 'extracted_fields.original_text (A1, no grant)');
  perform rls_test.deny_read('ATK-2.3', 'aditya', $q$select * from evidence_sources where application_id = rls_test.u('A1')$q$, 'evidence_sources.excerpt (A1, no grant)');
  perform rls_test.deny_read('ATK-2.4', 'aditya', $q$select * from conflicts where application_id = rls_test.u('A1')$q$, 'conflicts.side_a/side_b excerpts (A1, no grant)');
  perform rls_test.deny_read('ATK-2.5', 'aditya', $q$select * from claim_evidence where claim_id = rls_test.u('CL1')$q$, 'claim_evidence links (A1, no grant)');
  perform rls_test.deny_read('ATK-2.6', 'aditya', $q$select * from research_tasks where application_id = rls_test.u('A1')$q$, 'research_tasks.findings (A1, no grant)');
  perform rls_test.deny_read('ATK-2.7', 'aditya', $q$select * from evaluations where application_id = rls_test.u('A1')$q$, 'evaluations.recommendation_reasons (A1, no grant)');
  perform rls_test.deny_read('ATK-2.8', 'aditya', $q$select * from criterion_assessments where evaluation_id = rls_test.u('E1')$q$, 'criterion_assessments signal excerpts (A1, no grant)');
  perform rls_test.deny_read('ATK-2.9', 'aditya', $q$select * from assessment_evidence where assessment_id = rls_test.u('CA1')$q$, 'assessment_evidence links (A1, no grant)');
  perform rls_test.deny_read('ATK-2.10', 'aditya', $q$select * from feedback_corrections where application_id = rls_test.u('A1')$q$, 'feedback_corrections (A1, no grant)');
  perform rls_test.deny_read('ATK-2.11', 'aditya', $q$select * from portfolio_overlap_checks where application_id = rls_test.u('A1')$q$, 'portfolio_overlap_checks results (A1, no grant)');
  perform rls_test.deny_read('ATK-2.12', 'aditya', $q$select * from founders where id = 'a1000000-0000-4000-8000-000000000001'$q$, 'founders.background from the deck (A1, no grant)');
  perform rls_test.deny_read('ATK-2.13', 'aditya', $q$select * from jobs where application_id = rls_test.u('A1')$q$, 'jobs.error text (A1, no grant)');
  perform rls_test.deny_read('ATK-2.14', 'aditya', $q$select * from audit_events where application_id = rls_test.u('A1')$q$, 'audit_events.detail (A1, no grant)');
  perform rls_test.deny_read('ATK-2.15', 'aditya', $q$select * from claims where application_id = rls_test.u('A2')$q$, 'claims.excerpt (fintech A2, no grant)');

  -- ATK-3 · Riya (associate) changes an investment decision without the partner decision workflow.
  perform rls_test.deny_write('ATK-3.1', 'riya', $s$update applications set decision_status = 'call_approved' where id = rls_test.u('A2')$s$, 'Riya sets decision_status = call_approved directly');
  perform rls_test.deny_write('ATK-3.2', 'riya', $s$update applications set decision_status = 'passed_by_partner' where id = rls_test.u('A1')$s$, 'Riya sets decision_status = passed_by_partner directly');
  perform rls_test.deny_write('ATK-3.3', 'riya', $s$insert into applications (company_id, batch_id, decision_status) values (rls_test.u('C2'), 'x', 'call_approved')$s$, 'Riya creates an application pre-approved (decision_status on insert)');
  perform rls_test.deny_write('ATK-3.4', 'riya', $s$insert into partner_decisions (application_id, cycle_id, decision, rationale, decided_by) values (rls_test.u('A2'), rls_test.u('CYC2'), 'approve_call', 'x', rls_test.u('riya'))$s$, 'Riya records a partner decision as herself');
  perform rls_test.deny_write('ATK-3.5', 'riya', $s$insert into partner_decisions (application_id, cycle_id, decision, rationale, decided_by) values (rls_test.u('A2'), rls_test.u('CYC2'), 'approve_call', 'x', rls_test.u('kushal'))$s$, 'Riya records a partner decision impersonating Kushal');
  perform rls_test.deny_write('ATK-3.6', 'aditya', $s$update applications set decision_status = 'call_approved' where id = rls_test.u('A1')$s$, 'Aditya sets decision_status directly');
  perform rls_test.deny_write('ATK-3.7', 'kushal', $s$update applications set decision_status = 'call_approved' where id = rls_test.u('A2')$s$, 'Kushal bypasses the decision record (status without a partner_decisions row)');
  perform rls_test.deny_write('ATK-3.8', 'riya', $s$update conflicts set severity = 'low' where id = rls_test.u('CF2')$s$, 'Riya rewrites conflict severity (only resolution fields are editable)');
  perform rls_test.deny_write('ATK-3.10', 'riya', $s$select reopen_application(rls_test.u('A2'), 'x')$s$, 'Riya reopens an application (Kushal only)');

  -- ATK-4 · Ordinary members forge, alter or erase audit records.
  perform rls_test.deny_write('ATK-4.1', 'riya', $s$insert into audit_events (actor, action, entity, entity_id, application_id, detail) values (rls_test.u('riya'), 'decision.recorded', 'partner_decision', 'x', rls_test.u('A2'), 'forged')$s$, 'Riya inserts a forged audit event as herself');
  perform rls_test.deny_write('ATK-4.2', 'riya', $s$insert into audit_events (actor, action, entity, entity_id, detail) values (rls_test.u('kushal'), 'access.granted', 'application', 'x', 'forged')$s$, 'Riya inserts an audit event impersonating Kushal');
  perform rls_test.deny_write('ATK-4.3', 'aditya', $s$insert into audit_events (actor, action, entity, entity_id, detail) values (null, 'system', 'x', 'x', 'forged system event')$s$, 'Aditya inserts a forged system audit event');
  perform rls_test.deny_write('ATK-4.4', 'kushal', $s$update audit_events set detail = 'edited' where true$s$, 'Kushal edits audit history');
  perform rls_test.deny_write('ATK-4.5', 'riya', $s$delete from audit_events where true$s$, 'Riya deletes audit history');
  perform rls_test.deny_strict('ATK-4.6', 'riya', $s$truncate audit_events$s$, 'Riya truncates the audit log (TRUNCATE ignores RLS)');

  -- ATK-5 · Storage objects of applications the user may not access; malformed or foreign paths.
  perform rls_test.deny_read('ATK-5.1', 'aditya', $q$select * from storage.objects where bucket_id = 'application-documents' and name like 'b0000000-0000-4000-8000-000000000001/%'$q$, 'Aditya reads A1 deck object without a grant');
  perform rls_test.deny_read('ATK-5.2', 'aditya', $q$select * from storage.objects where bucket_id = 'application-documents' and name like 'b0000000-0000-4000-8000-000000000002/%'$q$, 'Aditya reads A2 deck object without a grant');
  perform rls_test.deny_write('ATK-5.3', 'aditya', $s$insert into storage.objects (bucket_id, name) values ('application-documents', 'b0000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000001/evil.pdf')$s$, 'Aditya uploads into A1 storage path');
  perform rls_test.deny_write('ATK-5.4', 'riya', $s$insert into storage.objects (bucket_id, name) values ('application-documents', 'not-an-application/evil.pdf')$s$, 'Riya uploads to a path that is not an application');
  perform rls_test.deny_write('ATK-5.5', 'riya', $s$insert into storage.objects (bucket_id, name) values ('application-documents', '99999999-0000-4000-8000-000000000009/e0000000-0000-4000-8000-000000000009/x.pdf')$s$, 'Riya uploads to the path of a non-existent application');
  perform rls_test.deny_write('ATK-5.6', 'riya', $s$update storage.objects set name = 'b0000000-0000-4000-8000-000000000002/e0000000-0000-4000-8000-000000000002/moved.pdf' where bucket_id = 'application-documents'$s$, 'Riya renames/moves stored documents directly');
  perform rls_test.deny_write('ATK-5.7', 'stranger', $s$insert into storage.objects (bucket_id, name) values ('application-documents', 'b0000000-0000-4000-8000-000000000002/e0000000-0000-4000-8000-000000000002/x.pdf')$s$, 'Signed-in non-member uploads into A2');

  -- ATK-6 · Bypassing the UI with direct database calls.
  perform rls_test.deny_write('ATK-6.1', 'aditya', $s$update research_tasks set findings = 'tampered' where id = rls_test.u('RT1')$s$, 'Aditya updates research of an application he cannot access');
  perform rls_test.deny_write('ATK-6.2', 'aditya', $s$insert into evidence_sources (application_id, source_type, title, excerpt, direction, verification, independent, added_by) values (rls_test.u('A1'), 'web', 't', 'x', 'supports', 'independent', true, rls_test.u('aditya'))$s$, 'Aditya adds evidence to an application he cannot access');
  perform rls_test.deny_write('ATK-6.3', 'aditya', $s$insert into feedback_corrections (application_id, evaluation_id, criterion, original, revised, reviewer, reason, category, scope, approval, criteria_version_id, provider) values (rls_test.u('A1'), rls_test.u('E1'), 'traction', '{}', '{}', rls_test.u('aditya'), 'x', 'other', 'case_specific', 'not_required', 'criteria-test', 'mock')$s$, 'Aditya corrects scores of an application he cannot access');
  perform rls_test.deny_write('ATK-6.4', 'aditya', $s$select grant_document_access(rls_test.u('A1'), rls_test.u('aditya'), 'self-grant')$s$, 'Aditya grants himself document access');
  perform rls_test.deny_write('ATK-6.5', 'riya', $s$select grant_document_access(rls_test.u('A1'), rls_test.u('aditya'), 'associate grant')$s$, 'Riya grants Aditya document access');
  perform rls_test.deny_write('ATK-6.6', 'aditya', $s$insert into application_access_grants (application_id, grantee, granted_by, reason) values (rls_test.u('A1'), rls_test.u('aditya'), rls_test.u('kushal'), 'forged')$s$, 'Aditya inserts a grant row directly, forging Kushal');
  perform rls_test.deny_write('ATK-6.7', 'riya', $s$update profiles set role = 'kushal' where id = rls_test.u('riya')$s$, 'Riya promotes herself to principal');
  perform rls_test.deny_write('ATK-6.8', 'stranger', $s$insert into profiles (id, full_name, role) values (rls_test.u('stranger'), 'x', 'kushal')$s$, 'Signed-in non-member creates a principal profile');
  perform rls_test.deny_read('ATK-6.9', 'stranger', $q$select * from applications$q$, 'Signed-in non-member lists applications');
  perform rls_test.deny_read('ATK-6.10', 'inactive', $q$select * from claims$q$, 'Deactivated member reads claims');
  perform rls_test.deny_strict('ATK-6.11', 'aditya', $s$truncate jobs$s$, 'Member truncates a table (TRUNCATE ignores RLS)');
  perform rls_test.deny_write('ATK-6.12', 'kushal', $s$insert into partner_decisions (application_id, cycle_id, decision, rationale, decided_by) values (rls_test.u('A2'), rls_test.u('CYC2'), 'approve_call', 'x', rls_test.u('kushal'))$s$, 'Kushal decides without having opened the application');

  -- ATK-7 · Anonymous (unauthenticated) requests.
  perform rls_test.deny_read('ATK-7.1', 'anon', $q$select * from applications$q$, 'anon lists applications');
  perform rls_test.deny_read('ATK-7.2', 'anon', $q$select * from claims$q$, 'anon reads claims');
  perform rls_test.deny_read('ATK-7.3', 'anon', $q$select * from documents$q$, 'anon reads documents');
  perform rls_test.deny_read('ATK-7.4', 'anon', $q$select * from profiles$q$, 'anon reads profiles');
  perform rls_test.deny_read('ATK-7.5', 'anon', $q$select * from audit_events$q$, 'anon reads audit events');
  perform rls_test.deny_read('ATK-7.6', 'anon', $q$select * from storage.objects where bucket_id = 'application-documents'$q$, 'anon lists stored documents');
  perform rls_test.deny_write('ATK-7.7', 'anon', $s$insert into applications (company_id, batch_id) values (rls_test.u('C2'), 'x')$s$, 'anon creates an application');
  perform rls_test.deny_strict('ATK-7.8', 'anon', $s$truncate jobs$s$, 'anon truncates a table (TRUNCATE ignores RLS)');
  perform rls_test.deny_write('ATK-7.9', 'anon', $s$select grant_document_access(rls_test.u('A1'), rls_test.u('aditya'), 'anon')$s$, 'anon calls the grant function');
  perform rls_test.deny_write('ATK-7.10', 'anon', $s$select submit_for_partner_review(rls_test.u('A2'), 'anon')$s$, 'anon calls the submit function');
end $t$;

-- ============================================================================================ LEGITIMATE WORKFLOWS
do $t$ begin
  -- Role-based access that must keep working.
  perform rls_test.allow_read('WF-1.1', 'kushal', $q$select * from documents$q$, 'Kushal reads every application''s documents', 2);
  perform rls_test.allow_read('WF-1.2', 'kushal', $q$select * from claims$q$, 'Kushal reads every application''s claims', 2);
  perform rls_test.allow_read('WF-1.3', 'riya', $q$select * from document_pages$q$, 'Riya reads page text of every application', 2);
  perform rls_test.allow_read('WF-1.4', 'riya', $q$select * from storage.objects where bucket_id = 'application-documents'$q$, 'Riya reads stored documents', 2);
  perform rls_test.allow_read('WF-1.5', 'aditya', $q$select * from applications$q$, 'Aditya still sees the application list (P-C restricts documents, not the list)', 2);
  perform rls_test.allow_read('WF-1.6', 'aditya', $q$select * from portfolio_companies$q$, 'Members read seeded portfolio reference data', 7);

  -- Explicit sharing grant (P-C): Kushal shares A1 with Aditya.
  perform rls_test.allow_write('WF-2.1', 'kushal', $s$select grant_document_access(rls_test.u('A1'), rls_test.u('aditya'), 'Technical review requested')$s$, 'Kushal grants Aditya access to A1', true);
  perform rls_test.allow_read('WF-2.2', 'aditya', $q$select * from documents where application_id = rls_test.u('A1')$q$, 'Aditya reads A1 documents after the grant');
  perform rls_test.allow_read('WF-2.3', 'aditya', $q$select * from claims where application_id = rls_test.u('A1')$q$, 'Aditya reads A1 claims after the grant');
  perform rls_test.allow_read('WF-2.4', 'aditya', $q$select * from criterion_assessments where evaluation_id = rls_test.u('E1')$q$, 'Aditya reads A1 assessments after the grant');
  perform rls_test.allow_read('WF-2.5', 'aditya', $q$select * from storage.objects where name like 'b0000000-0000-4000-8000-000000000001/%'$q$, 'Aditya reads the A1 deck object after the grant');
  perform rls_test.allow_write('WF-2.6', 'aditya', $s$update research_tasks set findings = 'Partner notes' where id = rls_test.u('RT1')$s$, 'Aditya updates A1 research after the grant');
  perform rls_test.allow_write('WF-2.7', 'aditya', $s$insert into evidence_sources (application_id, source_type, title, excerpt, direction, verification, independent, added_by) values (rls_test.u('A1'), 'web', 't', 'x', 'supports', 'independent', true, rls_test.u('aditya'))$s$, 'Aditya adds A1 evidence after the grant');
  perform rls_test.fact('WF-2.8', 'workflow', $q$select exists (select 1 from audit_events where action = 'access.granted' and actor = rls_test.u('kushal') and application_id = rls_test.u('A1'))$q$, 'The grant is audited with Kushal as actor');
end $t$;
do $t$ begin
  -- A grant is per application: it never widens to A2.
  perform rls_test.deny_read('ATK-6.13', 'aditya', $q$select * from claims where application_id = rls_test.u('A2')$q$, 'Aditya with an A1 grant reads A2 claims (cross-application)');
  perform rls_test.deny_read('ATK-6.14', 'aditya', $q$select * from storage.objects where name like 'b0000000-0000-4000-8000-000000000002/%'$q$, 'Aditya with an A1 grant reads the A2 deck object');
  perform rls_test.deny_write('ATK-5.8', 'aditya', $s$insert into storage.objects (bucket_id, name) values ('application-documents', 'b0000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000001/x.pdf')$s$, 'Aditya with a read grant uploads into A1 (upload is not granted)');

  -- Revocation removes access again.
  perform rls_test.allow_write('WF-2.9', 'kushal', $s$select revoke_document_access(rls_test.u('A1'), rls_test.u('aditya'), 'Review finished')$s$, 'Kushal revokes Aditya''s A1 access', true);
  perform rls_test.deny_read('ATK-1.4', 'aditya', $q$select * from document_pages where document_id = rls_test.u('D1')$q$, 'Aditya reads A1 page text after revocation');
  perform rls_test.deny_read('ATK-2.16', 'aditya', $q$select * from claims where application_id = rls_test.u('A1')$q$, 'Aditya reads A1 claims after revocation');
  perform rls_test.fact('WF-2.10', 'workflow', $q$select exists (select 1 from audit_events where action = 'access.revoked' and actor = rls_test.u('kushal') and application_id = rls_test.u('A1'))$q$, 'The revocation is audited with Kushal as actor');

  -- Associate workflow: intake edits, upload, conflict resolution, submit for partner review.
  perform rls_test.allow_write('WF-3.1', 'riya', $s$update applications set one_liner = 'Edited one-liner' where id = rls_test.u('A2')$s$, 'Riya edits application intake fields');
  perform rls_test.allow_write('WF-3.2', 'riya', $s$insert into storage.objects (bucket_id, name) values ('application-documents', 'b0000000-0000-4000-8000-000000000002/e0000000-0000-4000-8000-0000000000a2/form.pdf')$s$, 'Riya uploads a document into A2''s path');
  perform rls_test.allow_write('WF-3.3', 'riya', $s$update conflicts set status = 'explained', resolution_note = 'Different periods', resolved_by = rls_test.u('riya') where id = rls_test.u('CF2')$s$, 'Riya resolves a conflict');
  perform rls_test.allow_write('WF-3.4', 'riya', $s$insert into applications (company_id, batch_id, one_liner) values (rls_test.u('C2'), 'test-batch', 'New intake')$s$, 'Riya creates an application');
  perform rls_test.allow_write('WF-3.5', 'riya', $s$select submit_for_partner_review(rls_test.u('A2'), 'Ready')$s$, 'Riya submits A2 for partner review', true);
  perform rls_test.fact('WF-3.6', 'workflow', $q$select decision_status = 'awaiting_partner_review' from applications where id = rls_test.u('A2')$q$, 'A2 is awaiting partner review');

  -- Principal decision workflow: open, decide, status follows the decision record, audited.
  perform rls_test.allow_write('WF-4.1', 'kushal', $s$insert into application_views (application_id, user_id) values (rls_test.u('A2'), rls_test.u('kushal'))$s$, 'Kushal opens A2', true);
  perform rls_test.allow_write('WF-4.2', 'kushal', $s$insert into partner_decisions (application_id, cycle_id, decision, rationale, decided_by) values (rls_test.u('A2'), rls_test.u('CYC2'), 'approve_call', 'Strong team', rls_test.u('kushal'))$s$, 'Kushal records approve_call', true);
  perform rls_test.fact('WF-4.3', 'workflow', $q$select decision_status = 'call_approved' from applications where id = rls_test.u('A2')$q$, 'A2 decision_status follows the decision record (call_approved)');
  perform rls_test.fact('WF-4.4', 'workflow', $q$select exists (select 1 from audit_events where action = 'decision.recorded' and actor = rls_test.u('kushal') and application_id = rls_test.u('A2'))$q$, 'The decision is audited with Kushal as actor');
  perform rls_test.deny_write('ATK-3.9', 'riya', $s$update partner_decisions set decision = 'pass' where application_id = rls_test.u('A2')$s$, 'Riya edits Kushal''s recorded decision');
  perform rls_test.deny_write('ATK-3.11', 'kushal', $s$delete from partner_decisions where application_id = rls_test.u('A2')$s$, 'A recorded decision is deleted (decisions are permanent)');
  perform rls_test.deny_write('ATK-3.12', 'riya', $s$update applications set decision_status = 'passed_by_partner' where id = rls_test.u('A2')$s$, 'Riya overrides the recorded decision''s status');
  perform rls_test.allow_write('WF-4.5', 'kushal', $s$select reopen_application(rls_test.u('A2'), 'New traction data')$s$, 'Kushal reopens A2', true);
  perform rls_test.fact('WF-4.6', 'workflow', $q$select a.decision_status = 'reopened' and c.number = 2 from applications a join application_cycles c on c.id = a.current_cycle_id where a.id = rls_test.u('A2')$q$, 'A2 is reopened in cycle 2');

  -- Audit log: readable by the principal, immutable for everyone (including the service role).
  perform rls_test.allow_read('WF-5.1', 'kushal', $q$select * from audit_events$q$, 'Kushal reads the audit trail', 4);
  perform rls_test.fact('WF-5.2', 'workflow', $q$select (select count(*) from audit_events where actor is not null) >= 4$q$, 'Audited actions were written by the database (grant, revoke, submit, decision, reopen)');
  perform rls_test.deny_write('WF-5.3', 'service', $s$update audit_events set detail = 'rewritten' where true$s$, 'Service role cannot rewrite audit history');
  perform rls_test.deny_write('WF-5.4', 'service', $s$delete from audit_events where true$s$, 'Service role cannot delete audit history');
end $t$;
-- WF-5.3/5.4 are workflow guarantees recorded via deny_write: re-label them.
update rls_test.results set kind = 'workflow' where id in ('WF-5.3', 'WF-5.4');

-- ============================================================================================ report
-- @@REPORT (the local PGlite runner splits here)
select id, kind, case when passed then 'PASS' else 'FAIL' end as result, descr, observed from rls_test.results order by n;

do $$
declare a_total int; a_fail int; w_total int; w_fail int; failed text;
begin
  select count(*) filter (where kind = 'attack'), count(*) filter (where kind = 'attack' and not passed),
         count(*) filter (where kind = 'workflow'), count(*) filter (where kind = 'workflow' and not passed),
         string_agg(id, ', ' order by n) filter (where not passed)
    into a_total, a_fail, w_total, w_fail, failed from rls_test.results;
  if a_fail + w_fail > 0 then
    raise exception 'RLS security tests FAILED: attacks blocked % of %, workflows working % of %. Failing: %',
      a_total - a_fail, a_total, w_total - w_fail, w_total, failed;
  end if;
  raise notice 'RLS security tests passed: % attacks blocked, % workflows working.', a_total, w_total;
end $$;

rollback;
