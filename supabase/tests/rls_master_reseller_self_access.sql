do $$
declare
  v_admin uuid := 'c1111111-1111-4111-8111-111111111111';
  v_user  uuid := 'c2222222-2222-4222-8222-222222222222';
  v_reseller uuid;
  v_json jsonb;
  v_n int := 0;
begin
  delete from public.audit_logs
  where entity = 'reseller'
    and user_id in (v_admin, v_user);
  delete from public.resellers where user_id in (v_admin, v_user);
  delete from public.profiles where id in (v_admin, v_user);
  delete from auth.users where id in (v_admin, v_user);

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    is_super_admin, confirmation_token, recovery_token
  )
  values
    (
      v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated',
      'authenticated', 'master_self@test.local',
      crypt('password', gen_salt('bf')), now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{}', false, '', ''
    ),
    (
      v_user, '00000000-0000-0000-0000-000000000000', 'authenticated',
      'authenticated', 'master_self_user@test.local',
      crypt('password', gen_salt('bf')), now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{}', false, '', ''
    );

  insert into public.profiles (id, email, name, platform_role)
  values
    (v_admin, 'master_self@test.local', 'Master Self', 'PLATFORM_ADMIN'),
    (v_user, 'master_self_user@test.local', 'Master Self User', 'USER');

  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  select public.ensure_master_reseller_access() into v_json;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';

  v_reseller := (v_json ->> 'reseller_id')::uuid;
  if v_reseller is null then
    raise exception 'FAIL S1: vinculo nao criado: %', v_json;
  end if;
  if (v_json ->> 'created')::boolean is not true then
    raise exception 'FAIL S1: created deveria ser true: %', v_json;
  end if;
  if (v_json ->> 'status') <> 'ativo' then
    raise exception 'FAIL S1: status incorreto: %', v_json;
  end if;
  v_n := v_n + 1;
  raise notice 'PASS S1 (%/6)', v_n;

  if (select invite_id from public.resellers where id = v_reseller) is not null then
    raise exception 'FAIL S2: invite_id deveria ser null';
  end if;
  if (select approved_by from public.resellers where id = v_reseller) <> v_admin then
    raise exception 'FAIL S2: approved_by incorreto';
  end if;
  if (select platform_role from public.profiles where id = v_admin) <> 'PLATFORM_ADMIN' then
    raise exception 'FAIL S2: platform_role alterado';
  end if;
  v_n := v_n + 1;
  raise notice 'PASS S2 (%/6)', v_n;

  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  select public.ensure_master_reseller_access() into v_json;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';

  if (v_json ->> 'reseller_id')::uuid <> v_reseller then
    raise exception 'FAIL S3: vinculo duplicado: %', v_json;
  end if;
  if (v_json ->> 'created')::boolean is not false then
    raise exception 'FAIL S3: created deveria ser false: %', v_json;
  end if;
  v_n := v_n + 1;
  raise notice 'PASS S3 (%/6)', v_n;

  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  begin
    perform public.ensure_master_reseller_access();
    raise exception 'FAIL S4: usuario comum criou vinculo';
  exception when others then
    if sqlerrm not ilike '%Sem permissao%' then
      raise;
    end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';

  if exists (select 1 from public.resellers where user_id = v_user) then
    raise exception 'FAIL S4: usuario comum ficou vinculado';
  end if;
  v_n := v_n + 1;
  raise notice 'PASS S4 (%/6)', v_n;

  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  if not public.is_reseller() then
    raise exception 'FAIL S5: is_reseller falso para o Master';
  end if;
  if public.current_reseller_id() is distinct from v_reseller then
    raise exception 'FAIL S5: current_reseller_id divergente';
  end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1;
  raise notice 'PASS S5 (%/6)', v_n;

  if not exists (
    select 1 from public.audit_logs
    where entity = 'reseller'
      and entity_id = v_reseller
      and action = 'reseller_master_self_link'
  ) then
    raise exception 'FAIL S6: auditoria ausente';
  end if;
  v_n := v_n + 1;
  raise notice 'PASS S6 (%/6)', v_n;

  delete from public.audit_logs
  where entity = 'reseller'
    and entity_id = v_reseller;
  delete from public.resellers where id = v_reseller;
  delete from public.profiles where id in (v_admin, v_user);
  delete from auth.users where id in (v_admin, v_user);

  raise notice 'ALL PASS (6/6)';
end;
$$;
