create table if not exists public.reseller_invite_email_proofs (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.reseller_client_invites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  method text not null default 'email_otp',
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reseller_invite_email_proofs_email_check
    check (email = lower(btrim(email)) and email <> '' and length(email) <= 320),
  constraint reseller_invite_email_proofs_expiry_check
    check (expires_at > verified_at),
  constraint reseller_invite_email_proofs_method_check
    check (method = 'email_otp'),
  constraint reseller_invite_email_proofs_invite_user_key
    unique (invite_id, user_id)
);

alter table public.reseller_invite_email_proofs enable row level security;

revoke all on table public.reseller_invite_email_proofs from public, anon, authenticated, service_role;
grant select on table public.reseller_invite_email_proofs to service_role;

drop trigger if exists trg_reseller_invite_email_proofs_updated_at on public.reseller_invite_email_proofs;
create trigger trg_reseller_invite_email_proofs_updated_at
before update on public.reseller_invite_email_proofs
for each row execute function public.set_updated_at();

drop function if exists public.reseller_invite_email_proof_is_valid(uuid, text);

create or replace function public.record_reseller_invite_email_proof(
  p_invite_id uuid,
  p_user_id uuid,
  p_email text,
  p_ttl_seconds integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.reseller_client_invites%rowtype;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_auth_email text;
  v_expires_at timestamptz;
  v_proof public.reseller_invite_email_proofs%rowtype;
begin
  if p_invite_id is null or p_user_id is null then
    raise exception 'Convite ou usuario nao informado';
  end if;
  if v_email = '' then
    raise exception 'E-mail nao informado';
  end if;
  if p_ttl_seconds is null or p_ttl_seconds < 60 or p_ttl_seconds > 3600 then
    raise exception 'Validade da prova invalida';
  end if;

  select *
  into v_invite
  from public.reseller_client_invites
  where id = p_invite_id
  for update;

  if not found then
    raise exception 'Convite nao encontrado';
  end if;
  if v_invite.status = 'expired'
    or (v_invite.status = 'pending' and v_invite.expires_at <= now()) then
    raise exception 'Convite expirado. Solicite um novo link ao revendedor';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'Convite nao esta mais disponivel';
  end if;
  if v_invite.invited_email <> v_email then
    raise exception 'E-mail nao corresponde ao convite';
  end if;

  select lower(btrim(u.email))
  into v_auth_email
  from auth.users u
  where u.id = p_user_id;

  if not found or v_auth_email is distinct from v_email then
    raise exception 'Conta nao corresponde ao e-mail do convite';
  end if;

  v_expires_at := now() + make_interval(secs => p_ttl_seconds);

  insert into public.reseller_invite_email_proofs (
    invite_id, user_id, email, method, verified_at, expires_at, consumed_at, created_by
  )
  values (
    p_invite_id, p_user_id, v_email, 'email_otp', now(), v_expires_at, null, p_user_id
  )
  on conflict (invite_id, user_id) do update
  set email = excluded.email,
      method = excluded.method,
      verified_at = excluded.verified_at,
      expires_at = excluded.expires_at,
      consumed_at = null,
      created_by = excluded.created_by,
      updated_at = now()
  returning * into v_proof;

  return jsonb_build_object(
    'proof_id', v_proof.id,
    'expires_at', v_proof.expires_at
  );
end;
$$;

revoke all on function public.record_reseller_invite_email_proof(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.record_reseller_invite_email_proof(uuid, uuid, text, integer) to service_role;

create or replace function public.resolve_reseller_client_invite(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_invite public.reseller_client_invites%rowtype;
  v_client public.reseller_clients%rowtype;
  v_reseller_name text;
begin
  if p_token is null or btrim(p_token) = '' then
    raise exception 'Convite nao encontrado';
  end if;

  v_hash := encode(extensions.digest(btrim(p_token), 'sha256'), 'hex');

  select *
  into v_invite
  from public.reseller_client_invites
  where token_hash = v_hash
  for update;

  if not found then
    raise exception 'Convite nao encontrado';
  end if;

  if v_invite.status = 'pending' and v_invite.expires_at <= now() then
    update public.reseller_client_invites
    set status = 'expired'
    where id = v_invite.id
      and status = 'pending';

    if found then
      v_invite.status := 'expired';
    end if;
  end if;

  select *
  into v_client
  from public.reseller_clients
  where id = v_invite.client_id
    and reseller_id = v_invite.reseller_id;

  if not found then
    raise exception 'Convite nao encontrado';
  end if;

  select coalesce(nullif(btrim(p.name), ''), 'Revendedor')
  into v_reseller_name
  from public.resellers r
  left join public.profiles p on p.id = r.user_id
  where r.id = v_invite.reseller_id;

  return jsonb_build_object(
    'invite_id', v_invite.id,
    'client_id', v_client.id,
    'client_name', coalesce(nullif(btrim(v_client.trade_name), ''), v_client.name),
    'reseller_name', coalesce(v_reseller_name, 'Revendedor'),
    'invited_email', v_invite.invited_email,
    'status', v_invite.status,
    'expires_at', v_invite.expires_at
  );
end;
$$;

create or replace function public.claim_reseller_client_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_auth record;
  v_hash text;
  v_invite public.reseller_client_invites%rowtype;
  v_client public.reseller_clients%rowtype;
  v_proof public.reseller_invite_email_proofs%rowtype;
  v_auth_email text;
  v_profile_name text;
begin
  if v_actor is null then
    raise exception 'Entre na sua conta para aceitar o convite';
  end if;
  if p_token is null or btrim(p_token) = '' then
    raise exception 'Convite nao encontrado';
  end if;

  select id, email, email_confirmed_at, raw_user_meta_data
  into v_auth
  from auth.users
  where id = v_actor;

  if not found then
    raise exception 'Usuario nao encontrado';
  end if;

  v_auth_email := lower(btrim(coalesce(v_auth.email, '')));
  if v_auth_email = '' then
    raise exception 'Sua conta nao possui e-mail';
  end if;
  if v_auth.email_confirmed_at is null then
    raise exception 'Confirme seu e-mail antes de aceitar o convite';
  end if;

  v_hash := encode(extensions.digest(btrim(p_token), 'sha256'), 'hex');

  select *
  into v_invite
  from public.reseller_client_invites
  where token_hash = v_hash
  for update;

  if not found then
    raise exception 'Convite nao encontrado';
  end if;

  select *
  into v_client
  from public.reseller_clients
  where id = v_invite.client_id
    and reseller_id = v_invite.reseller_id
  for update;

  if not found then
    raise exception 'Convite nao encontrado';
  end if;

  if v_invite.status = 'accepted' then
    if v_invite.accepted_by = v_actor then
      return jsonb_build_object(
        'client_id', v_client.id,
        'reseller_id', v_invite.reseller_id,
        'status', 'accepted',
        'reused', true
      );
    end if;
    raise exception 'Convite ja utilizado por outra conta';
  end if;

  if v_invite.status = 'expired'
    or (v_invite.status = 'pending' and v_invite.expires_at <= now()) then
    raise exception 'Convite expirado. Solicite um novo link ao revendedor';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'Convite nao esta mais disponivel';
  end if;
  if v_invite.invited_email <> v_auth_email then
    raise exception 'Entre com o e-mail que recebeu o convite (%)', v_invite.invited_email;
  end if;

  select *
  into v_proof
  from public.reseller_invite_email_proofs
  where invite_id = v_invite.id
    and user_id = v_actor
    and email = v_auth_email
    and method = 'email_otp'
    and consumed_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception 'Confirme a posse do e-mail antes de aceitar o convite';
  end if;

  if v_client.user_id is not null and v_client.user_id <> v_actor then
    raise exception 'Cliente ja vinculado a outra conta';
  end if;

  if exists (
    select 1
    from public.company_members
    where user_id = v_actor
      and active = true
  ) then
    raise exception 'Esta conta ja possui uma empresa. Use uma conta sem empresa para aceitar o convite';
  end if;

  if exists (
    select 1
    from public.reseller_clients
    where user_id = v_actor
      and id <> v_client.id
  ) then
    raise exception 'Esta conta ja esta vinculada a outro cliente de revenda';
  end if;

  v_profile_name := coalesce(
    nullif(btrim(v_auth.raw_user_meta_data ->> 'name'), ''),
    nullif(btrim(v_client.name), ''),
    split_part(v_auth_email, '@', 1)
  );

  insert into public.profiles (id, email, name, platform_role)
  values (v_actor, v_auth_email, v_profile_name, 'USER')
  on conflict (id) do update
  set email = excluded.email,
      name = coalesce(public.profiles.name, excluded.name),
      updated_at = now();

  update public.reseller_clients
  set user_id = v_actor
  where id = v_client.id
    and reseller_id = v_invite.reseller_id;

  update public.reseller_client_invites
  set status = 'accepted',
      accepted_by = v_actor,
      accepted_at = now()
  where id = v_invite.id;

  update public.reseller_invite_email_proofs
  set consumed_at = now(),
      updated_at = now()
  where id = v_proof.id;

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  )
  values (
    null, v_actor, 'reseller_client_invite_accepted', 'reseller_client', v_client.id,
    jsonb_build_object(
      'invite_id', v_invite.id,
      'reseller_id', v_invite.reseller_id,
      'email', v_auth_email,
      'email_proof_id', v_proof.id,
      'email_proof_verified_at', v_proof.verified_at
    )
  );

  return jsonb_build_object(
    'client_id', v_client.id,
    'reseller_id', v_invite.reseller_id,
    'status', 'accepted',
    'reused', false
  );
end;
$$;

revoke all on function public.claim_reseller_client_invite(text) from public, anon;
grant execute on function public.claim_reseller_client_invite(text) to authenticated;

notify pgrst, 'reload schema';
