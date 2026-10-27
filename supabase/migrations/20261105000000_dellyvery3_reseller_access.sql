-- DELLVERY 3 - Revenda: vinculo de acesso do revendedor (local only).
--
-- Escopo desta migration:
--   1. resellers: conta de revendedor separada de profiles.platform_role.
--   2. RLS: revendedor le apenas o proprio registro; PLATFORM_ADMIN le todos.
--   3. RPCs de provisionamento/vinculo executaveis SOMENTE por service_role.
--   4. Triggers de sincronizacao de status e auditoria.
--   5. Bloqueio de aprovacao direta pelo navegador (somente Edge Function).
--
-- Nao cria carteira, clientes, creditos, assinaturas ou permissoes de empresa.
-- Nao altera platform_role para RESELLER. Nao altera companies.

-- =========================
-- Conta de revendedor
-- =========================
create table if not exists public.resellers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  invite_id uuid not null unique references public.reseller_invites(id) on delete restrict,
  status text not null default 'ativo'
    check (status in ('ativo', 'suspenso', 'inativo')),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz not null default now(),
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_resellers_status
  on public.resellers (status, created_at desc);

drop trigger if exists trg_resellers_updated_at on public.resellers;
create trigger trg_resellers_updated_at
before update on public.resellers
for each row execute function public.set_updated_at();

alter table public.resellers enable row level security;

-- Revendedor enxerga somente o proprio vinculo; Master enxerga todos.
-- Nao existe policy de INSERT/UPDATE/DELETE para authenticated: escrita
-- direta fica negada por padrao. service_role ignora RLS.
drop policy if exists resellers_select_own on public.resellers;
create policy resellers_select_own on public.resellers
  for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin());

revoke all on table public.resellers from public, anon, authenticated;
grant select on table public.resellers to authenticated;
grant all on table public.resellers to service_role;

-- =========================
-- Helpers de acesso (usados pelo frontend/RLS futura)
-- =========================
create or replace function public.is_reseller()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.resellers
    where user_id = auth.uid()
      and status = 'ativo'
  );
$$;

create or replace function public.current_reseller_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.resellers
  where user_id = auth.uid()
    and status = 'ativo'
  limit 1;
$$;

revoke all on function public.is_reseller() from public, anon;
revoke all on function public.current_reseller_id() from public, anon;
grant execute on function public.is_reseller() to authenticated;
grant execute on function public.current_reseller_id() to authenticated;

-- =========================
-- Lookup de usuario Auth por e-mail exato (service role only).
-- Evita listar usuarios ou vincular por nome/telefone.
-- =========================
create or replace function public.reseller_lookup_auth_user(p_email text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'user_id', u.id,
    'email', u.email,
    'email_confirmed', u.email_confirmed_at is not null
  )
  from auth.users u
  where lower(btrim(coalesce(u.email, ''))) = lower(btrim(coalesce(p_email, '')))
  limit 1;
$$;

revoke all on function public.reseller_lookup_auth_user(text)
  from public, anon, authenticated;
grant execute on function public.reseller_lookup_auth_user(text) to service_role;

-- =========================
-- Aprovacao + vinculo (service role only).
--
-- Pre-condicoes:
--   - ator e PLATFORM_ADMIN;
--   - convite aguardando aprovacao (ou aprovado sem vinculo, para reparo);
--   - e-mail do convite == e-mail do usuario Auth e e-mail confirmado;
--   - usuario nao e PLATFORM_ADMIN e nao esta vinculado a outro convite.
--
-- Efeitos (uma transacao):
--   - cria/atualiza profile sem tocar platform_role;
--   - cria resellers (ativo);
--   - convite -> aprovado + evento;
--   - audit_logs.
-- =========================
create or replace function public.approve_reseller_access(
  p_invite_id uuid,
  p_user_id uuid,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.reseller_invites%rowtype;
  v_auth record;
  v_profile public.profiles%rowtype;
  v_reseller public.resellers%rowtype;
  v_invite_email text;
  v_auth_email text;
  v_invite_phone text;
begin
  if p_invite_id is null or p_user_id is null or p_actor is null then
    raise exception 'Dados de aprovacao incompletos';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = p_actor
      and platform_role = 'PLATFORM_ADMIN'
  ) then
    raise exception 'Sem permissao';
  end if;

  select *
  into v_invite
  from public.reseller_invites
  where id = p_invite_id
  for update;

  if not found then
    raise exception 'Convite nao encontrado';
  end if;

  v_invite_email := lower(btrim(coalesce(v_invite.registration ->> 'email', '')));
  if v_invite_email = '' then
    raise exception 'E-mail do revendedor nao informado';
  end if;
  if v_invite_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'E-mail do revendedor invalido';
  end if;

  select id, email, email_confirmed_at
  into v_auth
  from auth.users
  where id = p_user_id;

  if not found then
    raise exception 'Usuario de acesso nao encontrado';
  end if;

  v_auth_email := lower(btrim(coalesce(v_auth.email, '')));
  if v_auth_email = '' or v_auth_email <> v_invite_email then
    raise exception 'E-mail do usuario nao confere com o convite';
  end if;
  if v_auth.email_confirmed_at is null then
    raise exception 'E-mail do usuario nao confirmado';
  end if;

  select *
  into v_reseller
  from public.resellers
  where invite_id = p_invite_id;

  if found then
    if v_reseller.user_id <> p_user_id then
      raise exception 'Convite ja vinculado a outro usuario';
    end if;
    return jsonb_build_object(
      'reseller_id', v_reseller.id,
      'user_id', v_reseller.user_id,
      'status', v_reseller.status,
      'reused', true
    );
  end if;

  if v_invite.status not in ('aguardando_aprovacao', 'aprovado') then
    raise exception 'Convite nao esta aguardando aprovacao';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = p_user_id;

  if found and v_profile.platform_role = 'PLATFORM_ADMIN' then
    raise exception 'Conta ja e administradora da plataforma';
  end if;

  if exists (
    select 1
    from public.resellers
    where user_id = p_user_id
      and invite_id <> p_invite_id
  ) then
    raise exception 'Usuario ja vinculado a outro revendedor';
  end if;

  v_invite_phone := coalesce(
    nullif(btrim(v_invite.registration ->> 'phone'), ''),
    nullif(btrim(v_invite.phone), '')
  );

  insert into public.profiles (id, email, name, phone, platform_role)
  values (
    p_user_id,
    v_auth_email,
    nullif(btrim(v_invite.name), ''),
    v_invite_phone,
    'USER'
  )
  on conflict (id) do update
  set email = excluded.email,
      name = coalesce(profiles.name, excluded.name),
      phone = coalesce(profiles.phone, excluded.phone),
      updated_at = now();

  begin
    insert into public.resellers (
      user_id, invite_id, status, approved_by, approved_at
    )
    values (
      p_user_id, p_invite_id, 'ativo', p_actor, now()
    )
    returning * into v_reseller;
  exception when unique_violation then
    raise exception 'Usuario ja vinculado a outro revendedor ou convite ja aprovado';
  end;

  update public.reseller_invites
  set status = 'aprovado',
      decided_at = coalesce(decided_at, now()),
      updated_at = now(),
      events = events || jsonb_build_array(jsonb_build_object(
        'at', now(),
        'by', p_actor,
        'action', 'acesso_vinculado',
        'detail', jsonb_build_object(
          'user_id', p_user_id,
          'email', v_auth_email
        )
      ))
  where id = p_invite_id;

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  )
  values (
    null,
    p_actor,
    'reseller_access_linked',
    'reseller',
    v_reseller.id,
    jsonb_build_object(
      'invite_id', p_invite_id,
      'profile_id', p_user_id,
      'email', v_auth_email
    )
  );

  return jsonb_build_object(
    'reseller_id', v_reseller.id,
    'user_id', v_reseller.user_id,
    'status', v_reseller.status,
    'reused', false
  );
end;
$$;

revoke all on function public.approve_reseller_access(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.approve_reseller_access(uuid, uuid, uuid) to service_role;

-- =========================
-- Transicoes de acesso: revogacao terminal.
-- A funcao original (hardening) so permitia aprovado <-> suspenso; agora o
-- Master pode revogar um acesso ativo ou suspenso. Revogado permanece sem
-- saida. O trigger trg_reseller_invite_transition continua ativo.
-- =========================
create or replace function public.enforce_reseller_invite_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if not (
    (old.status = 'criado' and new.status in ('enviado', 'aguardando_aprovacao', 'revogado', 'expirado'))
    or (old.status = 'enviado' and new.status in ('aguardando_aprovacao', 'revogado', 'expirado'))
    or (old.status = 'aguardando_aprovacao' and new.status in ('aprovado', 'recusado'))
    or (old.status = 'aprovado' and new.status in ('suspenso', 'revogado'))
    or (old.status = 'suspenso' and new.status in ('aprovado', 'revogado'))
  ) then
    raise exception 'Transicao de convite invalida: % -> %', old.status, new.status;
  end if;
  return new;
end;
$$;

-- =========================
-- Bloqueio de aprovacao direta pelo navegador.
-- A aprovacao pendente -> aprovado so pode ocorrer com JWT service_role
-- (Edge Function) ou em contexto administrativo local (postgres).
-- Suspenso -> aprovado continua permitido para reativacao.
-- =========================
create or replace function public.prevent_direct_reseller_approval()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'aprovado'
     and old.status = 'aguardando_aprovacao'
     and coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Aprovacao deve ser feita pelo fluxo de acesso do revendedor';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_direct_reseller_approval on public.reseller_invites;
create trigger trg_prevent_direct_reseller_approval
before update of status on public.reseller_invites
for each row execute function public.prevent_direct_reseller_approval();

-- =========================
-- Sincronizacao convite -> conta de revendedor.
-- Suspensao/reativacao/revogacao alteram o acesso real, nao apenas a UI.
-- =========================
create or replace function public.sync_reseller_status_from_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'suspenso' and old.status = 'aprovado' then
    update public.resellers
    set status = 'suspenso', suspended_at = now()
    where invite_id = new.id;
  elsif new.status = 'aprovado' and old.status = 'suspenso' then
    update public.resellers
    set status = 'ativo', suspended_at = null
    where invite_id = new.id;
  elsif new.status in ('recusado', 'revogado', 'expirado') then
    update public.resellers
    set status = 'inativo'
    where invite_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_reseller_status_sync on public.reseller_invites;
create trigger trg_reseller_status_sync
after update of status on public.reseller_invites
for each row execute function public.sync_reseller_status_from_invite();

-- =========================
-- Auditoria de mudanca de status (append-only).
-- A aprovacao tambem registra reseller_access_linked na RPC.
-- =========================
create or replace function public.audit_reseller_invite_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  )
  values (
    null,
    auth.uid(),
    'reseller_invite_status_changed',
    'reseller_invite',
    new.id,
    jsonb_build_object(
      'from', old.status,
      'to', new.status,
      'name', new.name,
      'phone', new.phone
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_reseller_status_audit on public.reseller_invites;
create trigger trg_reseller_status_audit
after update of status on public.reseller_invites
for each row execute function public.audit_reseller_invite_status();
