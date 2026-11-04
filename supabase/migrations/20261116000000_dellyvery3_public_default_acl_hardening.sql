-- Dellyvery3: endurecimento dos Default ACLs de tabelas em public.
--
-- Escopo:
--   * revoga MAINTAIN/TRUNCATE/REFERENCES/TRIGGER de PUBLIC/anon/authenticated
--     nas tabelas publicas existentes;
--   * aplica o mesmo conjunto restrito aos objetos futuros criados por postgres
--     e, quando o runner tiver permissao, por supabase_admin;
--   * preserva SELECT/INSERT/UPDATE/DELETE, USAGE de sequencias e todos os
--     privilegios de service_role.
--
-- Nao altera sequencias: no PostgreSQL 17 nao existe MAINTAIN em sequencias e
-- revogar USAGE quebraria colunas identity/serial. Nao altera RLS, policies,
-- funcoes de negocio, dados ou outros schemas.
--
-- Requer PostgreSQL 17+ e execucao em runner transacional.
--
-- Limitacao do runner padrao: `postgres` nao e superuser nem membro de
-- supabase_admin neste ambiente. Nesse caso o bloco de supabase_admin e
-- ignorado com NOTICE e o postflight reporta a pendencia, sem fingir que foi
-- corrigida. Alternativa segura quando o runner for postgres:
--
--   psql "$SUPABASE_DB_URL" -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c "
--     alter default privileges for role supabase_admin in schema public
--       revoke maintain, truncate, references, trigger on tables
--       from public, anon, authenticated;"
--
-- Objetos de aplicacao em public sao criados por postgres; a pendencia de
-- supabase_admin so afeta objetos futuros criados por supabase_admin.

-- =========================
-- 0. Preflight
-- =========================
do $preflight$
declare
  v_is_super boolean := coalesce(
    (select rolsuper from pg_roles where rolname = current_user),
    false
  );
  v_bad text;
begin
  if current_user::text not in ('postgres', 'supabase_admin') and not v_is_super then
    raise exception 'Migration deve rodar como postgres/supabase_admin/superuser; atual=%',
      current_user;
  end if;

  if current_setting('server_version_num')::int < 170000 then
    raise exception 'PostgreSQL 17+ e necessario para revogar MAINTAIN; atual=%',
      current_setting('server_version');
  end if;

  if not exists (select 1 from pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'Roles anon/authenticated/service_role ausentes';
  end if;

  if not exists (select 1 from pg_namespace where nspname = 'public') then
    raise exception 'Schema public ausente';
  end if;

  -- Falha cedo se alguma tabela tiver owner que o runner nao consegue alterar.
  select string_agg(
           format('%I (owner=%s)', c.relname, pg_get_userbyid(c.relowner)),
           ', ' order by c.relname
         )
    into v_bad
  from pg_class c
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('r', 'p')
    and not (
      v_is_super
      or c.relowner = current_user::regrole
      or pg_has_role(current_user, pg_get_userbyid(c.relowner), 'MEMBER')
    );

  if v_bad is not null then
    raise exception 'Sem ownership/membership para revogar privilegios: %', v_bad;
  end if;

  raise notice 'Preflight ok: roles, schema, versao e ownership';
end
$preflight$;

-- =========================
-- 1. Snapshot dos privilegios DML existentes
-- =========================
-- Usado no postflight para provar que a migration nao removeu DML legitimo.
drop table if exists pg_temp._dellyvery_acl_dml_before;
create temp table _dellyvery_acl_dml_before as
select c.oid as relid, a.grantee, a.privilege_type
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(c.relacl) a
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');

drop table if exists pg_temp._dellyvery_default_dml_before;
create temp table _dellyvery_default_dml_before as
select d.defaclrole, d.defaclnamespace, d.defaclobjtype,
       a.grantee, a.privilege_type
from pg_default_acl d
cross join lateral aclexplode(d.defaclacl) a
where d.defaclnamespace = 'public'::regnamespace
  and d.defaclobjtype = 'r'
  and d.defaclrole in (to_regrole('postgres'), to_regrole('supabase_admin'))
  and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');

-- =========================
-- 2. Defaults para objetos futuros criados por postgres
-- =========================
-- Nao usar REVOKE ALL: isso removeria DML e quebraria novas tabelas.
alter default privileges for role postgres in schema public
  revoke maintain, truncate, references, trigger on tables
  from public, anon, authenticated;

-- =========================
-- 3. Defaults de supabase_admin, quando o runner puder altera-los
-- =========================
do $supabase_admin_defaults$
declare
  v_can boolean := false;
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    v_can := current_user::text = 'supabase_admin'
      or coalesce(
           (select rolsuper from pg_roles where rolname = current_user),
           false
         )
      or pg_has_role(current_user, 'supabase_admin', 'MEMBER');
  end if;

  if v_can then
    execute 'alter default privileges for role supabase_admin in schema public '
         || 'revoke maintain, truncate, references, trigger on tables '
         || 'from public, anon, authenticated';
    raise notice 'Defaults de supabase_admin endurecidos';
  else
    raise notice 'PENDENTE: supabase_admin sem membership/superuser; defaults de supabase_admin nao alterados. Execute como supabase_admin: ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE MAINTAIN, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM public, anon, authenticated;';
  end if;
end
$supabase_admin_defaults$;

-- =========================
-- 4. Tabelas existentes: remove apenas privilegios administrativos
-- =========================
do $revoke_table_privileges$
declare
  v_tbl record;
  v_count int := 0;
begin
  for v_tbl in
    select c.relname
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
    order by c.relname
  loop
    execute format(
      'revoke maintain, truncate, references, trigger on table public.%I '
      || 'from public, anon, authenticated',
      v_tbl.relname
    );
    v_count := v_count + 1;
  end loop;

  raise notice 'Privilegios administrativos revogados de PUBLIC/anon/authenticated em % tabelas publicas',
    v_count;
end
$revoke_table_privileges$;

-- =========================
-- 5. Snapshot DML depois e postflight
-- =========================
drop table if exists pg_temp._dellyvery_acl_dml_after;
create temp table _dellyvery_acl_dml_after as
select c.oid as relid, a.grantee, a.privilege_type
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(c.relacl) a
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');

drop table if exists pg_temp._dellyvery_default_dml_after;
create temp table _dellyvery_default_dml_after as
select d.defaclrole, d.defaclnamespace, d.defaclobjtype,
       a.grantee, a.privilege_type
from pg_default_acl d
cross join lateral aclexplode(d.defaclacl) a
where d.defaclnamespace = 'public'::regnamespace
  and d.defaclobjtype = 'r'
  and d.defaclrole in (to_regrole('postgres'), to_regrole('supabase_admin'))
  and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');

do $postflight$
declare
  v_bad text;
  v_pending text;
  v_can_supabase_admin boolean := false;
  v_is_super boolean := coalesce(
    (select rolsuper from pg_roles where rolname = current_user),
    false
  );
begin
  -- 1) Nenhuma tabela public com privilegio administrativo exposto a API.
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
    raise exception 'Tabela public com privilegio administrativo exposto: %', v_bad;
  end if;

  -- 2) Defaults de postgres sem privilegio administrativo para PUBLIC/API.
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
    raise exception 'Default ACL de postgres ainda expoe privilegio administrativo: %', v_bad;
  end if;

  -- 3) Defaults de supabase_admin: verifica se foram corrigidos; se nao,
  --    reporta pendencia em vez de assumir sucesso.
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
    into v_pending
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

  if v_pending is not null then
    if v_can_supabase_admin then
      raise exception 'Default ACL de supabase_admin ainda expoe privilegio administrativo: %', v_pending;
    else
      raise notice 'PENDENTE (nao corrigido neste runner): supabase_admin public/tables = %', v_pending;
    end if;
  else
    raise notice 'Defaults de supabase_admin sem privilegios administrativos para PUBLIC/API';
  end if;

  -- 4) DML de tabelas existentes nao foi alterado.
  if exists (
    (select * from _dellyvery_acl_dml_before
     except
     select * from _dellyvery_acl_dml_after)
    union all
    (select * from _dellyvery_acl_dml_after
     except
     select * from _dellyvery_acl_dml_before)
  ) then
    raise exception 'DML de tabelas public foi alterado pela migration';
  end if;

  -- 5) DML dos Default ACLs nao foi alterado.
  if exists (
    (select * from _dellyvery_default_dml_before
     except
     select * from _dellyvery_default_dml_after)
    union all
    (select * from _dellyvery_default_dml_after
     except
     select * from _dellyvery_default_dml_before)
  ) then
    raise exception 'DML dos Default ACLs de public foi alterado pela migration';
  end if;

  -- 6) service_role preservado.
  if not has_table_privilege('service_role', 'public.orders', 'TRUNCATE') then
    raise exception 'service_role perdeu TRUNCATE em public.orders';
  end if;

  if exists (
    select 1
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
      and not has_table_privilege('service_role', c.oid, 'SELECT')
  ) then
    raise exception 'service_role perdeu SELECT em tabela public';
  end if;

  raise notice 'Postflight ok: privilegios administrativos removidos, DML e service_role preservados';
end
$postflight$;

drop table if exists pg_temp._dellyvery_acl_dml_before;
drop table if exists pg_temp._dellyvery_acl_dml_after;
drop table if exists pg_temp._dellyvery_default_dml_before;
drop table if exists pg_temp._dellyvery_default_dml_after;

notify pgrst, 'reload schema';
