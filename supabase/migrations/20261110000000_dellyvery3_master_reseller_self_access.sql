alter table public.resellers
  alter column invite_id drop not null;

create or replace function public.ensure_master_reseller_access()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_reseller public.resellers%rowtype;
begin
  if v_uid is null then
    raise exception 'Sessao ausente';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = v_uid;

  if not found or v_profile.platform_role <> 'PLATFORM_ADMIN' then
    raise exception 'Sem permissao';
  end if;

  select *
  into v_reseller
  from public.resellers
  where user_id = v_uid;

  if found then
    return jsonb_build_object(
      'reseller_id', v_reseller.id,
      'status', v_reseller.status,
      'created', false
    );
  end if;

  insert into public.resellers (
    user_id, invite_id, status, approved_by, approved_at
  )
  values (
    v_uid, null, 'ativo', v_uid, now()
  )
  returning * into v_reseller;

  insert into public.audit_logs (
    company_id, user_id, action, entity, entity_id, metadata
  )
  values (
    null,
    v_uid,
    'reseller_master_self_link',
    'reseller',
    v_reseller.id,
    jsonb_build_object(
      'email', v_profile.email,
      'platform_role', v_profile.platform_role
    )
  );

  return jsonb_build_object(
    'reseller_id', v_reseller.id,
    'status', v_reseller.status,
    'created', true
  );
exception
  when unique_violation then
    select *
    into v_reseller
    from public.resellers
    where user_id = v_uid;

    if not found then
      raise;
    end if;

    return jsonb_build_object(
      'reseller_id', v_reseller.id,
      'status', v_reseller.status,
      'created', false
    );
end;
$$;

revoke all on function public.ensure_master_reseller_access()
  from public, anon, authenticated;
grant execute on function public.ensure_master_reseller_access()
  to authenticated;

notify pgrst, 'reload schema';
