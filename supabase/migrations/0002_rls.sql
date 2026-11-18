-- Row Level Security. Mirrors src/lib/domain/permissions.ts (MATRIX + canViewDocuments).
-- All tables are private: no anon access. Service-role key is used only by server-side jobs, never in the browser.

create or replace function current_role_name() returns app_role language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active
$$;

create or replace function is_member() returns boolean language sql stable as $$ select current_role_name() is not null $$;
create or replace function has_role(variadic roles app_role[]) returns boolean language sql stable as $$ select current_role_name() = any(roles) $$;

-- Aditya: documents of deeptech/hardware applications only.
create or replace function can_view_documents(app uuid) returns boolean language sql stable as $$
  select case current_role_name()
    when 'kushal' then true
    when 'riya' then true
    when 'aditya' then exists (select 1 from applications a where a.id = app and (a.sector_key = 'deeptech' or a.tags && array['deeptech','hardware']))
    else false end
$$;

do $$
declare t text;
begin
  foreach t in array array['profiles','companies','founders','company_founders','applications','application_cycles','application_views','documents','document_pages','extracted_fields','claims','evidence_sources','claim_evidence','conflicts','research_tasks','thesis_versions','criteria_versions','evaluations','criterion_assessments','assessment_evidence','feedback_corrections','learning_rules','portfolio_datasets','portfolio_companies','portfolio_overlap_checks','partner_decisions','availability_rules','meeting_slots','audit_events','jobs']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- Read: every member reads application-level data (Kushal must see every application).
do $$
declare t text;
begin
  foreach t in array array['companies','founders','company_founders','applications','application_cycles','application_views','extracted_fields','claims','evidence_sources','claim_evidence','conflicts','research_tasks','thesis_versions','criteria_versions','evaluations','criterion_assessments','assessment_evidence','feedback_corrections','learning_rules','portfolio_datasets','portfolio_companies','portfolio_overlap_checks','partner_decisions','availability_rules','meeting_slots','audit_events','jobs']
  loop
    execute format('create policy %I on %I for select using (is_member())', t || '_read', t);
  end loop;
end $$;

create policy profiles_read on profiles for select using (is_member());

-- Documents and page text: role-scoped.
create policy documents_read on documents for select using (can_view_documents(application_id));
create policy document_pages_read on document_pages for select using (exists (select 1 from documents d where d.id = document_id and can_view_documents(d.application_id)));

-- Intake / extraction / research (Riya, Kushal; Aditya may add evidence and update research).
create policy applications_insert on applications for insert with check (has_role('riya','kushal'));
create policy applications_update on applications for update using (has_role('riya','kushal')) with check (has_role('riya','kushal'));
create policy documents_insert on documents for insert with check (has_role('riya','kushal'));
create policy pages_insert on document_pages for insert with check (has_role('riya','kushal'));
create policy fields_write on extracted_fields for update using (has_role('riya','kushal'));
create policy evidence_insert on evidence_sources for insert with check (has_role('riya','kushal','aditya') and added_by = auth.uid());
create policy claim_evidence_insert on claim_evidence for insert with check (has_role('riya','kushal','aditya'));
create policy research_update on research_tasks for update using (has_role('riya','kushal','aditya'));
create policy conflicts_update on conflicts for update using (has_role('riya','kushal'));
create policy views_insert on application_views for insert with check (user_id = auth.uid());

-- Corrections: any member, as themselves. Learning-rule approval: partners only.
create policy corrections_insert on feedback_corrections for insert with check (is_member() and reviewer = auth.uid());
create policy rules_insert on learning_rules for insert with check (is_member() and proposed_by = auth.uid());
create policy rules_decide on learning_rules for update using (has_role('kushal','aditya')) with check (decided_by = auth.uid());

-- Rubric: anyone proposes; only Kushal approves.
create policy criteria_propose on criteria_versions for insert with check (is_member() and status = 'proposed');
create policy criteria_approve on criteria_versions for update using (has_role('kushal'));

-- Final decisions: Kushal only, as himself, and only after he has opened the application.
create policy decisions_insert on partner_decisions for insert with check (
  has_role('kushal') and decided_by = auth.uid()
  and exists (select 1 from application_views v where v.application_id = partner_decisions.application_id and v.user_id = auth.uid())
);
create policy cycles_insert on application_cycles for insert with check (has_role('kushal') or (has_role('riya') and number = 1));

-- Portfolio: Riya/Kushal edit; Kushal reviews overlap and verifies datasets.
create policy portfolio_ds_insert on portfolio_datasets for insert with check (has_role('kushal','riya'));
create policy portfolio_co_insert on portfolio_companies for insert with check (has_role('kushal','riya'));
create policy overlap_review on portfolio_overlap_checks for update using (has_role('kushal'));

-- Scheduling.
create policy availability_write on availability_rules for all using (has_role('riya','kushal')) with check (has_role('riya','kushal'));
create policy slots_write on meeting_slots for all using (has_role('riya','kushal')) with check (has_role('riya','kushal') and calendar_synced = false);

-- Audit log is append-only for members; nobody updates or deletes it.
create policy audit_insert on audit_events for insert with check (is_member() and (actor = auth.uid()));
-- (no update/delete policies → denied)

-- Evaluations, assessments, overlap checks, jobs, claims, conflicts are written by the server-side job runner
-- using the service role (bypasses RLS) — never from the browser.

-- ---------------------------------------------------------------- storage: private bucket, signed URLs only
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('application-documents', 'application-documents', false, 26214400,
  array['application/pdf','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','text/plain','text/markdown'])
on conflict (id) do nothing;

-- Object path convention: {application_id}/{document_id}/{original_filename}
create policy docs_bucket_read on storage.objects for select using (
  bucket_id = 'application-documents' and can_view_documents(((storage.foldername(name))[1])::uuid)
);
create policy docs_bucket_write on storage.objects for insert with check (
  bucket_id = 'application-documents' and has_role('riya','kushal')
);
