-- Security model remediation (Tasks 0.4 + 0.5). Fixes production-readiness audit findings DB-1 to DB-6.
-- Proven by supabase/security-tests/rls_attacks.sql (attacks blocked, legitimate workflows intact). See docs/SECURITY_TESTS.md.
--
-- Principles: fail closed; access follows the signed-in user and explicit grants, never founder-supplied text (P-C);
-- decisions change only through a recorded partner decision; the audit log is written by the database and is append-only.
-- Forward-only. Rollback, if ever needed, is a new migration restoring the 0002 policies (not recommended: it reopens DB-1..6).

-- ============================================================================ 1. Explicit, audited document-access grants (DB-1)
create table application_access_grants (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  grantee uuid not null references profiles(id),
  granted_by uuid not null references profiles(id),
  reason text not null check (length(btrim(reason)) between 1 and 500),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references profiles(id),
  revoke_reason text,
  check ((revoked_at is null) = (revoked_by is null))
);
create unique index application_access_grants_active_uq on application_access_grants (application_id, grantee) where revoked_at is null;
create index application_access_grants_grantee_idx on application_access_grants (grantee) where revoked_at is null;
alter table application_access_grants enable row level security;
alter table application_access_grants force row level security;
-- Principal and associate see all grants; a partner sees the grants made to him. Writes only through the functions below.
create policy application_access_grants_read on application_access_grants for select using (has_role('kushal','riya') or grantee = auth.uid());
revoke insert, update, delete, truncate on application_access_grants from anon, authenticated;

-- Document access: Kushal and Riya by role; Aditya ONLY through an active grant. Sector and tags no longer matter.
create or replace function can_view_documents(app uuid) returns boolean language sql stable security definer set search_path = public as $$
  select case current_role_name()
    when 'kushal' then true
    when 'riya' then true
    when 'aditya' then exists (select 1 from application_access_grants g where g.application_id = app and g.grantee = auth.uid() and g.revoked_at is null)
    else false end
$$;

-- Founder records follow the documents of the company's applications.
create function can_view_company(company uuid) returns boolean language sql stable security definer set search_path = public as $$
  select case current_role_name()
    when 'kushal' then true
    when 'riya' then true
    when 'aditya' then exists (select 1 from applications a join application_access_grants g on g.application_id = a.id
                               where a.company_id = company and g.grantee = auth.uid() and g.revoked_at is null)
    else false end
$$;

-- ============================================================================ 2. Database-written, append-only audit log (DB-4)
-- Internal: only security-definer functions and triggers below call it (EXECUTE revoked from every client role).
create function write_audit(p_actor uuid, p_action text, p_entity text, p_entity_id text, p_application uuid, p_detail text)
returns void language sql security definer set search_path = public as $$
  insert into audit_events (actor, action, entity, entity_id, application_id, detail) values (p_actor, p_action, p_entity, p_entity_id, p_application, p_detail)
$$;

drop policy audit_insert on audit_events;              -- members no longer write audit rows directly
revoke insert, update, delete, truncate on audit_events from anon, authenticated;

create function audit_events_immutable() returns trigger language plpgsql as $$
begin
  -- The only permitted change: ON DELETE SET NULL of application_id when an application is removed.
  if tg_op = 'UPDATE' and old.application_id is not null and new.application_id is null
     and (new.id, new.at, new.actor, new.action, new.entity, new.entity_id, new.detail)
         is not distinct from (old.id, old.at, old.actor, old.action, old.entity, old.entity_id, old.detail) then
    return new;
  end if;
  raise exception 'audit_events is append-only: % refused', tg_op using errcode = '42501';
end $$;
create trigger audit_events_append_only before update or delete on audit_events for each row execute function audit_events_immutable();
create trigger audit_events_no_truncate before truncate on audit_events for each statement execute function audit_events_immutable();

-- ============================================================================ 3. Decisions only through partner_decisions (DB-3)
-- Clients may edit intake fields only; decision_status, processing state, cycles and errors are not client-writable.
revoke update on applications from anon, authenticated;
grant update (one_liner, sector_selected, sector_key, tags, stage, raise_inr, valuation_inr, source) on applications to authenticated;

drop policy applications_insert on applications;
create policy applications_insert on applications for insert with check (
  has_role('riya','kushal') and decision_status = 'not_reviewed' and processing_status = 'received' and current_cycle_id is null
);

-- Recorded decisions are permanent.
revoke update, delete on partner_decisions from anon, authenticated;

-- A recorded decision sets the application's status and is audited, atomically.
create function apply_partner_decision() returns trigger language plpgsql security definer set search_path = public as $$
declare cur uuid;
begin
  select current_cycle_id into cur from applications where id = new.application_id for update;
  if cur is distinct from new.cycle_id then
    raise exception 'A decision must be recorded against the application''s current cycle.' using errcode = '23514';
  end if;
  update applications set decision_status = (case new.decision
      when 'approve_call' then 'call_approved' when 'request_info' then 'information_requested'
      when 'hold' then 'on_hold' when 'pass' then 'passed_by_partner' end)::decision_status
    where id = new.application_id;
  perform write_audit(new.decided_by, 'decision.recorded', 'partner_decision', new.id::text, new.application_id,
    new.decision::text || coalesce(' (' || new.pass_reason::text || ')', '') || ': ' || new.rationale);
  return null;
end $$;
create trigger partner_decisions_apply after insert on partner_decisions for each row execute function apply_partner_decision();

-- The first cycle of a new application becomes its current cycle (clients cannot write current_cycle_id).
create function set_initial_cycle() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update applications set current_cycle_id = new.id where id = new.application_id and current_cycle_id is null;
  return null;
end $$;
create trigger application_cycles_set_current after insert on application_cycles for each row execute function set_initial_cycle();

-- Associate/principal: send to partner review (mirrors workspace.submitForReview).
create function submit_for_partner_review(p_application uuid, p_note text default '') returns decision_status
language plpgsql security definer set search_path = public as $$
declare ps processing_status; ds decision_status;
begin
  if not has_role('riya','kushal') then raise exception 'Not permitted to submit for partner review.' using errcode = '42501'; end if;
  select processing_status, decision_status into ps, ds from applications where id = p_application for update;
  if not found then raise exception 'Unknown application.' using errcode = '22023'; end if;
  if ps = 'failed' then raise exception 'Processing failed: fix the documents before sending to partner review.' using errcode = '22023'; end if;
  if ds not in ('not_reviewed','reopened','information_requested') then
    raise exception 'Application is already "%".', ds using errcode = '22023';
  end if;
  update applications set decision_status = 'awaiting_partner_review' where id = p_application;
  perform write_audit(auth.uid(), 'review.submitted', 'application', p_application::text, p_application,
    'Sent to partner review.' || coalesce(nullif(' ' || btrim(p_note), ' '), ''));
  return 'awaiting_partner_review';
end $$;

-- Principal: reopen in a new cycle (mirrors workspace.reopen). Previous decisions and evaluations are retained.
create function reopen_application(p_application uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cur uuid; n int; new_cycle uuid;
begin
  if not has_role('kushal') then raise exception 'Only the principal can reopen an application.' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required to reopen.' using errcode = '22023'; end if;
  select current_cycle_id into cur from applications where id = p_application for update;
  if not found then raise exception 'Unknown application.' using errcode = '22023'; end if;
  select number into n from application_cycles where id = cur;
  update application_cycles set closed_at = now() where id = cur and closed_at is null;
  insert into application_cycles (application_id, number, reason, opened_by) values (p_application, coalesce(n, 0) + 1, btrim(p_reason), auth.uid())
    returning id into new_cycle;
  update applications set current_cycle_id = new_cycle, decision_status = 'reopened' where id = p_application;
  perform write_audit(auth.uid(), 'application.reopened', 'application_cycle', new_cycle::text, p_application,
    format('Cycle %s opened: %s. Previous decisions and evaluations retained under cycle %s.', coalesce(n, 0) + 1, btrim(p_reason), n));
  return new_cycle;
end $$;

-- Principal: share / withdraw document access (mirrors workspace.grantDocumentAccess / revokeDocumentAccess).
create function grant_document_access(p_application uuid, p_grantee uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare g uuid; grantee_name text;
begin
  if not has_role('kushal') then raise exception 'Only the principal can share application documents.' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Record why access is being shared.' using errcode = '22023'; end if;
  if not exists (select 1 from applications where id = p_application) then raise exception 'Unknown application.' using errcode = '22023'; end if;
  select full_name into grantee_name from profiles where id = p_grantee and role = 'aditya' and active;
  if grantee_name is null then
    raise exception 'Access can be shared only with an active partner; the principal and associate have access by role.' using errcode = '22023';
  end if;
  select id into g from application_access_grants where application_id = p_application and grantee = p_grantee and revoked_at is null;
  if g is not null then return g; end if;    -- idempotent, like the app
  insert into application_access_grants (application_id, grantee, granted_by, reason) values (p_application, p_grantee, auth.uid(), btrim(p_reason))
    returning id into g;
  perform write_audit(auth.uid(), 'access.granted', 'application', p_application::text, p_application,
    format('Document access shared with %s. Reason: %s', grantee_name, btrim(p_reason)));
  return g;
end $$;

create function revoke_document_access(p_application uuid, p_grantee uuid, p_reason text default '') returns boolean
language plpgsql security definer set search_path = public as $$
declare grantee_name text;
begin
  if not has_role('kushal') then raise exception 'Only the principal can withdraw document access.' using errcode = '42501'; end if;
  update application_access_grants set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = nullif(btrim(p_reason), '')
    where application_id = p_application and grantee = p_grantee and revoked_at is null;
  if not found then return false; end if;
  select full_name into grantee_name from profiles where id = p_grantee;
  perform write_audit(auth.uid(), 'access.revoked', 'application', p_application::text, p_application,
    format('Document access withdrawn from %s.', grantee_name) || coalesce(' Reason: ' || nullif(btrim(p_reason), ''), ''));
  return true;
end $$;

-- ============================================================================ 4. Child tables follow document access (DB-2, DB-6)
-- Every table that carries founder-document content or is derived from it uses the same predicate as `documents`.
do $$
declare t text;
begin
  foreach t in array array['extracted_fields','claims','evidence_sources','conflicts','research_tasks','evaluations',
                           'feedback_corrections','portfolio_overlap_checks','jobs']
  loop
    execute format('drop policy %I on %I', t || '_read', t);
    execute format('create policy %I on %I for select using (can_view_documents(application_id))', t || '_read', t);
  end loop;
end $$;

drop policy claim_evidence_read on claim_evidence;
create policy claim_evidence_read on claim_evidence for select using (
  exists (select 1 from claims c where c.id = claim_evidence.claim_id and can_view_documents(c.application_id)));

drop policy criterion_assessments_read on criterion_assessments;
create policy criterion_assessments_read on criterion_assessments for select using (
  exists (select 1 from evaluations e where e.id = criterion_assessments.evaluation_id and can_view_documents(e.application_id)));

drop policy assessment_evidence_read on assessment_evidence;
create policy assessment_evidence_read on assessment_evidence for select using (
  exists (select 1 from criterion_assessments ca join evaluations e on e.id = ca.evaluation_id
          where ca.id = assessment_evidence.assessment_id and can_view_documents(e.application_id)));

drop policy founders_read on founders;
create policy founders_read on founders for select using (
  has_role('kushal','riya') or exists (select 1 from company_founders cf where cf.founder_id = founders.id and can_view_company(cf.company_id)));

drop policy company_founders_read on company_founders;
create policy company_founders_read on company_founders for select using (can_view_company(company_id));

-- Audit details quote applications: same predicate; non-application events stay visible to members.
drop policy audit_events_read on audit_events;
create policy audit_events_read on audit_events for select using (
  is_member() and (application_id is null or can_view_documents(application_id)));

-- Writes are scoped to applications the user may access.
drop policy research_update on research_tasks;
create policy research_update on research_tasks for update
  using (has_role('riya','kushal','aditya') and can_view_documents(application_id))
  with check (has_role('riya','kushal','aditya') and can_view_documents(application_id));

drop policy evidence_insert on evidence_sources;
create policy evidence_insert on evidence_sources for insert with check (
  has_role('riya','kushal','aditya') and added_by = auth.uid() and can_view_documents(application_id));

drop policy claim_evidence_insert on claim_evidence;
create policy claim_evidence_insert on claim_evidence for insert with check (
  has_role('riya','kushal','aditya') and exists (
    select 1 from claims c join evidence_sources e on e.application_id = c.application_id
    where c.id = claim_evidence.claim_id and e.id = claim_evidence.evidence_id and can_view_documents(c.application_id)));

drop policy corrections_insert on feedback_corrections;
create policy corrections_insert on feedback_corrections for insert with check (
  is_member() and reviewer = auth.uid() and can_view_documents(application_id));

drop policy fields_write on extracted_fields;
create policy fields_write on extracted_fields for update
  using (has_role('riya','kushal') and can_view_documents(application_id))
  with check (has_role('riya','kushal') and can_view_documents(application_id));

-- Conflicts: only the resolution may be edited, as oneself (DB-3). Sides, severity and scoring stay as computed.
revoke update on conflicts from anon, authenticated;
grant update (status, resolution_note, resolved_by) on conflicts to authenticated;
drop policy conflicts_update on conflicts;
create policy conflicts_update on conflicts for update
  using (has_role('riya','kushal') and can_view_documents(application_id))
  with check (has_role('riya','kushal') and can_view_documents(application_id) and resolved_by = auth.uid());

drop policy views_insert on application_views;
create policy views_insert on application_views for insert with check (is_member() and user_id = auth.uid());

-- ============================================================================ 5. Storage follows application access (DB-5)
-- Object path: {application_id}/{document_id}/{file_name}. Anything else has no application and is refused.
create function document_app_id(object_name text) returns uuid language plpgsql immutable set search_path = public as $$
declare p text[] := string_to_array(object_name, '/');
        uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if coalesce(array_length(p, 1), 0) <> 3 or coalesce(p[3], '') = '' or p[1] !~* uuid_re or p[2] !~* uuid_re then return null; end if;
  return p[1]::uuid;
end $$;

drop policy docs_bucket_read on storage.objects;
create policy docs_bucket_read on storage.objects for select using (
  bucket_id = 'application-documents' and public.document_app_id(name) is not null and public.can_view_documents(public.document_app_id(name)));

drop policy docs_bucket_write on storage.objects;
create policy docs_bucket_write on storage.objects for insert with check (
  bucket_id = 'application-documents' and public.has_role('riya','kushal')
  and public.document_app_id(name) is not null
  and exists (select 1 from public.applications a where a.id = public.document_app_id(name))
  and public.can_view_documents(public.document_app_id(name)));
-- No UPDATE or DELETE policy on this bucket: stored documents are never moved, overwritten or removed by clients.

-- ============================================================================ 6. Privileges: anonymous denied, no RLS-bypassing statements
-- RLS never applies to TRUNCATE, so it must not be granted to client roles; anon gets nothing at all.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated;

-- Functions: client-callable RPCs for signed-in users only; internals for nobody.
revoke execute on function grant_document_access(uuid, uuid, text), revoke_document_access(uuid, uuid, text),
  submit_for_partner_review(uuid, text), reopen_application(uuid, text) from public, anon;
grant execute on function grant_document_access(uuid, uuid, text), revoke_document_access(uuid, uuid, text),
  submit_for_partner_review(uuid, text), reopen_application(uuid, text) to authenticated, service_role;
revoke execute on function write_audit(uuid, text, text, text, uuid, text) from public, anon, authenticated, service_role;
revoke execute on function apply_partner_decision(), set_initial_cycle(), audit_events_immutable() from public, anon, authenticated;
