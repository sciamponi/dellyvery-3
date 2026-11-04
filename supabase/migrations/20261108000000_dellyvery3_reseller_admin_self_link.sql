-- DELLVERY 3 - Auto-vinculo explicito de PLATFORM_ADMIN como revendedor.
--
-- A regra anterior bloqueava qualquer conta administradora. A conta Master
-- tambem pode operar o painel Revendedor, mas somente vinculando a propria
-- conta: um administrador nao pode transformar outro administrador em
-- revendedor por este fluxo.
--
-- O e-mail confirmado da conta continua obrigatorio e precisa ser igual ao
-- e-mail do convite. platform_role nunca e alterado.

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

  if found and v_profile.platform_role = 'PLATFORM_ADMIN' and p_user_id <> p_actor then
    raise exception 'Administrador so pode vincular a propria conta';
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

notify pgrst, 'reload schema';
