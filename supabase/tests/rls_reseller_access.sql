-- Acesso do revendedor: RLS, vínculo, suspensão/reativação/revogação.
-- Execução local (após 20261113000000_dellyvery3_reseller_security_hardening_acl.sql):
--   Get-Content -Raw supabase/tests/rls_reseller_access.sql | docker exec -i supabase_db_dellyvery-3 psql -U postgres -d postgres -v ON_ERROR_STOP=1
-- Falha: RAISE EXCEPTION. Sucesso: NOTICE "PASS <id> (<n>/14)".

do $$
declare
  v_admin    uuid := '66666666-6666-6666-6666-666666666666';
  v_user     uuid := '77777777-7777-7777-7777-777777777777';
  v_other    uuid := '88888888-8888-8888-8888-888888888888';
  v_invite   uuid := '99999999-9999-4999-8999-999999999991';
  v_invite2  uuid := '99999999-9999-4999-8999-999999999992';
  v_invite3  uuid := '99999999-9999-4999-8999-999999999993';
  v_reseller uuid;
  v_count int;
  v_json jsonb;
  v_n int := 0;
begin
  -- Setup
  delete from public.resellers where user_id in (v_admin, v_user, v_other);
  delete from public.reseller_invites where id in (v_invite, v_invite2, v_invite3);
  delete from public.profiles where id in (v_admin, v_user, v_other);
  delete from auth.users where id in (v_admin, v_user, v_other);

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, confirmation_token, recovery_token)
  values
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ra_admin@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ra_user@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ra_other@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', '')
  on conflict (id) do nothing;

  insert into public.profiles (id, email, name, platform_role) values
    (v_admin, 'ra_admin@test.local', 'Reseller Admin', 'PLATFORM_ADMIN'),
    (v_user, 'ra_user@test.local', 'Reseller User', 'USER'),
    (v_other, 'ra_other@test.local', 'Other User', 'USER')
  on conflict (id) do update set platform_role = excluded.platform_role;

  insert into public.reseller_invites (id, token, name, phone, status, registration) values
    (v_invite, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1', 'Reseller User', '5511990000101', 'aguardando_aprovacao',
     '{"email":"ra_user@test.local","phone":"5511990000101"}'::jsonb),
    (v_invite2, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2', 'Reseller User 2', '5511990000102', 'aguardando_aprovacao',
     '{"email":"ra_other@test.local","phone":"5511990000102"}'::jsonb),
    (v_invite3, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3', 'Reseller Direct Insert', '5511990000103', 'aguardando_aprovacao',
     '{"email":"ra_admin@test.local","phone":"5511990000103"}'::jsonb);

  -- A1: RPC de aprovação não é executável pelo navegador.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  begin
    perform public.approve_reseller_access(v_invite, v_user, v_admin);
    raise exception 'FAIL A1: authenticated executou approve_reseller_access';
  exception when others then
    if sqlerrm not ilike '%permission%' and sqlerrm not ilike '%permiss%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS A1 (%/14)', v_n;

  -- A2: aprovação executada como service_role (Edge Function).
  execute 'set role service_role';
  select public.approve_reseller_access(v_invite, v_user, v_admin) into v_json;
  execute 'reset role';
  v_reseller := (v_json ->> 'reseller_id')::uuid;
  if v_reseller is null or (v_json ->> 'status') <> 'ativo' then
    raise exception 'FAIL A2: aprovação não criou vínculo ativo: %', v_json;
  end if;
  if coalesce((v_json ->> 'reused')::boolean, true) then raise exception 'FAIL A2: reused inesperado'; end if;
  v_n := v_n + 1; raise notice 'PASS A2 (%/14)', v_n;

  -- A3: convite e profile atualizados sem tocar platform_role.
  if (select status from public.reseller_invites where id = v_invite) <> 'aprovado' then
    raise exception 'FAIL A3: convite não aprovado';
  end if;
  if (select platform_role from public.profiles where id = v_user) <> 'USER' then
    raise exception 'FAIL A3: platform_role alterado';
  end if;
  v_n := v_n + 1; raise notice 'PASS A3 (%/14)', v_n;

  -- A4: reexecução idempotente devolve o mesmo vínculo.
  execute 'set role service_role';
  select public.approve_reseller_access(v_invite, v_user, v_admin) into v_json;
  execute 'reset role';
  if (v_json ->> 'reseller_id')::uuid <> v_reseller then
    raise exception 'FAIL A4: vínculo duplicado';
  end if;
  if not coalesce((v_json ->> 'reused')::boolean, false) then raise exception 'FAIL A4: reused esperado'; end if;
  v_n := v_n + 1; raise notice 'PASS A4 (%/14)', v_n;

  -- B1: anon não lê vínculos (sem GRANT SELECT).
  execute 'set role anon';
  begin
    select count(*) into v_count from public.resellers;
    raise exception 'FAIL B1: anon leu % vínculos', v_count;
  exception when insufficient_privilege then
    null;
  end;
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS B1 (%/14)', v_n;

  -- B2: revendedor lê somente o próprio vínculo.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  select count(*) into v_count from public.resellers;
  if v_count <> 1 then raise exception 'FAIL B2: revendedor leu % vínculos', v_count; end if;
  if not public.is_reseller() then raise exception 'FAIL B2: is_reseller falso'; end if;
  if public.current_reseller_id() is distinct from v_reseller then
    raise exception 'FAIL B2: current_reseller_id divergente';
  end if;
  perform set_config('request.jwt.claim.sub', v_other::text, false);
  select count(*) into v_count from public.resellers;
  if v_count <> 0 then raise exception 'FAIL B2b: outro usuário leu % vínculos', v_count; end if;
  if public.is_reseller() then raise exception 'FAIL B2b: is_reseller indevido'; end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS B2 (%/14)', v_n;

  -- B3: admin Master lê todos.
  execute 'set role service_role';
  select public.approve_reseller_access(v_invite2, v_other, v_admin) into v_json;
  execute 'reset role';
  if (v_json ->> 'status') <> 'ativo' then
    raise exception 'FAIL B3 setup: segundo vinculo nao ativado: %', v_json;
  end if;
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  select count(*) into v_count from public.resellers where user_id in (v_user, v_other);
  if v_count <> 2 then raise exception 'FAIL B3: admin leu % vínculos', v_count; end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS B3 (%/14)', v_n;

  -- B4/B5: escrita direta (insert/update) negada para authenticated.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  begin
    insert into public.resellers (user_id, invite_id, status) values (v_admin, v_invite3, 'ativo');
    raise exception 'FAIL B4: insert direto passou';
  exception when others then
    if sqlerrm not ilike '%permission%' and sqlerrm not ilike '%permiss%' and sqlerrm not ilike '%row-level%' then raise; end if;
  end;
  begin
    update public.resellers set status = 'inativo' where id = v_reseller;
    raise exception 'FAIL B5: update direto passou';
  exception when others then
    if sqlerrm not ilike '%permission%' and sqlerrm not ilike '%permiss%' and sqlerrm not ilike '%row-level%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if (select status from public.resellers where id = v_reseller) <> 'ativo' then
    raise exception 'FAIL B5: status corrompido por escrita direta';
  end if;
  v_n := v_n + 2; raise notice 'PASS B4/B5 (%/14)', v_n;

  -- C1: lookup de e-mail é restrito ao service_role.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  begin
    perform public.reseller_lookup_auth_user('ra_user@test.local');
    raise exception 'FAIL C1: authenticated executou lookup';
  exception when others then
    if sqlerrm not ilike '%permission%' and sqlerrm not ilike '%permiss%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  execute 'set role service_role';
  select public.reseller_lookup_auth_user('  RA_USER@TEST.LOCAL ') into v_json;
  execute 'reset role';
  if (v_json ->> 'user_id')::uuid <> v_user or not coalesce((v_json ->> 'email_confirmed')::boolean, false) then
    raise exception 'FAIL C1: lookup não normalizou/confirmou: %', v_json;
  end if;
  v_n := v_n + 1; raise notice 'PASS C1 (%/14)', v_n;

  -- C2: aprovação direta pendente -> aprovado é bloqueada pelo trigger.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  begin
    update public.reseller_invites set status = 'aprovado' where id = v_invite3;
    raise exception 'FAIL C2: aprovação direta passou';
  exception when others then
    if sqlerrm not ilike '%fluxo de acesso do revendedor%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if (select status from public.reseller_invites where id = v_invite3) <> 'aguardando_aprovacao' then
    raise exception 'FAIL C2: status alterado após bloqueio';
  end if;
  v_n := v_n + 1; raise notice 'PASS C2 (%/14)', v_n;

  -- D1: suspensão via convite desativa o acesso real.
  update public.reseller_invites set status = 'suspenso' where id = v_invite;
  if (select status from public.resellers where id = v_reseller) <> 'suspenso' then
    raise exception 'FAIL D1: vínculo não suspenso';
  end if;
  if not exists (select 1 from public.resellers where id = v_reseller and suspended_at is not null) then
    raise exception 'FAIL D1: suspended_at ausente';
  end if;
  v_n := v_n + 1; raise notice 'PASS D1 (%/14)', v_n;

  -- D2: reativação só restaura o acesso.
  update public.reseller_invites set status = 'aprovado' where id = v_invite;
  if (select status from public.resellers where id = v_reseller) <> 'ativo' then
    raise exception 'FAIL D2: vínculo não reativado';
  end if;
  if exists (select 1 from public.resellers where id = v_reseller and suspended_at is not null) then
    raise exception 'FAIL D2: suspended_at não limpo';
  end if;
  v_n := v_n + 1; raise notice 'PASS D2 (%/14)', v_n;

  -- D3: revogação é terminal e inativa o vínculo.
  update public.reseller_invites set status = 'revogado' where id = v_invite;
  if (select status from public.resellers where id = v_reseller) <> 'inativo' then
    raise exception 'FAIL D3: vínculo não inativado';
  end if;
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  if public.is_reseller() then raise exception 'FAIL D3: revogado ainda é revendedor'; end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS D3 (%/14)', v_n;

  -- Cleanup
  delete from public.resellers where user_id in (v_admin, v_user, v_other);
  delete from public.reseller_invites where id in (v_invite, v_invite2, v_invite3);
  delete from public.profiles where id in (v_admin, v_user, v_other);
  delete from auth.users where id in (v_admin, v_user, v_other);
  raise notice 'ALL PASS (14/14)';
end;
$$;
