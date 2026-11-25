-- Expected final schema after applying ALL supabase/migrations (plus supabase/seed.sql) to a fresh database.
-- Run by CI against the disposable local Supabase database (docs/CI.md). Read-only: it only inspects catalogs and
-- counts rows; any mismatch raises an exception (psql ON_ERROR_STOP makes the step fail).
--
-- Update the expectations IN THE SAME CHANGE as a migration that legitimately alters them.

do $$
declare
  expected_tables text[] := array[
    'application_access_grants','application_cycles','application_views','applications','assessment_evidence','audit_events','availability_rules',
    'claim_evidence','claims','companies','company_founders','conflicts','criteria_versions','criterion_assessments',
    'document_pages','documents','evaluations','evidence_sources','extracted_fields','feedback_corrections','founders',
    'jobs','learning_rules','meeting_slots','partner_decisions','portfolio_companies','portfolio_datasets',
    'portfolio_overlap_checks','profiles','research_tasks','thesis_versions'];
  expected_functions text[] := array['apply_partner_decision','audit_events_immutable','can_view_company','can_view_documents',
    'current_role_name','document_app_id','grant_document_access','guard_decision_on_failure','has_role','is_member',
    'reopen_application','revoke_document_access','set_initial_cycle','submit_for_partner_review','write_audit'];
  expected_triggers text[] := array['applications_failure_guard','partner_decisions_apply','application_cycles_set_current',
    'audit_events_append_only','audit_events_no_truncate'];
  problems text[] := '{}';
  t text;
  n int;
begin
  -- 1. Every expected table exists, and no unexpected table appeared in public.
  foreach t in array expected_tables loop
    if not exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
                   where s.nspname = 'public' and c.relname = t and c.relkind = 'r') then
      problems := problems || format('missing table public.%s', t);
    end if;
  end loop;
  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind = 'r' and c.relname <> all(expected_tables) loop
    problems := problems || format('unexpected table public.%s (add it to verify-schema.sql if intended)', t);
  end loop;

  -- 2. Row Level Security is ENABLED and FORCED on every public table, and every table has at least one policy.
  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity) loop
    problems := problems || format('RLS not enabled+forced on public.%s', t);
  end loop;
  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind = 'r'
             and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) loop
    problems := problems || format('no RLS policy on public.%s', t);
  end loop;

  -- 3. Policy counts (53 in public: 0002 had 27 loop read policies + 26 explicit; 0003 drops audit_insert and adds
  --    application_access_grants_read; every other 0003 policy replaces one of the same name).
  select count(*) into n from pg_policies where schemaname = 'public';
  if n <> 53 then problems := problems || format('expected 53 public policies, found %s', n); end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'docs_bucket_read')
     or not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'docs_bucket_write') then
    problems := problems || 'storage.objects policies docs_bucket_read / docs_bucket_write missing'::text;
  end if;

  -- 4. Types, functions, trigger.
  select count(*) into n from pg_type ty join pg_namespace s on s.oid = ty.typnamespace where s.nspname = 'public' and ty.typtype = 'e';
  if n <> 13 then problems := problems || format('expected 13 enum types in public, found %s', n); end if;
  foreach t in array expected_functions loop
    if not exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = t) then
      problems := problems || format('missing function public.%s', t);
    end if;
  end loop;
  foreach t in array expected_triggers loop
    if not exists (select 1 from pg_trigger where tgname = t and not tgisinternal) then
      problems := problems || format('missing trigger %s', t);
    end if;
  end loop;

  -- 4b. Privilege hardening (0003). RLS does not govern these, so they are asserted structurally here and
  --     behaviourally in supabase/security-tests/rls_attacks.sql.
  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind = 'r'
             and (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) loop
    problems := problems || format('anon has privileges on public.%s', t);
  end loop;
  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind = 'r' and has_table_privilege('authenticated', c.oid, 'TRUNCATE') loop
    problems := problems || format('authenticated can TRUNCATE public.%s (TRUNCATE bypasses RLS)', t);
  end loop;
  if has_column_privilege('authenticated', 'public.applications', 'decision_status', 'UPDATE') then
    problems := problems || 'authenticated can UPDATE applications.decision_status directly'::text;
  end if;
  if has_table_privilege('authenticated', 'public.audit_events', 'INSERT,UPDATE,DELETE') then
    problems := problems || 'authenticated can write audit_events directly'::text;
  end if;
  if has_table_privilege('authenticated', 'public.application_access_grants', 'INSERT,UPDATE,DELETE') then
    problems := problems || 'authenticated can write application_access_grants directly'::text;
  end if;
  if has_function_privilege('authenticated', 'public.write_audit(uuid,text,text,text,uuid,text)', 'EXECUTE') then
    problems := problems || 'authenticated can call write_audit'::text;
  end if;
  if has_function_privilege('anon', 'public.grant_document_access(uuid,uuid,text)', 'EXECUTE') then
    problems := problems || 'anon can call grant_document_access'::text;
  end if;

  -- 5. Private document bucket (never public).
  if not exists (select 1 from storage.buckets where id = 'application-documents' and public = false) then
    problems := problems || 'private bucket application-documents missing or public'::text;
  end if;

  -- 6. Seed: reference data only, exact counts (no founder or application data is ever seeded).
  select count(*) into n from portfolio_datasets;   if n <> 1 then problems := problems || format('expected 1 portfolio dataset, found %s', n); end if;
  select count(*) into n from portfolio_companies;  if n <> 7 then problems := problems || format('expected 7 portfolio companies, found %s', n); end if;
  select count(*) into n from availability_rules;   if n <> 6 then problems := problems || format('expected 6 availability rules, found %s', n); end if;
  select count(*) into n from applications;         if n <> 0 then problems := problems || format('applications must be empty after seed, found %s', n); end if;
  select count(*) into n from documents;            if n <> 0 then problems := problems || format('documents must be empty after seed, found %s', n); end if;

  if array_length(problems, 1) > 0 then
    raise exception E'Schema verification FAILED (% problem(s)):\n  - %', array_length(problems, 1), array_to_string(problems, E'\n  - ');
  end if;
  raise notice 'Schema verification passed: % tables, RLS enabled+forced on all, 53 public policies, storage policies, 13 enums, % functions, % triggers, privilege hardening, private bucket, reference seed only.',
    array_length(expected_tables, 1), array_length(expected_functions, 1), array_length(expected_triggers, 1);
end $$;
