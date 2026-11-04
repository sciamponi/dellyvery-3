-- Regressao do endurecimento final:
--   * search_path de todas as funcoes SECURITY DEFINER;
--   * acesso de authenticated a dellyvery_private;
--   * sequestro de funcoes por pg_temp (objeto sombra);
--   * event trigger para funcoes futuras;
--   * TRUNCATE/REFERENCES/TRIGGER e default privileges.
--
-- Execucao local (apos 20261115000000):
--   Get-Content -Raw supabase/tests/rls_security_definer_hardening.sql |
--     docker exec -i <container> psql -U supabase_admin -d <db> -v ON_ERROR_STOP=1
-- Transacao revertida ao final. Falha: RAISE EXCEPTION.

\set ON_ERROR_STOP on

begin;

do $$
declare
  v_bad text;
  v_bad_cfg text;
  v_before uuid;
  v_after uuid;
  v_member_before boolean;
  v_member_after boolean;
  v_probe text := 'public.__dellyvery_acl_probe_regression()';
  v_probe_oid oid;
  v_actor uuid := 'd1111111-1111-4111-8111-111111111111';
  v_company uuid := 'd2222222-2222-4222-8222-222222222222';
begin
  -- 1) Event trigger fail-closed ativo.
  if not exists (
    select 1
    from pg_event_trigger
    where evtname = 'dellyvery3_revoke_new_function_acl'
      and evtenabled in ('O', 'A')
  ) then
    raise exception 'FAIL 1: event trigger de funcoes futuras ausente/desabilitado';
  end if;
  raise notice 'PASS 1: event trigger ativo';

  -- 2) Toda funcao SECURITY DEFINER tem search_path determinista e pg_temp por ultimo.
  select string_agg(
           p.oid::regprocedure::text || '=' || coalesce(array_to_string(p.proconfig, ','), '<null>'),
           ', ' order by p.oid
         )
    into v_bad_cfg
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'dellyvery_private')
    and p.prokind = 'f'
    and p.prosecdef
    and coalesce(array_to_string(p.proconfig, ','), '') not in (
      'search_path=pg_catalog, public, pg_temp',
      'search_path=pg_catalog, dellyvery_private, pg_temp',
      'search_path=pg_catalog, pg_temp'
    );

  if v_bad_cfg is not null then
    raise exception 'FAIL 2: search_path inseguro: %', v_bad_cfg;
  end if;
  raise notice 'PASS 2: search_path determinista em todas as funcoes SECURITY DEFINER';

  -- 3) Nenhuma funcao SECURITY DEFINER executa como PUBLIC.
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid)
    into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'dellyvery_private')
    and p.prokind = 'f'
    and p.prosecdef
    and has_function_privilege('public', p.oid, 'EXECUTE');

  if v_bad is not null then
    raise exception 'FAIL 3: funcao SECURITY DEFINER executavel por PUBLIC: %', v_bad;
  end if;
  raise notice 'PASS 3: nenhuma funcao SECURITY DEFINER executavel por PUBLIC';

  -- 4) dellyvery_private continua sem USAGE/ACESSO para roles de API.
  if has_schema_privilege('public', 'dellyvery_private', 'USAGE')
     or has_schema_privilege('anon', 'dellyvery_private', 'USAGE')
     or has_schema_privilege('authenticated', 'dellyvery_private', 'USAGE')
     or has_schema_privilege('service_role', 'dellyvery_private', 'USAGE') then
    raise exception 'FAIL 4: dellyvery_private com USAGE exposto';
  end if;

  if has_function_privilege(
       'authenticated',
       'dellyvery_private.begin_reseller_write_context(text,uuid,uuid,uuid)',
       'EXECUTE'
     )
     or has_table_privilege(
       'authenticated',
       'dellyvery_private.reseller_write_context',
       'SELECT'
     ) then
    raise exception 'FAIL 4b: authenticated com EXECUTE/SELECT em dellyvery_private';
  end if;
  raise notice 'PASS 4: dellyvery_private inacessivel para roles de API';

  -- 5) authenticated nao consegue chamar funcao privada.
  execute 'set role authenticated';
  begin
    perform dellyvery_private.begin_reseller_write_context(
      'activation', gen_random_uuid(), gen_random_uuid(), gen_random_uuid()
    );
    execute 'reset role';
    raise exception 'FAIL 5: authenticated executou funcao privada';
  exception when insufficient_privilege then
    execute 'reset role';
  end;
  raise notice 'PASS 5: authenticated bloqueado em funcao privada';

  -- 6) Objeto temporario sombra nao sequestra current_reseller_id().
  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set role authenticated';
  select public.current_reseller_id() into v_before;
  drop table if exists pg_temp.resellers;
  create temp table resellers (id uuid, user_id uuid, status text);
  insert into pg_temp.resellers values (gen_random_uuid(), v_actor, 'ativo');
  select public.current_reseller_id() into v_after;
  drop table pg_temp.resellers;
  execute 'reset role';
  if v_after is distinct from v_before then
    raise exception 'FAIL 6: current_reseller_id leu pg_temp.resellers (before=%, after=%)', v_before, v_after;
  end if;
  raise notice 'PASS 6: current_reseller_id ignora pg_temp.resellers';

  -- 7) Objeto temporario sombra nao sequestra is_company_member_raw().
  execute 'set role authenticated';
  select public.is_company_member_raw(v_company) into v_member_before;
  drop table if exists pg_temp.company_members;
  create temp table company_members (
    company_id uuid,
    user_id uuid,
    role public.company_role,
    active boolean
  );
  insert into pg_temp.company_members values (v_company, v_actor, 'OWNER', true);
  select public.is_company_member_raw(v_company) into v_member_after;
  drop table pg_temp.company_members;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  if v_member_after is distinct from v_member_before then
    raise exception 'FAIL 7: is_company_member_raw leu pg_temp.company_members (before=%, after=%)',
      v_member_before, v_member_after;
  end if;
  raise notice 'PASS 7: is_company_member_raw ignora pg_temp.company_members';

  -- 8) Funcao criada agora nasce sem EXECUTE para PUBLIC/anon/authenticated/service_role.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise exception 'FAIL 8: role de teste sem CREATE em public para o probe';
  end if;
  execute 'drop function if exists ' || v_probe;
  execute 'create function ' || v_probe || ' returns integer language sql as ''select 1''';
  v_probe_oid := v_probe::regprocedure::oid;

  if has_function_privilege('public', v_probe_oid, 'EXECUTE')
     or has_function_privilege('anon', v_probe_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_probe_oid, 'EXECUTE')
     or has_function_privilege('service_role', v_probe_oid, 'EXECUTE') then
    raise exception 'FAIL 8b: funcao nova nasceu executavel por PUBLIC/API';
  end if;
  execute 'drop function ' || v_probe;
  raise notice 'PASS 8: funcao futura nasce sem EXECUTE para PUBLIC/API';

  -- 9) TRUNCATE/REFERENCES/TRIGGER removidos de PUBLIC/anon/authenticated.
  if exists (
    select 1
    from pg_class c
    cross join lateral (
      values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
    ) p(privilege_name)
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
      and (
        has_table_privilege('public', c.oid, p.privilege_name)
        or has_table_privilege('anon', c.oid, p.privilege_name)
        or has_table_privilege('authenticated', c.oid, p.privilege_name)
      )
  ) then
    raise exception 'FAIL 9: TRUNCATE/REFERENCES/TRIGGER ainda exposto a PUBLIC/API';
  end if;

  -- Preservacao deliberada: backend/service_role mantem os privilegios historicos.
  if not has_table_privilege('service_role', 'public.orders', 'TRUNCATE') then
    raise exception 'FAIL 9b: service_role perdeu TRUNCATE em public.orders';
  end if;
  raise notice 'PASS 9: privilegios nao-DML removidos da API e preservados em service_role';

  -- 10) Default ACL de funcoes em public sem grants para PUBLIC/API.
  if exists (
    select 1
    from pg_default_acl d
    cross join lateral aclexplode(d.defaclacl) a
    where d.defaclnamespace = 'public'::regnamespace
      and d.defaclobjtype = 'f'
      and pg_get_userbyid(d.defaclrole) in ('postgres', 'supabase_admin')
      and (
        a.grantee = 0
        or a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)
      )
  ) then
    raise exception 'FAIL 10: default ACL de funcoes em public com PUBLIC/API';
  end if;
  raise notice 'PASS 10: default ACL de funcoes em public sem PUBLIC/API';
end;
$$;

rollback;
