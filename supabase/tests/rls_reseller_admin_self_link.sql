-- Auto-vinculo de PLATFORM_ADMIN como revendedor.
-- Execucao local (apos 20261108000000_dellyvery3_reseller_admin_self_link.sql):
--   Get-Content -Raw supabase/tests/rls_reseller_admin_self_link.sql | docker exec -i supabase_db_dellyvery-3 psql -U postgres -d postgres -v ON_ERROR_STOP=1
-- Falha: RAISE EXCEPTION. Sucesso: NOTICE "PASS <id> (<n>/5)".

do $$
declare
  v_admin       uuid := 'b1111111-1111-4111-8111-111111111111';
  v_other_admin uuid := 'b2222222-2222-4222-8222-222222222222';
  v_invite      uuid := 'b3333333-3333-4333-8333-333333333333';
  v_invite2     uuid := 'b4444444-4444-4444-8444-444444444444';
  v_reseller    uuid;
  v_json        jsonb;
  v_count       int;
  v_n           int := 0;
begin
  delete from public.resellers where user_id in (v_admin, v_other_admin);
  delete from public.reseller_invites where id in (v_invite, v_invite2);
  delete from public.profiles where id in (v_admin, v_other_admin);
  delete from auth.users where id in (v_admin, v_other_admin);

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, confirmation_token, recovery_token)
  values
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'self_admin@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_other_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other_admin@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', '')
  on conflict (id) do nothing;

  insert into public.profiles (id, email, name, platform_role) values
    (v_admin, 'self_admin@test.local', 'Self Admin', 'PLATFORM_ADMIN'),
    (v_other_admin, 'other_admin@test.local', 'Other Admin', 'PLATFORM_ADMIN')
  on conflict (id) do update set platform_role = excluded.platform_role;

  insert into public.reseller_invites (id, token, name, phone, status, registration) values
    (v_invite, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1', 'Self Admin', '5511990000201', 'aguardando_aprovacao',
     '{"email":"self_admin@test.local","phone":"5511990000201"}'::jsonb),
    (v_invite2, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2', 'Other Admin', '5511990000202', 'aguardando_aprovacao',
     '{"email":"other_admin@test.local","phone":"5511990000202"}'::jsonb);

  -- S1: PLATFORM_ADMIN vincula a propria conta.
  execute 'set role service_role';
  select public.approve_reseller_access(v_invite, v_admin, v_admin) into v_json;
  execute 'reset role';
  v_reseller := (v_json ->> 'reseller_id')::uuid;
  if v_reseller is null or (v_json ->> 'status') <> 'ativo' then
    raise exception 'FAIL S1: auto-vinculo nao criou acesso ativo: %', v_json;
  end if;
  v_n := v_n + 1; raise notice 'PASS S1 (%/5)', v_n;

  -- S2: o privilegio Master e preservado.
  if (select platform_role from public.profiles where id = v_admin) <> 'PLATFORM_ADMIN' then
    raise exception 'FAIL S2: platform_role foi alterado';
  end if;
  if (select approved_by from public.resellers where id = v_reseller) <> v_admin then
    raise exception 'FAIL S2: approved_by incorreto';
  end if;
  v_n := v_n + 1; raise notice 'PASS S2 (%/5)', v_n;

  -- S3: a conta continua sendo reconhecida como revendedora ativa.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  if not public.is_reseller() then
    raise exception 'FAIL S3: is_reseller falso para admin vinculado';
  end if;
  if public.current_reseller_id() is distinct from v_reseller then
    raise exception 'FAIL S3: current_reseller_id divergente';
  end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS S3 (%/5)', v_n;

  -- S4: um admin nao pode vincular outro admin por este fluxo.
  execute 'set role service_role';
  begin
    perform public.approve_reseller_access(v_invite2, v_other_admin, v_admin);
    raise exception 'FAIL S4: admin vinculou outro admin';
  exception when others then
    if sqlerrm not ilike '%Administrador so pode vincular a propria conta%' then raise; end if;
  end;
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS S4 (%/5)', v_n;

  -- S5: tentativa bloqueada nao deixa vinculo nem aprova o convite.
  select count(*) into v_count from public.resellers where user_id = v_other_admin;
  if v_count <> 0 then
    raise exception 'FAIL S5: outro admin ficou vinculado';
  end if;
  if (select status from public.reseller_invites where id = v_invite2) <> 'aguardando_aprovacao' then
    raise exception 'FAIL S5: convite do outro admin foi aprovado';
  end if;
  v_n := v_n + 1; raise notice 'PASS S5 (%/5)', v_n;

  delete from public.resellers where user_id in (v_admin, v_other_admin);
  delete from public.reseller_invites where id in (v_invite, v_invite2);
  delete from public.profiles where id in (v_admin, v_other_admin);
  delete from auth.users where id in (v_admin, v_other_admin);
  raise notice 'ALL PASS (5/5)';
end;
$$;
