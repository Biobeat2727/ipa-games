-- Read-only check after phase_a_2_lockdown.sql. Changes nothing.
-- Expected: only the "kept" policies listed in the lockdown file; anon holds
-- SELECT on players and buzzes and nothing else on these four tables; anon can't
-- execute the three old phone function signatures.

select 'policy' as kind, tablename as object, policyname as detail, cmd, roles::text as who
from pg_policies
where schemaname = 'public' and tablename in ('players', 'teams', 'buzzes', 'wagers')

union all

select 'table grant', table_name, privilege_type, null, grantee
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('players', 'teams', 'buzzes', 'wagers')
  and grantee in ('anon', 'PUBLIC')

union all

select 'old function', p.oid::regprocedure::text,
       case when has_function_privilege('anon', p.oid, 'execute') then 'anon CAN execute' else 'anon cannot execute' end,
       null, null
from pg_proc as p
where p.oid in (
  'public.claim_question_selection(uuid, uuid, uuid, text)'::regprocedure,
  'public.confirm_question_selection(uuid, uuid, uuid, text, integer)'::regprocedure,
  'public.submit_final_response(uuid, uuid, text, text)'::regprocedure
)

order by 1, 2, 3;
