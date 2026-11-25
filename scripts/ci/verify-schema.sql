-- Expected final schema after applying ALL supabase/migrations (plus supabase/seed.sql) to a fresh database.
-- Run by CI against the disposable local Supabase database (docs/CI.md). Read-only: it only inspects catalogs and
-- counts rows; any mismatch raises an exception (psql ON_ERROR_STOP makes the step fail).
--
-- Update the expectations IN THE SAME CHANGE as a migration that legitimately alters them.

do $$
declare
  expected_tables text[] := array[
    'application_cycles','application_views','applications','assessment_evidence','audit_events','availability_rules',
    'claim_evidence','claims','companies','company_founders','conflicts','criteria_versions','criterion_assessments',
    'document_pages','documents','evaluations','evidence_sources','extracted_fields','feedback_corrections','founders',
    'jobs','learning_rules','meeting_slots','partner_decisions','portfolio_companies','portfolio_datasets',
    'portfolio_overlap_checks','profiles','research_tasks','thesis_versions'];
  expected_functions text[] := array['can_view_documents','current_role_name','guard_decision_on_failure','has_role','is_member'];
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

  -- 3. Policy counts (53 in public: 27 read policies created in a loop + 26 explicit).
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
  if not exists (select 1 from pg_trigger where tgname = 'applications_failure_guard' and not tgisinternal) then
    problems := problems || 'missing trigger applications_failure_guard'::text;
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
  raise notice 'Schema verification passed: % tables, RLS enabled+forced on all, 53 public policies, storage policies, 13 enums, % functions, trigger, private bucket, reference seed only.',
    array_length(expected_tables, 1), array_length(expected_functions, 1);
end $$;
