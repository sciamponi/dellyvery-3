-- Follow-up da auditoria S0-S8 para o endurecimento de seguranca da revenda.
--
-- Depende de 20261111000000_dellyvery3_reseller_security_hardening.sql.
--
-- Objetivos:
--   1. normalizar ownership das funcoes criticas para postgres;
--   2. declarar grants/revokes explicitamente;
--   3. substituir o marcador global por um contexto privado escopado por
--      operacao/revendedor/cliente/usuario;
--   4. remover a confianca generica em current_user postgres/supabase_admin;
--   5. validar postflight de owners, search_path, grants, trigger e contexto;
--   6. preservar o grant historico de service_role no cancelamento, sem usa-lo
--      como autorizacao.
--
-- O runner deve aplicar esta migration dentro de uma transacao. O arquivo nao
-- usa BEGIN/COMMIT explicitamente para nao conflitar com o runner do Supabase.
--
-- No baseline local atual, as funcoes de 20261111000000 pertencem a
-- supabase_admin e postgres nao e membro desse role. Nesse caso, execute esta
-- migration como supabase_admin; o preflight falha de forma explicita se o
-- executor nao puder assumir o ownership.

-- =========================
-- 1. Preflight
-- =========================
do $preflight$
declare
  v_is_super boolean := coalesce(
    (select r.rolsuper from pg_roles r where r.rolname = current_user),
    false
  );
  v_sig text;
  v_owner text;
  v_public_sigs text[] := array[
    'public.activate_reseller_client_v2(uuid,uuid,uuid)',
    'public.activate_reseller_client_v2_legacy(uuid,uuid,uuid)',
    'public.cancel_reseller_credit_order(uuid,text)',
    'public.cancel_reseller_credit_order_legacy(uuid,text)',
    'public.guard_reseller_client_write()'
  ];
  v_private_sigs text[] := array[
    'dellyvery_private.begin_reseller_write_context(text,uuid,uuid,uuid)',
    'dellyvery_private.end_reseller_write_context(text,uuid,uuid,uuid)',
    'public.is_reseller_write_context_active(text,uuid,uuid,uuid)'
  ];
begin
  if current_user::text not in ('postgres', 'supabase_admin') then
    raise exception 'Migration deve ser executada como postgres ou supabase_admin; usuario atual: %', current_user;
  end if;

  if not v_is_super and not pg_has_role(current_user, 'postgres'::name, 'MEMBER') then
    raise exception 'Usuario % nao pode definir ownership para postgres', current_user;
  end if;

  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise exception 'Usuario % nao tem CREATE no schema public', current_user;
  end if;

  if to_regclass('public.reseller_clients') is null then
    raise exception 'Tabela public.reseller_clients ausente; aplique a migration base antes';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'reseller_clients'
      and column_name in ('user_id', 'company_id', 'activated_at', 'access_expires_at')
    group by table_schema, table_name
    having count(*) = 4
  ) then
    raise exception 'Colunas de vinculo ausentes em public.reseller_clients';
  end if;

  foreach v_sig in array v_public_sigs loop
    if to_regprocedure(v_sig) is null then
      raise exception 'Funcao obrigatoria ausente: %; aplique 20261111000000 primeiro', v_sig;
    end if;
  end loop;

  if to_regprocedure('public.claim_reseller_client_invite(text)') is null
     and to_regprocedure('public.claim_reseller_client_invite_legacy(text)') is null then
    raise exception 'Funcao public.claim_reseller_client_invite(text) ausente';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.reseller_clients'::regclass
      and t.tgname = 'trg_reseller_client_guard'
      and not t.tgisinternal
      and t.tgenabled = 'O'
      and (t.tgtype & 1) <> 0
      and (t.tgtype & 2) <> 0
      and (t.tgtype & 4) <> 0
      and (t.tgtype & 16) <> 0
      and t.tgattr = ''::int2vector
      and t.tgqual is null
      and t.tgfoid = to_regprocedure('public.guard_reseller_client_write()')
  ) then
    raise exception 'Trigger trg_reseller_client_guard ausente ou incompleto; aplique 20261111000000 primeiro';
  end if;

  for v_sig in select unnest(v_public_sigs) loop
    select pg_get_userbyid(p.proowner)::text
      into v_owner
    from pg_proc p
    where p.oid = to_regprocedure(v_sig);

    if v_owner is null then
      raise exception 'Nao foi possivel ler o owner de %', v_sig;
    end if;

    if not v_is_super and not pg_has_role(current_user, v_owner::name, 'MEMBER') then
      raise exception
        'Funcao % pertence a %; usuario % nao pode altera-la. Execute como supabase_admin.',
        v_sig, v_owner, current_user;
    end if;
  end loop;

  if to_regprocedure('public.claim_reseller_client_invite(text)') is not null then
    select pg_get_userbyid(p.proowner)::text
      into v_owner
    from pg_proc p
    where p.oid = to_regprocedure('public.claim_reseller_client_invite(text)');

    if not v_is_super and not pg_has_role(current_user, v_owner::name, 'MEMBER') then
      raise exception
        'Funcao public.claim_reseller_client_invite(text) pertence a %; usuario % nao pode altera-la.',
        v_owner, current_user;
    end if;
  end if;

  if to_regprocedure('public.claim_reseller_client_invite_legacy(text)') is not null then
    select pg_get_userbyid(p.proowner)::text
      into v_owner
    from pg_proc p
    where p.oid = to_regprocedure('public.claim_reseller_client_invite_legacy(text)');

    if not v_is_super and not pg_has_role(current_user, v_owner::name, 'MEMBER') then
      raise exception
        'Funcao public.claim_reseller_client_invite_legacy(text) pertence a %; usuario % nao pode altera-la.',
        v_owner, current_user;
    end if;
  end if;

  if to_regprocedure('public.is_reseller_activation_in_progress()') is not null then
    select pg_get_userbyid(p.proowner)::text
      into v_owner
    from pg_proc p
    where p.oid = to_regprocedure('public.is_reseller_activation_in_progress()');

    if not v_is_super and not pg_has_role(current_user, v_owner::name, 'MEMBER') then
      raise exception
        'Funcao public.is_reseller_activation_in_progress() pertence a %; usuario % nao pode altera-la.',
        v_owner, current_user;
    end if;
  end if;

  if to_regprocedure('public.current_reseller_id()') is null
     or to_regprocedure('public.is_platform_admin()') is null then
    raise exception 'Helpers public.current_reseller_id()/public.is_platform_admin() ausentes';
  end if;

  if not has_function_privilege('postgres'::name, 'public.current_reseller_id()', 'EXECUTE') then
    raise exception 'postgres sem EXECUTE em public.current_reseller_id()';
  end if;
  if not has_function_privilege('postgres'::name, 'public.is_platform_admin()', 'EXECUTE') then
    raise exception 'postgres sem EXECUTE em public.is_platform_admin()';
  end if;
  if not has_schema_privilege('postgres'::name, 'auth', 'USAGE') then
    raise exception 'postgres sem USAGE no schema auth';
  end if;
  if to_regprocedure('auth.uid()') is null or to_regprocedure('auth.role()') is null then
    raise exception 'Funcoes auth.uid()/auth.role() ausentes';
  end if;

  if to_regnamespace('dellyvery_private') is null then
    if not has_database_privilege(current_user, current_database(), 'CREATE') then
      raise exception 'Usuario % nao pode criar o schema dellyvery_private', current_user;
    end if;
  else
    select pg_get_userbyid(n.nspowner)::text
      into v_owner
    from pg_namespace n
    where n.nspname = 'dellyvery_private';

    if not v_is_super and not pg_has_role(current_user, v_owner::name, 'MEMBER') then
      raise exception
        'Schema dellyvery_private pertence a %; usuario % nao pode altera-lo. Execute como supabase_admin.',
        v_owner, current_user;
    end if;
  end if;

  if to_regclass('dellyvery_private.reseller_write_context') is not null then
    select pg_get_userbyid(c.relowner)::text
      into v_owner
    from pg_class c
    where c.oid = to_regclass('dellyvery_private.reseller_write_context');

    if not v_is_super and not pg_has_role(current_user, v_owner::name, 'MEMBER') then
      raise exception
        'Tabela dellyvery_private.reseller_write_context pertence a %; usuario % nao pode altera-la.',
        v_owner, current_user;
    end if;

    if (
      select array_agg(
        a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text
        order by a.attnum
      )
      from pg_attribute a
      where a.attrelid = to_regclass('dellyvery_private.reseller_write_context')
        and a.attnum > 0
        and not a.attisdropped
    ) is distinct from array[
      'backend_pid:integer:true',
      'txid:bigint:true',
      'operation:text:true',
      'reseller_id:uuid:true',
      'client_id:uuid:true',
      'user_id:uuid:true',
      'depth:integer:true',
      'created_at:timestamp with time zone:true'
    ] then
      raise exception 'Tabela de contexto existente com estrutura inesperada; revise antes de aplicar';
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conrelid = to_regclass('dellyvery_private.reseller_write_context')
        and contype = 'p'
        and pg_get_constraintdef(oid) = 'PRIMARY KEY (backend_pid, txid, operation)'
    ) then
      raise exception 'Tabela de contexto existente sem PK esperada; revise antes de aplicar';
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conrelid = to_regclass('dellyvery_private.reseller_write_context')
        and conname = 'reseller_write_context_operation_check'
        and pg_get_constraintdef(oid) = 'CHECK ((operation = ANY (ARRAY[''activation''::text, ''claim''::text])))'
    ) or not exists (
      select 1
      from pg_constraint
      where conrelid = to_regclass('dellyvery_private.reseller_write_context')
        and conname = 'reseller_write_context_depth_check'
        and pg_get_constraintdef(oid) = 'CHECK ((depth > 0))'
    ) then
      raise exception 'Tabela de contexto existente sem constraints esperadas; revise antes de aplicar';
    end if;
  end if;

  foreach v_sig in array v_private_sigs loop
    if to_regprocedure(v_sig) is not null then
      select pg_get_userbyid(p.proowner)::text
        into v_owner
      from pg_proc p
      where p.oid = to_regprocedure(v_sig);

      if not v_is_super and not pg_has_role(current_user, v_owner::name, 'MEMBER') then
        raise exception
          'Funcao % pertence a %; usuario % nao pode altera-la.',
          v_sig, v_owner, current_user;
      end if;
    end if;
  end loop;
end
$preflight$;

-- =========================
-- 2. Contexto transacional privado e escopado
-- =========================
create schema if not exists dellyvery_private;
alter schema dellyvery_private owner to postgres;
revoke all on schema dellyvery_private from public, anon, authenticated, service_role;
grant usage on schema dellyvery_private to postgres;

create table if not exists dellyvery_private.reseller_write_context (
  backend_pid integer not null,
  txid bigint not null,
  operation text not null,
  reseller_id uuid not null,
  client_id uuid not null,
  user_id uuid not null,
  depth integer not null default 1,
  created_at timestamptz not null default now(),
  constraint reseller_write_context_pkey primary key (backend_pid, txid, operation),
  constraint reseller_write_context_operation_check
    check (operation in ('activation', 'claim')),
  constraint reseller_write_context_depth_check check (depth > 0)
);

alter table dellyvery_private.reseller_write_context owner to postgres;
alter table dellyvery_private.reseller_write_context enable row level security;
revoke all on table dellyvery_private.reseller_write_context
  from public, anon, authenticated, service_role;
grant all privileges on table dellyvery_private.reseller_write_context to postgres;

create index if not exists idx_reseller_write_context_created
  on dellyvery_private.reseller_write_context (created_at);

create or replace function dellyvery_private.begin_reseller_write_context(
  p_operation text,
  p_reseller_id uuid,
  p_client_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, dellyvery_private
as $$
begin
  if p_operation not in ('activation', 'claim') then
    raise exception 'Operacao de contexto invalida';
  end if;
  if p_reseller_id is null or p_client_id is null or p_user_id is null then
    raise exception 'Escopo de contexto incompleto';
  end if;

  -- Limpa apenas contexto da mesma sessao que nao pertence a transacao atual.
  delete from dellyvery_private.reseller_write_context
  where backend_pid = pg_backend_pid()
    and txid <> txid_current();

  -- Contexto de outro backend e removido apenas depois de uma janela longa.
  delete from dellyvery_private.reseller_write_context
  where created_at < now() - interval '7 days';

  insert into dellyvery_private.reseller_write_context as c
    (backend_pid, txid, operation, reseller_id, client_id, user_id, depth)
  values
    (pg_backend_pid(), txid_current(), p_operation, p_reseller_id, p_client_id, p_user_id, 1)
  on conflict (backend_pid, txid, operation)
  do update set depth = c.depth + 1
  where c.reseller_id = excluded.reseller_id
    and c.client_id = excluded.client_id
    and c.user_id = excluded.user_id;

  if not found then
    raise exception 'Contexto de escrita conflitante para a operacao %', p_operation;
  end if;
end;
$$;

create or replace function dellyvery_private.end_reseller_write_context(
  p_operation text,
  p_reseller_id uuid,
  p_client_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, dellyvery_private
as $$
begin
  update dellyvery_private.reseller_write_context
  set depth = depth - 1
  where backend_pid = pg_backend_pid()
    and txid = txid_current()
    and operation = p_operation
    and reseller_id = p_reseller_id
    and client_id = p_client_id
    and user_id = p_user_id
    and depth > 1;

  if not found then
    delete from dellyvery_private.reseller_write_context
    where backend_pid = pg_backend_pid()
      and txid = txid_current()
      and operation = p_operation
      and reseller_id = p_reseller_id
      and client_id = p_client_id
      and user_id = p_user_id
      and depth <= 1;
  end if;
end;
$$;

alter function dellyvery_private.begin_reseller_write_context(text,uuid,uuid,uuid)
  owner to postgres;
alter function dellyvery_private.end_reseller_write_context(text,uuid,uuid,uuid)
  owner to postgres;

revoke all on function dellyvery_private.begin_reseller_write_context(text,uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function dellyvery_private.end_reseller_write_context(text,uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function dellyvery_private.begin_reseller_write_context(text,uuid,uuid,uuid)
  to postgres;
grant execute on function dellyvery_private.end_reseller_write_context(text,uuid,uuid,uuid)
  to postgres;

-- Helper somente de leitura para o trigger. Nao abre contexto e nao altera nada.
create or replace function public.is_reseller_write_context_active(
  p_operation text,
  p_reseller_id uuid,
  p_client_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, dellyvery_private
as $$
  select exists (
    select 1
    from dellyvery_private.reseller_write_context c
    where c.backend_pid = pg_backend_pid()
      and c.txid = txid_current()
      and c.operation = p_operation
      and c.reseller_id = p_reseller_id
      and c.client_id = p_client_id
      and c.user_id = p_user_id
  );
$$;

alter function public.is_reseller_write_context_active(text,uuid,uuid,uuid)
  owner to postgres;

revoke all on function public.is_reseller_write_context_active(text,uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.is_reseller_write_context_active(text,uuid,uuid,uuid)
  to authenticated, service_role;

-- O marcador global anterior deixa de autorizar escrita. Mantemos os objetos
-- historicos, mas removemos o acesso pelas roles de API.
do $deprecated$
begin
  if to_regprocedure('public.is_reseller_activation_in_progress()') is not null then
    revoke all on function public.is_reseller_activation_in_progress()
      from public, anon, authenticated, service_role;
  end if;
end
$deprecated$;

-- =========================
-- 3. Trigger: nao confia no owner; exige contexto escopado
-- =========================
create or replace function public.guard_reseller_client_write()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_trusted boolean;
  v_user_changed boolean;
  v_access_changed boolean;
begin
  -- Apenas admin da plataforma e privilegiado. Roles de banco e ownership de
  -- funcoes SECURITY DEFINER nao sao confiados.
  v_trusted := public.is_platform_admin();

  if tg_op = 'INSERT' then
    if not v_trusted then
      if new.created_by is distinct from v_actor then
        raise exception 'Autor do cadastro nao pode ser alterado';
      end if;
      if new.user_id is not null
         or new.company_id is not null
         or new.activated_at is not null
         or new.access_expires_at is not null then
        raise exception 'Vinculo de conta e acesso do cliente e gerenciado pela ativacao';
      end if;
    end if;
    return new;
  end if;

  if new.reseller_id is distinct from old.reseller_id then
    raise exception 'Revendedor do cliente nao pode ser alterado';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'Autor do cadastro nao pode ser alterado';
  end if;

  if v_trusted then
    return new;
  end if;

  v_user_changed := new.user_id is distinct from old.user_id;
  v_access_changed := new.company_id is distinct from old.company_id
    or new.activated_at is distinct from old.activated_at
    or new.access_expires_at is distinct from old.access_expires_at;

  -- Claim e ativacao sao operacoes distintas e nao podem ser combinadas.
  if v_user_changed and v_access_changed then
    raise exception 'Vinculo de conta e acesso do cliente e gerenciado pela ativacao';
  end if;

  if v_user_changed then
    if new.user_id is distinct from v_actor then
      raise exception 'Vinculo de conta e acesso do cliente e gerenciado pela ativacao';
    end if;
    if old.user_id is not null and old.user_id is distinct from v_actor then
      raise exception 'Vinculo de conta e acesso do cliente e gerenciado pela ativacao';
    end if;
    if not public.is_reseller_write_context_active(
      'claim', old.reseller_id, old.id, v_actor
    ) then
      raise exception 'Vinculo de conta e acesso do cliente e gerenciado pela ativacao';
    end if;
  end if;

  if v_access_changed then
    if old.user_id is null
       or not public.is_reseller_write_context_active(
         'activation', old.reseller_id, old.id, old.user_id
       ) then
      raise exception 'Vinculo de conta e acesso do cliente e gerenciado pela ativacao';
    end if;
  end if;

  return new;
end;
$$;

alter function public.guard_reseller_client_write() owner to postgres;
revoke all on function public.guard_reseller_client_write()
  from public, anon, authenticated, service_role;

-- =========================
-- 4. Ativacao: abre contexto escopado antes de chamar a legada
-- =========================
create or replace function public.activate_reseller_client_v2(
  p_client_id uuid,
  p_plan_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_reseller_id uuid := public.current_reseller_id();
  v_client public.reseller_clients%rowtype;
  v_result jsonb;
begin
  if v_reseller_id is null then
    raise exception 'Acesso de revenda inativo';
  end if;
  if p_client_id is null then
    raise exception 'Cliente nao informado';
  end if;
  if p_plan_id is null then
    raise exception 'Plano nao informado';
  end if;
  if p_idempotency_key is null then
    raise exception 'Chave de idempotencia obrigatoria';
  end if;

  -- Replay idempotente deve continuar retornando o resultado original,
  -- mesmo que o cliente tenha sido alterado depois da ativacao.
  if exists (
    select 1
    from public.reseller_activations
    where reseller_id = v_reseller_id
      and idempotency_key = p_idempotency_key
  ) then
    return public.activate_reseller_client_v2_legacy(
      p_client_id, p_plan_id, p_idempotency_key
    );
  end if;

  select *
  into v_client
  from public.reseller_clients
  where id = p_client_id
    and reseller_id = v_reseller_id;

  if not found then
    raise exception 'Cliente nao encontrado ou sem permissao';
  end if;
  if v_client.user_id is null then
    raise exception 'O cliente ainda nao aceitou o convite e criou a conta';
  end if;

  -- O cliente precisa ter aceitado um convite deste mesmo revendedor,
  -- ou ter sido cadastrado por um PLATFORM_ADMIN.
  if not exists (
    select 1
    from public.reseller_client_invites i
    where i.client_id = v_client.id
      and i.reseller_id = v_reseller_id
      and i.status = 'accepted'
      and i.accepted_by = v_client.user_id
  ) and not exists (
    select 1
    from public.profiles p
    where p.id = v_client.created_by
      and p.platform_role = 'PLATFORM_ADMIN'
  ) then
    raise exception 'Cliente sem convite aceito para ativacao';
  end if;

  -- Se a empresa ja existe, o usuario do cliente precisa ser membro ativo
  -- dela. Isso bloqueia ativacao/renovacao de empresa de terceiros.
  if v_client.company_id is not null and not exists (
    select 1
    from public.company_members cm
    where cm.company_id = v_client.company_id
      and cm.user_id = v_client.user_id
      and cm.active = true
  ) then
    raise exception 'Empresa nao pertence ao cliente do revendedor';
  end if;

  perform dellyvery_private.begin_reseller_write_context(
    'activation', v_reseller_id, v_client.id, v_client.user_id
  );

  begin
    v_result := public.activate_reseller_client_v2_legacy(
      p_client_id, p_plan_id, p_idempotency_key
    );
  exception when others then
    perform dellyvery_private.end_reseller_write_context(
      'activation', v_reseller_id, v_client.id, v_client.user_id
    );
    raise;
  end;

  perform dellyvery_private.end_reseller_write_context(
    'activation', v_reseller_id, v_client.id, v_client.user_id
  );

  return v_result;
end;
$$;

alter function public.activate_reseller_client_v2(uuid,uuid,uuid) owner to postgres;
alter function public.activate_reseller_client_v2_legacy(uuid,uuid,uuid)
  owner to postgres;
alter function public.activate_reseller_client_v2_legacy(uuid,uuid,uuid)
  set search_path = pg_catalog, public;

revoke all on function public.activate_reseller_client_v2(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.activate_reseller_client_v2(uuid,uuid,uuid)
  to authenticated;

revoke all on function public.activate_reseller_client_v2_legacy(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;

-- =========================
-- 5. Claim: preserva o corpo historico e limita a troca de user_id
-- =========================
do $rename_claim$
begin
  if to_regprocedure('public.claim_reseller_client_invite_legacy(text)') is null
     and to_regprocedure('public.claim_reseller_client_invite(text)') is not null then
    execute 'alter function public.claim_reseller_client_invite(text) rename to claim_reseller_client_invite_legacy';
  end if;
end
$rename_claim$;

revoke all on function public.claim_reseller_client_invite_legacy(text)
  from public, anon, authenticated, service_role;

create or replace function public.claim_reseller_client_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_invite public.reseller_client_invites%rowtype;
  v_has_context boolean := false;
  v_result jsonb;
begin
  if v_actor is not null and p_token is not null and btrim(p_token) <> '' then
    select *
    into v_invite
    from public.reseller_client_invites
    where token_hash = encode(extensions.digest(btrim(p_token), 'sha256'), 'hex');

    if found then
      perform dellyvery_private.begin_reseller_write_context(
        'claim', v_invite.reseller_id, v_invite.client_id, v_actor
      );
      v_has_context := true;
    end if;
  end if;

  begin
    v_result := public.claim_reseller_client_invite_legacy(p_token);
  exception when others then
    if v_has_context then
      perform dellyvery_private.end_reseller_write_context(
        'claim', v_invite.reseller_id, v_invite.client_id, v_actor
      );
    end if;
    raise;
  end;

  if v_has_context then
    perform dellyvery_private.end_reseller_write_context(
      'claim', v_invite.reseller_id, v_invite.client_id, v_actor
    );
  end if;

  return v_result;
end;
$$;

alter function public.claim_reseller_client_invite(text) owner to postgres;
alter function public.claim_reseller_client_invite_legacy(text) owner to postgres;
alter function public.claim_reseller_client_invite_legacy(text)
  set search_path = pg_catalog, public;

revoke all on function public.claim_reseller_client_invite(text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_reseller_client_invite(text)
  to authenticated;

revoke all on function public.claim_reseller_client_invite_legacy(text)
  from public, anon, authenticated, service_role;

-- =========================
-- 6. Cancelamento: preserva o grant historico de service_role
-- =========================
create or replace function public.cancel_reseller_credit_order(
  p_order_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_reseller_id uuid := public.current_reseller_id();
  v_is_admin boolean := public.is_platform_admin();
begin
  if v_is_admin is not true and v_reseller_id is null then
    raise exception 'Pedido nao encontrado ou sem permissao';
  end if;

  return public.cancel_reseller_credit_order_legacy(p_order_id, p_reason);
end;
$$;

alter function public.cancel_reseller_credit_order(uuid,text) owner to postgres;
alter function public.cancel_reseller_credit_order_legacy(uuid,text)
  owner to postgres;
alter function public.cancel_reseller_credit_order_legacy(uuid,text)
  set search_path = pg_catalog, public;

-- Grant historico de service_role preservado por decisao operacional. A
-- autorizacao efetiva continua no corpo da funcao, nao no grant.
revoke all on function public.cancel_reseller_credit_order(uuid,text)
  from public, anon, authenticated;
grant execute on function public.cancel_reseller_credit_order(uuid,text)
  to authenticated, service_role;

revoke all on function public.cancel_reseller_credit_order_legacy(uuid,text)
  from public, anon, authenticated, service_role;

-- =========================
-- 7. Postflight
-- =========================
do $postflight$
declare
  v_sig text;
  v_owner text;
  v_config text;
  v_security_definer boolean;
  v_expected_definer boolean;
  v_is_super boolean := coalesce(
    (select r.rolsuper from pg_roles r where r.rolname = current_user),
    false
  );
  v_public_sigs text[] := array[
    'public.activate_reseller_client_v2(uuid,uuid,uuid)',
    'public.activate_reseller_client_v2_legacy(uuid,uuid,uuid)',
    'public.cancel_reseller_credit_order(uuid,text)',
    'public.cancel_reseller_credit_order_legacy(uuid,text)',
    'public.guard_reseller_client_write()',
    'public.claim_reseller_client_invite(text)',
    'public.claim_reseller_client_invite_legacy(text)',
    'public.is_reseller_write_context_active(text,uuid,uuid,uuid)'
  ];
  v_private_sigs text[] := array[
    'dellyvery_private.begin_reseller_write_context(text,uuid,uuid,uuid)',
    'dellyvery_private.end_reseller_write_context(text,uuid,uuid,uuid)'
  ];
begin
  foreach v_sig in array v_public_sigs || v_private_sigs loop
    if to_regprocedure(v_sig) is null then
      raise exception 'Postflight: funcao ausente: %', v_sig;
    end if;

    select pg_get_userbyid(p.proowner)::text,
           array_to_string(p.proconfig, ','),
           p.prosecdef
      into v_owner, v_config, v_security_definer
    from pg_proc p
    where p.oid = to_regprocedure(v_sig);

    if v_owner is distinct from 'postgres' then
      raise exception 'Postflight: % pertence a %, esperado postgres', v_sig, v_owner;
    end if;

    if v_sig = 'public.guard_reseller_client_write()' then
      if v_config is distinct from 'search_path=pg_catalog, public' then
        raise exception 'Postflight: % com search_path inesperado: %', v_sig, v_config;
      end if;
      v_expected_definer := false;
    elsif v_sig like 'dellyvery_private.%'
       or v_sig = 'public.is_reseller_write_context_active(text,uuid,uuid,uuid)' then
      if v_config is distinct from 'search_path=pg_catalog, dellyvery_private' then
        raise exception 'Postflight: % com search_path inesperado: %', v_sig, v_config;
      end if;
      v_expected_definer := true;
    else
      if v_config is distinct from 'search_path=pg_catalog, public' then
        raise exception 'Postflight: % com search_path inesperado: %', v_sig, v_config;
      end if;
      v_expected_definer := true;
    end if;

    if v_security_definer is distinct from v_expected_definer then
      raise exception 'Postflight: % com prosecdef=%, esperado %',
        v_sig, v_security_definer, v_expected_definer;
    end if;
  end loop;

  select pg_get_userbyid(n.nspowner)::text
    into v_owner
  from pg_namespace n
  where n.nspname = 'dellyvery_private';
  if v_owner is distinct from 'postgres' then
    raise exception 'Postflight: schema dellyvery_private pertence a %, esperado postgres', v_owner;
  end if;

  if not exists (
    select 1
    from pg_class c
    where c.oid = to_regclass('dellyvery_private.reseller_write_context')
      and c.relkind = 'r'
      and pg_get_userbyid(c.relowner) = 'postgres'
      and c.relrowsecurity
  ) then
    raise exception 'Postflight: tabela de contexto ausente, sem owner postgres ou sem RLS';
  end if;

  if (
    select array_agg(
      a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text
      order by a.attnum
    )
    from pg_attribute a
    where a.attrelid = to_regclass('dellyvery_private.reseller_write_context')
      and a.attnum > 0
      and not a.attisdropped
  ) is distinct from array[
    'backend_pid:integer:true',
    'txid:bigint:true',
    'operation:text:true',
    'reseller_id:uuid:true',
    'client_id:uuid:true',
    'user_id:uuid:true',
    'depth:integer:true',
    'created_at:timestamp with time zone:true'
  ] then
    raise exception 'Postflight: estrutura da tabela de contexto inesperada';
  end if;

  if not exists (
    select 1
    from pg_attrdef d
    join pg_attribute a
      on a.attrelid = d.adrelid
     and a.attnum = d.adnum
    where d.adrelid = to_regclass('dellyvery_private.reseller_write_context')
      and a.attname = 'depth'
      and pg_get_expr(d.adbin, d.adrelid) = '1'
  ) then
    raise exception 'Postflight: default de depth da tabela de contexto ausente ou incorreto';
  end if;

  if not exists (
    select 1
    from pg_attrdef d
    join pg_attribute a
      on a.attrelid = d.adrelid
     and a.attnum = d.adnum
    where d.adrelid = to_regclass('dellyvery_private.reseller_write_context')
      and a.attname = 'created_at'
      and pg_get_expr(d.adbin, d.adrelid) = 'now()'
  ) then
    raise exception 'Postflight: default de created_at da tabela de contexto ausente ou incorreto';
  end if;

  if not exists (
    select 1
    from pg_class c
    where c.oid = to_regclass('dellyvery_private.idx_reseller_write_context_created')
      and c.relkind = 'i'
      and pg_get_indexdef(c.oid) = 'CREATE INDEX idx_reseller_write_context_created ON dellyvery_private.reseller_write_context USING btree (created_at)'
  ) then
    raise exception 'Postflight: indice created_at da tabela de contexto ausente ou incorreto';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = to_regclass('dellyvery_private.reseller_write_context')
      and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (backend_pid, txid, operation)'
  ) then
    raise exception 'Postflight: PK da tabela de contexto ausente ou incorreta';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = to_regclass('dellyvery_private.reseller_write_context')
      and conname = 'reseller_write_context_operation_check'
      and pg_get_constraintdef(oid) = 'CHECK ((operation = ANY (ARRAY[''activation''::text, ''claim''::text])))'
  ) or not exists (
    select 1
    from pg_constraint
    where conrelid = to_regclass('dellyvery_private.reseller_write_context')
      and conname = 'reseller_write_context_depth_check'
      and pg_get_constraintdef(oid) = 'CHECK ((depth > 0))'
  ) then
    raise exception 'Postflight: constraints da tabela de contexto ausentes ou incorretas';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.reseller_clients'::regclass
      and t.tgname = 'trg_reseller_client_guard'
      and not t.tgisinternal
      and t.tgenabled = 'O'
      and (t.tgtype & 1) <> 0
      and (t.tgtype & 2) <> 0
      and (t.tgtype & 4) <> 0
      and (t.tgtype & 16) <> 0
      and t.tgattr = ''::int2vector
      and t.tgqual is null
      and t.tgfoid = to_regprocedure('public.guard_reseller_client_write()')
  ) then
    raise exception 'Postflight: trigger trg_reseller_client_guard ausente ou incompleto';
  end if;

  if position('service_role' in lower(pg_get_functiondef(
       'public.guard_reseller_client_write()'::regprocedure
     ))) > 0
     or position('current_user' in lower(pg_get_functiondef(
       'public.guard_reseller_client_write()'::regprocedure
     ))) > 0 then
    raise exception 'Postflight: guard ainda referencia role/current_user como confianca';
  end if;

  if not has_function_privilege('authenticated', 'public.activate_reseller_client_v2(uuid,uuid,uuid)', 'EXECUTE') then
    raise exception 'Postflight: authenticated sem EXECUTE na ativacao';
  end if;
  if has_function_privilege('anon', 'public.activate_reseller_client_v2(uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.activate_reseller_client_v2(uuid,uuid,uuid)', 'EXECUTE') then
    raise exception 'Postflight: anon/service_role com EXECUTE na ativacao';
  end if;

  if not has_function_privilege('authenticated', 'public.cancel_reseller_credit_order(uuid,text)', 'EXECUTE') then
    raise exception 'Postflight: authenticated sem EXECUTE no cancelamento';
  end if;
  if not has_function_privilege('service_role', 'public.cancel_reseller_credit_order(uuid,text)', 'EXECUTE') then
    raise exception 'Postflight: service_role sem EXECUTE no cancelamento historico';
  end if;
  if has_function_privilege('anon', 'public.cancel_reseller_credit_order(uuid,text)', 'EXECUTE') then
    raise exception 'Postflight: anon com EXECUTE no cancelamento';
  end if;

  if not has_function_privilege('authenticated', 'public.claim_reseller_client_invite(text)', 'EXECUTE') then
    raise exception 'Postflight: authenticated sem EXECUTE no claim';
  end if;
  if has_function_privilege('anon', 'public.claim_reseller_client_invite(text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.claim_reseller_client_invite(text)', 'EXECUTE') then
    raise exception 'Postflight: anon/service_role com EXECUTE no claim';
  end if;

  if has_function_privilege('authenticated', 'public.activate_reseller_client_v2_legacy(uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.activate_reseller_client_v2_legacy(uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.activate_reseller_client_v2_legacy(uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cancel_reseller_credit_order_legacy(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.cancel_reseller_credit_order_legacy(uuid,text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.cancel_reseller_credit_order_legacy(uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.claim_reseller_client_invite_legacy(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.claim_reseller_client_invite_legacy(text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.claim_reseller_client_invite_legacy(text)', 'EXECUTE') then
    raise exception 'Postflight: funcao legada executavel por role de API';
  end if;

  if has_function_privilege('authenticated', 'public.guard_reseller_client_write()', 'EXECUTE')
     or has_function_privilege('anon', 'public.guard_reseller_client_write()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.guard_reseller_client_write()', 'EXECUTE') then
    raise exception 'Postflight: guard executavel por role de API';
  end if;

  if not has_function_privilege('authenticated', 'public.is_reseller_write_context_active(text,uuid,uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.is_reseller_write_context_active(text,uuid,uuid,uuid)', 'EXECUTE') then
    raise exception 'Postflight: helper de contexto sem EXECUTE para authenticated/service_role';
  end if;
  if has_function_privilege('anon', 'public.is_reseller_write_context_active(text,uuid,uuid,uuid)', 'EXECUTE') then
    raise exception 'Postflight: helper de contexto executavel por anon';
  end if;

  if has_function_privilege('authenticated', 'dellyvery_private.begin_reseller_write_context(text,uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'dellyvery_private.begin_reseller_write_context(text,uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'dellyvery_private.begin_reseller_write_context(text,uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'dellyvery_private.end_reseller_write_context(text,uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'dellyvery_private.end_reseller_write_context(text,uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'dellyvery_private.end_reseller_write_context(text,uuid,uuid,uuid)', 'EXECUTE') then
    raise exception 'Postflight: funcao privada de contexto executavel por role de API';
  end if;

  if has_schema_privilege('authenticated', 'dellyvery_private', 'USAGE')
     or has_schema_privilege('anon', 'dellyvery_private', 'USAGE')
     or has_schema_privilege('service_role', 'dellyvery_private', 'USAGE') then
    raise exception 'Postflight: dellyvery_private acessivel por role de API';
  end if;

  if has_table_privilege('authenticated', 'dellyvery_private.reseller_write_context', 'SELECT')
     or has_table_privilege('authenticated', 'dellyvery_private.reseller_write_context', 'INSERT')
     or has_table_privilege('authenticated', 'dellyvery_private.reseller_write_context', 'UPDATE')
     or has_table_privilege('authenticated', 'dellyvery_private.reseller_write_context', 'DELETE')
     or has_table_privilege('anon', 'dellyvery_private.reseller_write_context', 'SELECT')
     or has_table_privilege('anon', 'dellyvery_private.reseller_write_context', 'INSERT')
     or has_table_privilege('anon', 'dellyvery_private.reseller_write_context', 'UPDATE')
     or has_table_privilege('anon', 'dellyvery_private.reseller_write_context', 'DELETE')
     or has_table_privilege('service_role', 'dellyvery_private.reseller_write_context', 'SELECT')
     or has_table_privilege('service_role', 'dellyvery_private.reseller_write_context', 'INSERT')
     or has_table_privilege('service_role', 'dellyvery_private.reseller_write_context', 'UPDATE')
     or has_table_privilege('service_role', 'dellyvery_private.reseller_write_context', 'DELETE') then
    raise exception 'Postflight: tabela de contexto acessivel por role de API';
  end if;

  if to_regprocedure('public.is_reseller_activation_in_progress()') is not null then
    if has_function_privilege('authenticated', 'public.is_reseller_activation_in_progress()', 'EXECUTE')
       or has_function_privilege('anon', 'public.is_reseller_activation_in_progress()', 'EXECUTE')
       or has_function_privilege('service_role', 'public.is_reseller_activation_in_progress()', 'EXECUTE') then
      raise exception 'Postflight: marcador antigo executavel por role de API';
    end if;
  end if;

  if has_schema_privilege('authenticated', 'public', 'CREATE')
     or has_schema_privilege('anon', 'public', 'CREATE')
     or has_schema_privilege('service_role', 'public', 'CREATE') then
    raise exception 'Postflight: public permite CREATE para role de API';
  end if;

  if not v_is_super then
    if not has_function_privilege('postgres'::name, 'public.current_reseller_id()', 'EXECUTE')
       or not has_function_privilege('postgres'::name, 'public.is_platform_admin()', 'EXECUTE')
       or not has_schema_privilege('postgres'::name, 'auth', 'USAGE') then
      raise exception 'Postflight: postgres sem privilegios para executar as funcoes internas';
    end if;
  end if;
end
$postflight$;

notify pgrst, 'reload schema';
