create or replace function public.reseller_invite_email_proof_is_valid(
  p_user_id uuid,
  p_email text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select
      u.id,
      lower(btrim(u.email)) as email,
      u.email_confirmed_at,
      u.confirmation_sent_at,
      u.updated_at
    from auth.users u
    where u.id = p_user_id
      and u.id = auth.uid()
  ),
  amr as (
    select
      item ->> 'method' as method,
      nullif(item ->> 'timestamp', '')::double precision as proof_at
    from jsonb_array_elements(
      coalesce(auth.jwt() -> 'amr', '[]'::jsonb)
    ) as item
  ),
  latest_proof as (
    select max(proof_at) as proof_at
    from amr
    where method in ('otp', 'magiclink', 'recovery', 'email/signup', 'invite')
  )
  select exists (
    select 1
    from target t
    cross join latest_proof p
    where t.email = lower(btrim(p_email))
      and t.email_confirmed_at is not null
      and (
        (
          t.confirmation_sent_at is not null
          and t.email_confirmed_at >= t.confirmation_sent_at
        )
        or (
          p.proof_at is not null
          and t.email_confirmed_at <= to_timestamp(p.proof_at) + interval '5 seconds'
          and t.updated_at <= to_timestamp(p.proof_at) + interval '5 seconds'
        )
      )
  );
$$;

revoke all on function public.reseller_invite_email_proof_is_valid(uuid, text) from public, anon, authenticated;

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

  if v_invite.status <> 'pending' then
    raise exception 'Convite nao esta mais disponivel';
  end if;
  if v_invite.expires_at <= now() then
    update public.reseller_client_invites
    set status = 'expired'
    where id = v_invite.id;
    raise exception 'Convite expirado. Solicite um novo link ao revendedor';
  end if;
  if v_invite.invited_email <> v_auth_email then
    raise exception 'Entre com o e-mail que recebeu o convite (%)', v_invite.invited_email;
  end if;
  if not public.reseller_invite_email_proof_is_valid(v_actor, v_auth_email) then
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

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  )
  values (
    null, v_actor, 'reseller_client_invite_accepted', 'reseller_client', v_client.id,
    jsonb_build_object(
      'invite_id', v_invite.id,
      'reseller_id', v_invite.reseller_id,
      'email', v_auth_email
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

grant execute on function public.claim_reseller_client_invite(text) to authenticated;

notify pgrst, 'reload schema';
