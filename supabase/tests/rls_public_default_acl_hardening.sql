-- Regressao da migration 20261116000000_dellyvery3_public_default_acl_hardening.sql
--
-- Confirma:
--   * anon/authenticated sem MAINTAIN/TRUNCATE/REFERENCES/TRIGGER em public;
--   * DML legitimo preservado em tabelas existentes e novas;
--   * service_role preservado;
--   * tabela nova criada por postgres sem privilegios administrativos para API;
--   * identity/sequence continua funcional;
--   * RLS habilitado em todas as tabelas publicas;
--   * dellyvery_private inacessivel para as roles de API.
--
-- Execucao local (depois da migration 20261116000000):
--
--   1) como postgres (runner padrao; valida defaults de postgres e faz SKIP
--      explicito da verificacao de supabase_admin):
--      Get-Content -Raw supabase/tests/rls_public_default_acl_hardening.sql |
--        docker exec -i supabase_db_dellyvery-3 psql -U postgres -d postgres -v ON_ERROR_STOP=1
--
--   2) como supabase_admin, depois de aplicar a remediacao dos defaults dele
--      (valida tambem uma tabela nova criada por supabase_admin):
--      Get-Content -Raw supabase/tests/rls_public_default_acl_hardening.sql |
--        docker exec -i supabase_db_dellyvery-3 psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1
--
-- Tudo roda em transacao e termina com rollback. Fixtures temporarias/probes
-- sao removidas pelo proprio rollback.
--
-- Observacao sobre supabase_admin: se o runner da migration foi postgres sem
-- membership, os defaults de supabase_admin ficam PENDENTES. O teste nao
-- presume que foram corrigidos: como postgres ele faz SKIP; como supabase_admin
-- ele falha e imprime o comando de remediacao.

\set ON_ERROR_STOP on

begin;

do $$
declare
  v_is_super boolean := coalesce(
    (select rolsuper from pg_roles where rolname = current_user),
    false
  );
  v_can_supabase_admin boolean := false;
  v_bad text;
  v_probe_pg text := 'public.__dellyvery_acl_probe_pg';
  v_probe_sa text := 'public.__dellyvery_acl_probe_sa';
  v_seq text;
  v_id_anon bigint;
  v_id_auth bigint;
  v_id_updated bigint;
  v_id_deleted bigint;
  v_count int;
  v_n int := 0;
begin
  if current_user::text not in ('postgres', 'supabase_admin') and not v_is_super then
    raise exception 'FAIL 0: teste deve rodar como postgres/supabase_admin/superuser; atual=%',
      current_user;
  end if;

  if current_setting('server_version_num')::int < 170000 then
    raise exception 'FAIL 0b: PostgreSQL 17+ necessario para MAINTAIN; atual=%',
      current_setting('server_version');
  end if;

  if to_regnamespace('dellyvery_private') is null then
    raise exception 'FAIL 0c: schema dellyvery_private ausente';
  end if;

  v_n := v_n + 1;
  raise notice 'PASS 0 (%/12): ambiente e preflight', v_n;

  -- 1) Tabelas existentes sem privilegios administrativos para API.
  select string_agg(
           format('%s:%s', c.relname, p.privilege_name),
           ', ' order by c.relname, p.privilege_name
         )
    into v_bad
  from pg_class c
  cross join lateral (
    values ('MAINTAIN'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
  ) p(privilege_name)
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('r', 'p')
    and (
      has_table_privilege('public', c.oid, p.privilege_name)
      or has_table_privilege('anon', c.oid, p.privilege_name)
      or has_table_privilege('authenticated', c.oid, p.privilege_name)
    );

  if v_bad is not null then
    raise exception 'FAIL 1: privilegio administrativo exposto em public: %', v_bad;
  end if;

  v_n := v_n + 1;
  raise notice 'PASS % (%/12): MAINTAIN/TRUNCATE/REFERENCES/TRIGGER ausentes para anon/authenticated', v_n, v_n;

  -- 2) DML existente preservado (contrato conhecido de orders).
  if not (
    has_table_privilege('anon', 'public.orders', 'SELECT')
    and has_table_privilege('anon', 'public.orders', 'INSERT')
    and has_table_privilege('anon', 'public.orders', 'UPDATE')
    and has_table_privilege('anon', 'public.orders', 'DELETE')
    and has_table_privilege('authenticated', 'public.orders', 'SELECT')
    and has_table_privilege('authenticated', 'public.orders', 'INSERT')
    and has_table_privilege('authenticated', 'public.orders', 'UPDATE')
    and has_table_privilege('authenticated', 'public.orders', 'DELETE')
  ) then
    raise exception 'FAIL 2: DML de public.orders nao foi preservado';
  end if;

  v_n := v_n + 1;
  raise notice 'PASS % (%/12): DML de anon/authenticated preservado em public.orders', v_n, v_n;

  -- 3) service_role preservado.
  if not (
    has_table_privilege('service_role', 'public.orders', 'SELECT')
    and has_table_privilege('service_role', 'public.orders', 'INSERT')
    and has_table_privilege('service_role', 'public.orders', 'UPDATE')
    and has_table_privilege('service_role', 'public.orders', 'DELETE')
    and has_table_privilege('service_role', 'public.orders', 'TRUNCATE')
  ) then
    raise exception 'FAIL 3: service_role perdeu privilegios necessarios em public.orders';
  end if;

  v_n := v_n + 1;
  raise notice 'PASS % (%/12): service_role preservado', v_n, v_n;

  -- 4) Default ACL de postgres sem privilegios administrativos para API.
  select string_agg(
           format('%s:%s', a.privilege_type, a.grantee::regrole),
           ', ' order by a.privilege_type, a.grantee::regrole::text
         )
    into v_bad
  from pg_default_acl d
  join pg_roles r on r.oid = d.defaclrole
  cross join lateral aclexplode(d.defaclacl) a
  where d.defaclnamespace = 'public'::regnamespace
    and d.defaclobjtype = 'r'
    and r.rolname = 'postgres'
    and a.privilege_type in ('MAINTAIN', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
    and (
      a.grantee = 0
      or a.grantee in ('anon'::regrole, 'authenticated'::regrole)
    );

  if v_bad is not null then
    raise exception 'FAIL 4: Default ACL de postgres ainda expoe privilegio administrativo: %', v_bad;
  end if;

  v_n := v_n + 1;
  raise notice 'PASS % (%/12): Default ACL de postgres endurecido', v_n, v_n;

  -- 5) Tabela nova criada por postgres nasce com DML e sem admin para API.
  execute 'set role postgres';
  execute 'drop table if exists public.__dellyvery_acl_probe_pg cascade';
  execute 'create table public.__dellyvery_acl_probe_pg '
       || '(id bigint generated always as identity primary key, note text not null default '''')';
  execute 'alter table public.__dellyvery_acl_probe_pg enable row level security';
  execute 'create policy __dellyvery_acl_probe_pg_anon on public.__dellyvery_acl_probe_pg '
       || 'for all to anon using (true) with check (true)';
  execute 'create policy __dellyvery_acl_probe_pg_auth on public.__dellyvery_acl_probe_pg '
       || 'for all to authenticated using (true) with check (true)';
  execute 'reset role';

  if has_table_privilege('anon', v_probe_pg, 'MAINTAIN')
     or has_table_privilege('anon', v_probe_pg, 'TRUNCATE')
     or has_table_privilege('anon', v_probe_pg, 'REFERENCES')
     or has_table_privilege('anon', v_probe_pg, 'TRIGGER')
     or has_table_privilege('authenticated', v_probe_pg, 'MAINTAIN')
     or has_table_privilege('authenticated', v_probe_pg, 'TRUNCATE')
     or has_table_privilege('authenticated', v_probe_pg, 'REFERENCES')
     or has_table_privilege('authenticated', v_probe_pg, 'TRIGGER') then
    raise exception 'FAIL 5: tabela nova de postgres herdou privilegio administrativo';
  end if;

  if not (
    has_table_privilege('anon', v_probe_pg, 'SELECT')
    and has_table_privilege('anon', v_probe_pg, 'INSERT')
    and has_table_privilege('anon', v_probe_pg, 'UPDATE')
    and has_table_privilege('anon', v_probe_pg, 'DELETE')
    and has_table_privilege('authenticated', v_probe_pg, 'SELECT')
    and has_table_privilege('authenticated', v_probe_pg, 'INSERT')
    and has_table_privilege('authenticated', v_probe_pg, 'UPDATE')
    and has_table_privilege('authenticated', v_probe_pg, 'DELETE')
  ) then
    raise exception 'FAIL 5b: tabela nova de postgres perdeu DML para anon/authenticated';
  end if;

  if not has_table_privilege('service_role', v_probe_pg, 'TRUNCATE') then
    raise exception 'FAIL 5c: tabela nova de postgres perdeu TRUNCATE de service_role';
  end if;

  v_n := v_n + 1;
  raise notice 'PASS % (%/12): tabela nova de postgres sem admin e com DML preservado', v_n, v_n;

  -- 6) Identity/sequence: insert real como anon e authenticated.
  select pg_get_serial_sequence(v_probe_pg, 'id') into v_seq;
  if v_seq is null then
    raise exception 'FAIL 6: identity sequence nao encontrada em %', v_probe_pg;
  end if;

  if not has_sequence_privilege('anon', v_seq, 'USAGE')
     or not has_sequence_privilege('authenticated', v_seq, 'USAGE')
     or not has_sequence_privilege('service_role', v_seq, 'USAGE') then
    raise exception 'FAIL 6b: USAGE de sequencia ausente para role de API/backend';
  end if;

  execute 'set role anon';
  execute 'insert into public.__dellyvery_acl_probe_pg (note) values (''anon'') returning id'
    into v_id_anon;
  execute 'select count(*) from public.__dellyvery_acl_probe_pg where note = ''anon'''
    into v_count;
  execute 'reset role';

  if v_id_anon is null or v_id_anon <= 0 or v_count <> 1 then
    raise exception 'FAIL 6c: insert identity como anon falhou (id=%, count=%)',
      v_id_anon, v_count;
  end if;

  execute 'set role authenticated';
  execute 'insert into public.__dellyvery_acl_probe_pg (note) values (''authenticated'') returning id'
    into v_id_auth;
  execute format(
    'update public.__dellyvery_acl_probe_pg set note = %L where id = %s returning id',
    'authenticated-updated', v_id_auth
  ) into v_id_updated;
  execute format(
    'delete from public.__dellyvery_acl_probe_pg where id = %s returning id',
    v_id_auth
  ) into v_id_deleted;
  execute 'reset role';

  if v_id_auth is null or v_id_auth <= 0
     or v_id_updated is distinct from v_id_auth
     or v_id_deleted is distinct from v_id_auth then
    raise exception 'FAIL 6d: DML/identity como authenticated falhou (id=%, upd=%, del=%)',
      v_id_auth, v_id_updated, v_id_deleted;
  end if;

  v_n := v_n + 1;
  raise notice 'PASS % (%/12): identity e DML real funcionam para anon/authenticated', v_n, v_n;

  -- 7) RLS habilitado em todas as tabelas publicas (inclui probes).
  select count(*) into v_count
  from pg_class c
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('r', 'p')
    and not c.relrowsecurity;

  if v_count <> 0 then
    raise exception 'FAIL 7: % tabela(s) publica(s) sem RLS', v_count;
  end if;

  v_n := v_n + 1;
  raise notice 'PASS % (%/12): RLS habilitado em todas as tabelas publicas', v_n, v_n;

  -- 8) dellyvery_private inacessivel para roles de API.
  if has_schema_privilege('public', 'dellyvery_private', 'USAGE')
     or has_schema_privilege('anon', 'dellyvery_private', 'USAGE')
     or has_schema_privilege('authenticated', 'dellyvery_private', 'USAGE')
     or has_schema_privilege('service_role', 'dellyvery_private', 'USAGE') then
    raise exception 'FAIL 8: dellyvery_private com USAGE exposto';
  end if;

  if to_regclass('dellyvery_private.reseller_write_context') is not null then
    if has_table_privilege('anon', 'dellyvery_private.reseller_write_context', 'SELECT')
       or has_table_privilege('authenticated', 'dellyvery_private.reseller_write_context', 'SELECT')
       or has_table_privilege('service_role', 'dellyvery_private.reseller_write_context', 'SELECT') then
      raise exception 'FAIL 8b: tabela de contexto privado acessivel por role de API';
    end if;
  end if;

  v_n := v_n + 1;
  raise notice 'PASS % (%/12): dellyvery_private inacessivel para roles de API', v_n, v_n;

  -- 9) Defaults de supabase_admin: nao presumir correcao.
  v_can_supabase_admin := exists (
    select 1 from pg_roles where rolname = 'supabase_admin'
  ) and (
    current_user::text = 'supabase_admin'
    or v_is_super
    or pg_has_role(current_user, 'supabase_admin', 'MEMBER')
  );

  select string_agg(
           format('%s:%s', a.privilege_type, a.grantee::regrole),
           ', ' order by a.privilege_type, a.grantee::regrole::text
         )
    into v_bad
  from pg_default_acl d
  join pg_roles r on r.oid = d.defaclrole
  cross join lateral aclexplode(d.defaclacl) a
  where d.defaclnamespace = 'public'::regnamespace
    and d.defaclobjtype = 'r'
    and r.rolname = 'supabase_admin'
    and a.privilege_type in ('MAINTAIN', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
    and (
      a.grantee = 0
      or a.grantee in ('anon'::regrole, 'authenticated'::regrole)
    );

  if v_bad is not null then
    if v_can_supabase_admin then
      raise exception 'FAIL 9: Default ACL de supabase_admin ainda expoe %. Rode como supabase_admin: ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE MAINTAIN, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM public, anon, authenticated;', v_bad;
    else
      raise notice 'SKIP 9: runner sem membership/superuser para alterar supabase_admin; pendencia reportada: %', v_bad;
    end if;
  elsif v_can_supabase_admin then
    execute 'set role supabase_admin';
    execute 'drop table if exists public.__dellyvery_acl_probe_sa cascade';
    execute 'create table public.__dellyvery_acl_probe_sa '
         || '(id bigint generated always as identity primary key, note text)';
    execute 'alter table public.__dellyvery_acl_probe_sa enable row level security';
    execute 'reset role';

    if has_table_privilege('anon', v_probe_sa, 'MAINTAIN')
       or has_table_privilege('anon', v_probe_sa, 'TRUNCATE')
       or has_table_privilege('anon', v_probe_sa, 'REFERENCES')
       or has_table_privilege('anon', v_probe_sa, 'TRIGGER')
       or has_table_privilege('authenticated', v_probe_sa, 'MAINTAIN')
       or has_table_privilege('authenticated', v_probe_sa, 'TRUNCATE')
       or has_table_privilege('authenticated', v_probe_sa, 'REFERENCES')
       or has_table_privilege('authenticated', v_probe_sa, 'TRIGGER') then
      raise exception 'FAIL 9b: tabela nova de supabase_admin herdou privilegio administrativo';
    end if;

    raise notice 'PASS 9: Default ACL e tabela nova de supabase_admin endurecidos';
  else
    raise notice 'SKIP 9: runner sem membership/superuser para criar tabela como supabase_admin';
  end if;

  v_n := v_n + 1;
  raise notice 'PASS % (%/12): tratamento de supabase_admin verificado/reportado', v_n, v_n;

  -- 10) Default ACL de sequencias preservado para anon/authenticated/service_role.
  if not exists (
    select 1
    from pg_default_acl d
    join pg_roles r on r.oid = d.defaclrole
    cross join lateral aclexplode(d.defaclacl) a
    where d.defaclnamespace = 'public'::regnamespace
      and d.defaclobjtype = 'S'
      and r.rolname = 'postgres'
      and a.grantee = 'anon'::regrole
      and a.privilege_type = 'USAGE'
  ) or not exists (
    select 1
    from pg_default_acl d
    join pg_roles r on r.oid = d.defaclrole
    cross join lateral aclexplode(d.defaclacl) a
    where d.defaclnamespace = 'public'::regnamespace
      and d.defaclobjtype = 'S'
      and r.rolname = 'postgres'
      and a.grantee = 'authenticated'::regrole
      and a.privilege_type = 'USAGE'
  ) or not exists (
    select 1
    from pg_default_acl d
    join pg_roles r on r.oid = d.defaclrole
    cross join lateral aclexplode(d.defaclacl) a
    where d.defaclnamespace = 'public'::regnamespace
      and d.defaclobjtype = 'S'
      and r.rolname = 'postgres'
      and a.grantee = 'service_role'::regrole
      and a.privilege_type = 'USAGE'
  ) then
    raise exception 'FAIL 10: Default ACL de sequencias perdeu USAGE para anon/authenticated/service_role';
  end if;

  v_n := v_n + 1;
  raise notice 'PASS % (%/12): USAGE de sequencias preservado', v_n, v_n;

  -- 11) Nenhuma funcao public/dellyvery_private executavel por PUBLIC.
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'dellyvery_private')
      and p.prokind = 'f'
      and has_function_privilege('public', p.oid, 'EXECUTE')
  ) then
    raise exception 'FAIL 11: funcao ainda executavel por PUBLIC';
  end if;

  v_n := v_n + 1;
  raise notice 'PASS % (%/12): PUBLIC sem EXECUTE em funcoes', v_n, v_n;

  raise notice 'ALL PASS (%/12)', v_n;
end;
$$;

rollback;
