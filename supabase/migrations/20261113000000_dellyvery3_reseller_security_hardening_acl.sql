-- Dellyvery3: hardening final de ACL/default privileges (P0-P4).
-- Depende de 20261112000000 (contexto de escrita do revendedor).
-- Decisoes:
--   * nova migration, sem editar migrations historicas;
--   * privilégio efetivo das funcoes de extensions, nao schema fixo;
--   * default privileges apenas em dellyvery_private;
--   * allowlist funcional minima de EXECUTE para anon/authenticated/service_role.
--
-- Observacao A4: o EXECUTE padrao de PUBLIC em FUNCTIONS e embutido no PostgreSQL
-- e nao pode ser removido com ALTER DEFAULT PRIVILEGES IN SCHEMA. O isolamento de
-- funcoes futuras em dellyvery_private depende do USAGE do schema permanecer
-- revogado de PUBLIC/anon/authenticated/service_role. O postflight valida isso.
--
-- Observacao A5: os defaults de public continuam amplos para objetos criados por
-- postgres/supabase_admin. Novas funcoes publicas precisam de revoke/grant
-- explicito em migration; esta allowlist e um retrato dos objetos existentes, nao
-- uma protecao automatica para objetos futuros.
--
-- Atomicidade: esta migration nao abre BEGIN/COMMIT. O runner deve executa-la
-- dentro de uma transacao. Se o runner nao for transacional, uma falha depois de
-- P2 pode deixar default privileges aplicados antes da allowlist; as verificacoes
-- continuam fail-closed, mas a atomicidade nao e garantida pela migration.

-- P0: preflight de role, dependencias e privilegios efetivos de extensions.
do $preflight$
declare
  v_is_super boolean := coalesce((select rolsuper from pg_roles where rolname = current_user), false);
  v_owner oid;
begin
  if current_user::text not in ('postgres', 'supabase_admin') then
    raise exception 'Migration deve rodar como postgres/supabase_admin; atual=%', current_user;
  end if;

  if not v_is_super and not pg_has_role(current_user, 'postgres', 'MEMBER') then
    raise exception 'Role atual sem privilegio para ajustar objetos de postgres: %', current_user;
  end if;

  if to_regprocedure('public.is_reseller_write_context_active(text,uuid,uuid,uuid)') is null
     or to_regclass('dellyvery_private.reseller_write_context') is null then
    raise exception 'Dependencia de 20261112000000 ausente (contexto de escrita do revendedor)';
  end if;

  if to_regprocedure('public.claim_reseller_client_invite_legacy(text)') is null
     or to_regprocedure('public.create_reseller_client_invite(uuid)') is null
     or to_regprocedure('public.resolve_reseller_client_invite(text)') is null
     or to_regprocedure('public.claim_reseller_client_invite(text)') is null then
    raise exception 'Dependencia de convites de revenda ausente';
  end if;

  if to_regprocedure('public.expire_plan_purchase_requests()') is not null
     or to_regprocedure('public.confirm_plan_purchase_request(uuid,numeric,text,text)') is not null
     or to_regprocedure('public.expire_reseller_credit_orders()') is not null
     or to_regprocedure('public.confirm_reseller_credit_order(uuid,numeric,text)') is not null then
    raise exception '20261113000000 nao pode ser reaplicada depois das migrations financeiras; restaure o backup e reaplique na ordem';
  end if;

  if to_regnamespace('extensions') is null
     or to_regprocedure('extensions.digest(bytea,text)') is null
     or to_regprocedure('extensions.digest(text,text)') is null
     or to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception 'Funcoes esperadas de extensions ausentes';
  end if;

  -- A3: as funcoes de convite usam extensions.* diretamente. Exigir DEFINER
  -- evita que o caller da API precise de privilegio efetivo em extensions. Se
  -- alguma delas virar INVOKER, a preflight falha em vez de herdar um grant
  -- implicito ou depender do contexto do caller.
  if exists (
    select 1
    from pg_proc p
    where p.oid in (
      to_regprocedure('public.claim_reseller_client_invite_legacy(text)'),
      to_regprocedure('public.create_reseller_client_invite(uuid)'),
      to_regprocedure('public.resolve_reseller_client_invite(text)'),
      to_regprocedure('public.claim_reseller_client_invite(text)')
    )
      and not p.prosecdef
  ) then
    raise exception 'Funcoes de convite que usam extensions devem ser SECURITY DEFINER';
  end if;

  if not has_schema_privilege('postgres', 'dellyvery_private', 'CREATE') then
    raise exception 'postgres sem CREATE em dellyvery_private';
  end if;

  for v_owner in
    select distinct p.proowner
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'dellyvery_private')
      and p.prokind = 'f'
      and (p.prosrc ilike '%extensions.digest%' or p.prosrc ilike '%extensions.gen_random_bytes%')
  loop
    if not has_schema_privilege(v_owner, 'extensions', 'USAGE') then
      raise exception 'Owner % sem USAGE em extensions', v_owner::regrole;
    end if;
    if not has_function_privilege(v_owner, 'extensions.digest(bytea,text)', 'EXECUTE')
       or not has_function_privilege(v_owner, 'extensions.digest(text,text)', 'EXECUTE')
       or not has_function_privilege(v_owner, 'extensions.gen_random_bytes(integer)', 'EXECUTE') then
      raise exception 'Owner % sem EXECUTE efetivo nas funcoes de extensions', v_owner::regrole;
    end if;
  end loop;

  raise notice 'P0 ok: preflight de roles, dependencias e extensions';
end
$preflight$;

-- P1/P3: allowlist funcional minima. Funcoes fora desta lista ficam sem
-- EXECUTE para PUBLIC/anon/authenticated/service_role.
--
-- A1: a matriz abaixo combina callers conhecidos no frontend/Edge/cron com
-- grants historicos justificados. service_role so permanece onde ha caller
-- operacional ou decisao explicita; nao remover grants sem confirmar o hosted.
drop table if exists pg_temp._dellyvery_acl_allowlist;
create temporary table _dellyvery_acl_allowlist (
  signature text primary key,
  roles text[] not null,
  function_oid oid
);

insert into _dellyvery_acl_allowlist (signature, roles) values
  ('public.activate_reseller_client_v2(uuid,uuid,uuid)', array['authenticated']),
  -- A2: preserva o grant historico de authenticated; nao ha caller de
  -- service_role no repositorio. Nao ampliar ate confirmar o ambiente hosted.
  ('public.anonymize_lead_ips(integer)', array['authenticated']),
  ('public.approve_reseller_access(uuid,uuid,uuid)', array['service_role']),
  ('public.cancel_reseller_credit_order(uuid,text)', array['authenticated','service_role']),
  ('public.claim_reseller_client_invite(text)', array['authenticated']),
  ('public.claim_reseller_invite(text,jsonb)', array['anon','authenticated','service_role']),
  ('public.company_has_active_access(uuid)', array['authenticated','service_role']),
  ('public.confirm_reseller_credit_order(uuid,text)', array['authenticated','service_role']),
  ('public.create_company_with_owner(text,text,uuid,text,text,text,text)', array['authenticated','service_role']),
  ('public.create_lead(jsonb)', array['anon','authenticated','service_role']),
  ('public.create_order(text,text,text,jsonb,jsonb,uuid,text,text,text,numeric,uuid,text,numeric,numeric,numeric,uuid)', array['anon','authenticated','service_role']),
  ('public.create_reseller_client_invite(uuid)', array['authenticated','service_role']),
  ('public.create_reseller_credit_order(uuid,uuid)', array['authenticated','service_role']),
  ('public.create_reseller_invite(text,text)', array['authenticated','service_role']),
  ('public.current_reseller_id()', array['authenticated']),
  ('public.delete_table_if_unused(uuid)', array['authenticated','service_role']),
  ('public.ensure_master_reseller_access()', array['authenticated','service_role']),
  ('public.get_my_reseller_client_access()', array['authenticated']),
  ('public.get_order_by_token(uuid)', array['anon','authenticated','service_role']),
  ('public.get_storefront_by_slug(text)', array['anon','authenticated','service_role']),
  ('public.grant_reseller_credits(uuid,integer,text)', array['authenticated','service_role']),
  ('public.is_company_member(uuid)', array['anon','authenticated','service_role']),
  ('public.is_company_member_raw(uuid)', array['anon','authenticated','service_role']),
  ('public.is_platform_admin()', array['anon','authenticated','service_role']),
  ('public.is_reseller()', array['authenticated']),
  ('public.is_reseller_write_context_active(text,uuid,uuid,uuid)', array['authenticated','service_role']),
  ('public.is_valid_cnpj(text)', array['anon','authenticated','service_role']),
  ('public.is_valid_cpf(text)', array['anon','authenticated','service_role']),
  ('public.list_reseller_client_invites()', array['authenticated','service_role']),
  ('public.list_team(uuid)', array['authenticated','service_role']),
  ('public.manage_order(uuid,text,text,text,jsonb,numeric,jsonb,text)', array['authenticated','service_role']),
  ('public.manage_subscription(text,uuid)', array['authenticated','service_role']),
  ('public.member_role(uuid)', array['anon','authenticated','service_role']),
  ('public.next_order_number(uuid)', array['authenticated']),
  ('public.rbac_actor_role(uuid)', array['authenticated','service_role']),
  ('public.record_reseller_invite_email_proof(uuid,uuid,text,integer)', array['service_role']),
  ('public.reseller_credit_balance(uuid)', array['authenticated','service_role']),
  ('public.reseller_lookup_auth_user(text)', array['service_role']),
  ('public.resolve_reseller_client_invite(text)', array['anon','authenticated','service_role']),
  ('public.resolve_reseller_invite(text)', array['anon','authenticated','service_role']),
  ('public.resolve_table_token(text)', array['anon','authenticated','service_role']),
  ('public.revoke_reseller_client_invite(uuid)', array['authenticated','service_role']),
  ('public.set_lead_status(uuid,text)', array['authenticated','service_role']),
  ('public.sweep_expired_reseller_invites()', array['authenticated','service_role']);

do $resolve_allowlist$
declare
  v_bad text;
begin
  select string_agg(signature, ', ' order by signature)
    into v_bad
  from _dellyvery_acl_allowlist
  where to_regprocedure(signature) is null;

  if v_bad is not null then
    raise exception 'Assinaturas inexistentes na allowlist: %', v_bad;
  end if;

  update _dellyvery_acl_allowlist
     set function_oid = to_regprocedure(signature);

  if exists (select 1 from _dellyvery_acl_allowlist where function_oid is null) then
    raise exception 'Falha ao resolver OID da allowlist';
  end if;

  if exists (
    select 1
    from _dellyvery_acl_allowlist
    group by function_oid
    having count(*) > 1
  ) then
    raise exception 'Allowlist contem assinaturas duplicadas para o mesmo OID';
  end if;

  raise notice 'P1 ok: % funcoes na allowlist', (select count(*) from _dellyvery_acl_allowlist);
end
$resolve_allowlist$;

-- P1b: ownership/capacidade de alterar todas as funcoes antes de tocar em ACL.
-- A6: falhar aqui evita aplicar default privileges e depois descobrir que o
-- runner nao consegue alterar uma funcao de outro owner.
do $ownership_preflight$
declare
  v_is_super boolean := coalesce((select rolsuper from pg_roles where rolname = current_user), false);
  v_bad text;
begin
  select string_agg(format('%s (owner=%s)', p.oid::regprocedure, pg_get_userbyid(p.proowner)), ', ' order by p.oid)
    into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'dellyvery_private')
    and p.prokind = 'f'
    and not (
      v_is_super
      or p.proowner = current_user::regrole
      or pg_has_role(current_user, pg_get_userbyid(p.proowner), 'MEMBER')
    );

  if v_bad is not null then
    raise exception 'Role % sem ownership/membership para alterar funcoes: %', current_user, v_bad;
  end if;

  raise notice 'P1b ok: ownership/capacidade de alterar funcoes validada';
end
$ownership_preflight$;

-- P2: default privileges restritos a dellyvery_private. Executado somente depois
-- de resolver a allowlist e validar ownership para reduzir a janela de falha em
-- runners nao transacionais.
alter default privileges for role postgres in schema dellyvery_private
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema dellyvery_private
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema dellyvery_private
  revoke execute on functions from public, anon, authenticated, service_role;

do $supabase_admin_defaults$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin')
     and (current_user::text = 'supabase_admin'
          or coalesce((select rolsuper from pg_roles where rolname = current_user), false)
          or pg_has_role(current_user, 'supabase_admin', 'MEMBER')) then
    execute 'alter default privileges for role supabase_admin in schema dellyvery_private revoke all on tables from public, anon, authenticated, service_role';
    execute 'alter default privileges for role supabase_admin in schema dellyvery_private revoke all on sequences from public, anon, authenticated, service_role';
    execute 'alter default privileges for role supabase_admin in schema dellyvery_private revoke execute on functions from public, anon, authenticated, service_role';
  else
    raise notice 'supabase_admin ausente ou sem membership; defaults privados aplicados apenas a postgres';
  end if;
end
$supabase_admin_defaults$;

do $apply_allowlist$
declare
  v_fn record;
  v_roles text[];
begin
  for v_fn in
    select p.oid,
           n.nspname,
           p.proname,
           format('%I.%I(%s)', n.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid)) as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'dellyvery_private')
      and p.prokind = 'f'
    order by p.oid
  loop
    select roles into v_roles
    from _dellyvery_acl_allowlist
    where function_oid = v_fn.oid;

    v_roles := coalesce(v_roles, array[]::text[]);

    execute format('revoke all on function %s from public, anon, authenticated, service_role',
                   v_fn.signature);

    if 'anon' = any(v_roles) then
      execute format('grant execute on function %s to anon', v_fn.signature);
    end if;
    if 'authenticated' = any(v_roles) then
      execute format('grant execute on function %s to authenticated', v_fn.signature);
    end if;
    if 'service_role' = any(v_roles) then
      execute format('grant execute on function %s to service_role', v_fn.signature);
    end if;
  end loop;

  raise notice 'P3 ok: ACL aplicada em public/dellyvery_private';
end
$apply_allowlist$;

-- P4: postflight dos invariantes.
do $postflight$
declare
  v_fn record;
  v_roles text[];
  v_owner oid;
  v_api_roles oid[] := array[
    'anon'::regrole,
    'authenticated'::regrole,
    'service_role'::regrole
  ];
begin
  for v_fn in
    select p.oid,
           n.nspname,
           p.proname,
           pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'dellyvery_private')
      and p.prokind = 'f'
    order by p.oid
  loop
    select roles into v_roles
    from _dellyvery_acl_allowlist
    where function_oid = v_fn.oid;

    v_roles := coalesce(v_roles, array[]::text[]);

    if has_function_privilege('public', v_fn.oid, 'EXECUTE') then
      raise exception 'PUBLIC ainda executa %.%', v_fn.nspname, v_fn.proname;
    end if;
    if has_function_privilege('anon', v_fn.oid, 'EXECUTE') <> ('anon' = any(v_roles)) then
      raise exception 'Grant anon divergente em %.%(%)', v_fn.nspname, v_fn.proname, v_fn.args;
    end if;
    if has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') <> ('authenticated' = any(v_roles)) then
      raise exception 'Grant authenticated divergente em %.%(%)', v_fn.nspname, v_fn.proname, v_fn.args;
    end if;
    if has_function_privilege('service_role', v_fn.oid, 'EXECUTE') <> ('service_role' = any(v_roles)) then
      raise exception 'Grant service_role divergente em %.%(%)', v_fn.nspname, v_fn.proname, v_fn.args;
    end if;
  end loop;

  -- A2: o grant historico de anonymize_lead_ips e authenticated, nao
  -- service_role; nao ampliar sem confirmacao do hosted.
  if not has_function_privilege('authenticated', 'public.anonymize_lead_ips(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.anonymize_lead_ips(integer)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.anonymize_lead_ips(integer)', 'EXECUTE') then
    raise exception 'Grant de anonymize_lead_ips divergente do historico (authenticated apenas)';
  end if;

  -- A3: as quatro funcoes de convite devem continuar SECURITY DEFINER.
  if exists (
    select 1
    from pg_proc p
    where p.oid in (
      to_regprocedure('public.claim_reseller_client_invite_legacy(text)'),
      to_regprocedure('public.create_reseller_client_invite(uuid)'),
      to_regprocedure('public.resolve_reseller_client_invite(text)'),
      to_regprocedure('public.claim_reseller_client_invite(text)')
    )
      and not p.prosecdef
  ) then
    raise exception 'Funcoes de convite que usam extensions perderam SECURITY DEFINER';
  end if;

  for v_owner in
    select distinct p.proowner
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'dellyvery_private')
      and p.prokind = 'f'
      and (p.prosrc ilike '%extensions.digest%' or p.prosrc ilike '%extensions.gen_random_bytes%')
  loop
    if not has_schema_privilege(v_owner, 'extensions', 'USAGE')
       or not has_function_privilege(v_owner, 'extensions.digest(bytea,text)', 'EXECUTE')
       or not has_function_privilege(v_owner, 'extensions.digest(text,text)', 'EXECUTE')
       or not has_function_privilege(v_owner, 'extensions.gen_random_bytes(integer)', 'EXECUTE') then
      raise exception 'Privilegio efetivo de extensions invalido para owner %', v_owner::regrole;
    end if;
  end loop;

  if has_schema_privilege('public', 'dellyvery_private', 'USAGE')
     or has_schema_privilege('anon', 'dellyvery_private', 'USAGE')
     or has_schema_privilege('authenticated', 'dellyvery_private', 'USAGE')
     or has_schema_privilege('service_role', 'dellyvery_private', 'USAGE') then
    raise exception 'dellyvery_private com USAGE exposto a PUBLIC/API';
  end if;

  if has_schema_privilege('public', 'dellyvery_private', 'CREATE')
     or has_schema_privilege('anon', 'dellyvery_private', 'CREATE')
     or has_schema_privilege('authenticated', 'dellyvery_private', 'CREATE')
     or has_schema_privilege('service_role', 'dellyvery_private', 'CREATE') then
    raise exception 'dellyvery_private com CREATE exposto a PUBLIC/API';
  end if;

  if not has_schema_privilege('postgres', 'dellyvery_private', 'CREATE') then
    raise exception 'postgres perdeu CREATE em dellyvery_private';
  end if;

  if has_schema_privilege('public', 'public', 'CREATE')
     or has_schema_privilege('anon', 'public', 'CREATE')
     or has_schema_privilege('authenticated', 'public', 'CREATE')
     or has_schema_privilege('service_role', 'public', 'CREATE') then
    raise exception 'public com CREATE exposto a PUBLIC/API';
  end if;

  if exists (
    select 1
    from pg_class c
    cross join lateral (
      values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
    ) p(privilege_name)
    where c.relnamespace = 'dellyvery_private'::regnamespace
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and (
        has_table_privilege('public', c.oid, p.privilege_name)
        or has_table_privilege('anon', c.oid, p.privilege_name)
        or has_table_privilege('authenticated', c.oid, p.privilege_name)
        or has_table_privilege('service_role', c.oid, p.privilege_name)
      )
  ) then
    raise exception 'Tabela de dellyvery_private com privilegio exposto a PUBLIC/API';
  end if;

  if exists (
    select 1
    from pg_default_acl d
    cross join lateral aclexplode(d.defaclacl) a
    where d.defaclnamespace = 'dellyvery_private'::regnamespace
      and pg_get_userbyid(d.defaclrole) in ('postgres', 'supabase_admin')
      and (a.grantee = 0 or a.grantee = any(v_api_roles))
  ) then
    raise exception 'Default ACL de dellyvery_private contem grants para PUBLIC/API';
  end if;

  raise notice 'P4 ok: postflight de ACL/default privileges concluido';
end
$postflight$;

drop table if exists pg_temp._dellyvery_acl_allowlist;

notify pgrst, 'reload schema';
