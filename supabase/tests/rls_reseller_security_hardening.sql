-- Endurecimento da revenda: escrita direta, ativacao e cancelamento.
-- Execucao local (apos 20261111000000):
--   Get-Content -Raw supabase/tests/rls_reseller_security_hardening.sql |
--     docker exec -i supabase_db_dellyvery-3 psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1
-- Transacao revertida ao final. Falha: RAISE EXCEPTION. Sucesso: NOTICE "PASS ...".

begin;

do $$
declare
  v_admin uuid := 'a1111111-1111-4111-8111-111111111101';
  v_reseller_user uuid := 'a1111111-1111-4111-8111-111111111102';
  v_owner_user uuid := 'a1111111-1111-4111-8111-111111111103';
  v_cross_user uuid := 'a1111111-1111-4111-8111-111111111104';
  v_noinvite_user uuid := 'a1111111-1111-4111-8111-111111111105';
  v_invite uuid := 'a1111111-1111-4111-8111-111111111106';
  v_package uuid := 'a1111111-1111-4111-8111-111111111107';
  v_reseller uuid;
  v_company uuid;
  v_client uuid := 'a2222222-2222-4222-8222-222222222201';
  v_client_new uuid := 'a2222222-2222-4222-8222-222222222202';
  v_client_noinvite uuid := 'a2222222-2222-4222-8222-222222222203';
  v_client_cross uuid := 'a2222222-2222-4222-8222-222222222204';
  v_plan uuid;
  v_order uuid;
  v_json jsonb;
  v_count int;
  v_company_name text;
  v_sub_status text;
  v_n int := 0;
begin
  delete from public.reseller_credit_entries
    where reseller_id in (select id from public.resellers where user_id = v_reseller_user);
  delete from public.reseller_credit_orders
    where reseller_id in (select id from public.resellers where user_id = v_reseller_user)
       or package_id = v_package;
  delete from public.reseller_credit_packages where id = v_package;
  delete from public.reseller_activations
    where reseller_id in (select id from public.resellers where user_id = v_reseller_user);
  delete from public.reseller_clients
    where id in (v_client, v_client_new, v_client_noinvite, v_client_cross);
  delete from public.companies where slug = 'hardening-empresa-alheia';
  delete from public.resellers where user_id = v_reseller_user;
  delete from public.reseller_invites where id = v_invite;
  delete from public.profiles where id in (v_admin, v_reseller_user, v_owner_user, v_cross_user, v_noinvite_user);
  delete from auth.users where id in (v_admin, v_reseller_user, v_owner_user, v_cross_user, v_noinvite_user);

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, confirmation_token, recovery_token)
  values
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hard_admin@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_reseller_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hard_reseller@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_owner_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hard_owner@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_cross_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hard_cross@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_noinvite_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hard_noinvite@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', '');

  insert into public.profiles (id, email, name, platform_role) values
    (v_admin, 'hard_admin@test.local', 'Hard Admin', 'PLATFORM_ADMIN'),
    (v_reseller_user, 'hard_reseller@test.local', 'Hard Reseller', 'USER'),
    (v_owner_user, 'hard_owner@test.local', 'Hard Owner', 'USER'),
    (v_cross_user, 'hard_cross@test.local', 'Hard Cross', 'USER'),
    (v_noinvite_user, 'hard_noinvite@test.local', 'Hard No Invite', 'USER')
  on conflict (id) do update set platform_role = excluded.platform_role;

  insert into public.reseller_invites (id, token, name, phone, status, registration, decided_at)
  values (v_invite, 'dddddddddddddddddddddddddddddd01', 'Hard Reseller', '5511990000401', 'aprovado',
          '{"email":"hard_reseller@test.local","phone":"5511990000401"}'::jsonb, now());

  insert into public.resellers (user_id, invite_id, status, approved_by)
  values (v_reseller_user, v_invite, 'ativo', v_admin)
  returning id into v_reseller;

  insert into public.reseller_credit_packages
    (id, name, description, credits, price, currency, active, sort_order, created_by)
  values (v_package, 'Pacote Hardening', 'Teste', 10, 100.00, 'BRL', true, 1, v_admin);

  -- Fixture: desabilita a guarda apenas para semear colunas protegidas.
  alter table public.reseller_clients disable trigger trg_reseller_client_guard;
  execute 'set role service_role';
  insert into public.reseller_clients
    (id, reseller_id, name, trade_name, email, phone, status, created_by)
  values
    (v_client, v_reseller, 'Cliente Direto', 'Direto', 'hard_direct@test.local', '5511990000402', 'prospecto', v_reseller_user);

  insert into public.reseller_clients
    (id, reseller_id, name, trade_name, email, phone, status, created_by, user_id)
  values
    (v_client_noinvite, v_reseller, 'Cliente Sem Convite', 'Sem Convite', 'hard_noinvite_client@test.local', '5511990000403', 'prospecto', v_reseller_user, v_noinvite_user);
  execute 'reset role';

  -- Empresa de terceiro: o usuario do cliente_cross nao e membro dela.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_owner_user::text, false);
  select public.create_company_with_owner('Hardening Empresa Alheia', 'hardening-empresa-alheia', null)
  into v_company;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';

  select name into v_company_name from public.companies where id = v_company;
  select status::text into v_sub_status
  from public.subscriptions where company_id = v_company;

  execute 'set role service_role';
  insert into public.reseller_clients
    (id, reseller_id, name, trade_name, email, phone, status, created_by, user_id, company_id)
  values
    (v_client_cross, v_reseller, 'Cliente Empresa Alheia', 'Empresa Alheia', 'hard_cross_client@test.local', '5511990000404', 'prospecto', v_admin, v_cross_user, v_company);
  execute 'reset role';
  alter table public.reseller_clients enable trigger trg_reseller_client_guard;

  select id into v_plan from public.plans where active = true order by created_at limit 1;
  if v_plan is null then raise exception 'FAIL setup: nenhum plano ativo'; end if;
  update public.plans set access_days = 30 where id = v_plan;

  -- 1) Revendedor nao pode inserir cliente ja vinculado a usuario/empresa.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_reseller_user::text, false);
  begin
    insert into public.reseller_clients
      (id, reseller_id, name, email, status, created_by, user_id)
    values
      ('a2222222-2222-4222-8222-222222222205', v_reseller, 'Invasao', 'hard_invasion@test.local', 'prospecto', v_reseller_user, v_noinvite_user);
    raise exception 'FAIL 1: insert direto com user_id passou';
  exception when others then
    if sqlerrm not ilike '%gerenciado pela ativacao%' then raise; end if;
  end;
  begin
    insert into public.reseller_clients
      (id, reseller_id, name, email, status, created_by, company_id)
    values
      ('a2222222-2222-4222-8222-222222222206', v_reseller, 'Invasao Empresa', 'hard_invasion_company@test.local', 'prospecto', v_reseller_user, v_company);
    raise exception 'FAIL 1b: insert direto com company_id passou';
  exception when others then
    if sqlerrm not ilike '%gerenciado pela ativacao%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS 1 (%/8)', v_n;

  -- 2) Cadastro comum do revendedor continua permitido.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_reseller_user::text, false);
  insert into public.reseller_clients
    (id, reseller_id, name, trade_name, email, phone, status, created_by)
  values
    (v_client_new, v_reseller, 'Cliente Novo', 'Novo', 'hard_new@test.local', '5511990000405', 'prospecto', v_reseller_user);
  update public.reseller_clients set trade_name = 'Novo Editado' where id = v_client_new;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if (select trade_name from public.reseller_clients where id = v_client_new) <> 'Novo Editado' then
    raise exception 'FAIL 2: cadastro/edicao comum falhou';
  end if;
  v_n := v_n + 1; raise notice 'PASS 2 (%/8)', v_n;

  -- 3) Revendedor nao altera company_id, user_id nem vencimento diretamente.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_reseller_user::text, false);
  begin
    update public.reseller_clients set company_id = v_company where id = v_client;
    raise exception 'FAIL 3a: company_id direto passou';
  exception when others then
    if sqlerrm not ilike '%gerenciado pela ativacao%' then raise; end if;
  end;
  begin
    update public.reseller_clients set user_id = v_noinvite_user where id = v_client;
    raise exception 'FAIL 3b: user_id direto passou';
  exception when others then
    if sqlerrm not ilike '%gerenciado pela ativacao%' then raise; end if;
  end;
  begin
    update public.reseller_clients set access_expires_at = now() + interval '1 year' where id = v_client;
    raise exception 'FAIL 3c: access_expires_at direto passou';
  exception when others then
    if sqlerrm not ilike '%gerenciado pela ativacao%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS 3 (%/8)', v_n;

  -- 4) Admin continua podendo ajustar campos protegidos.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  update public.reseller_clients set access_expires_at = now() + interval '1 day' where id = v_client;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if (select access_expires_at from public.reseller_clients where id = v_client) is null then
    raise exception 'FAIL 4: admin nao conseguiu ajustar vencimento';
  end if;
  v_n := v_n + 1; raise notice 'PASS 4 (%/8)', v_n;

  -- 5) Ativacao sem convite aceito e bloqueada antes de consumir credito.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  perform public.grant_reseller_credits(v_reseller, 2, 'teste hardening');
  perform set_config('request.jwt.claim.sub', v_reseller_user::text, false);
  begin
    perform public.activate_reseller_client_v2(
      v_client_noinvite, v_plan, 'a3333333-3333-4333-8333-333333333301'
    );
    raise exception 'FAIL 5: ativacao sem convite passou';
  exception when others then
    if sqlerrm not ilike '%convite aceito%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if exists (select 1 from public.reseller_activations where client_id = v_client_noinvite) then
    raise exception 'FAIL 5b: ativacao sem convite foi persistida';
  end if;
  v_n := v_n + 1; raise notice 'PASS 5 (%/8)', v_n;

  -- 6) Revendedor A nao ativa, renova nem altera a empresa B de terceiro.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_reseller_user::text, false);
  begin
    perform public.activate_reseller_client_v2(
      v_client_cross, v_plan, 'a3333333-3333-4333-8333-333333333302'
    );
    raise exception 'FAIL 6: ativacao de empresa alheia passou';
  exception when others then
    if sqlerrm not ilike '%Empresa nao pertence%' then raise; end if;
  end;
  begin
    update public.companies set name = name || ' HACK' where id = v_company;
  exception when others then null;
  end;
  begin
    update public.subscriptions set status = 'cancelado' where company_id = v_company;
  exception when others then null;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if exists (select 1 from public.reseller_activations where client_id = v_client_cross) then
    raise exception 'FAIL 6b: ativacao de empresa alheia foi persistida';
  end if;
  if (select name from public.companies where id = v_company) is distinct from v_company_name then
    raise exception 'FAIL 6c: revendedor alterou a empresa de terceiro';
  end if;
  if (select status::text from public.subscriptions where company_id = v_company)
     is distinct from v_sub_status then
    raise exception 'FAIL 6d: revendedor alterou a assinatura da empresa de terceiro';
  end if;
  v_n := v_n + 1; raise notice 'PASS 6 (%/8)', v_n;

  -- 7) Usuario sem revenda e service_role sem identidade nao cancelam pedido alheio.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_reseller_user::text, false);
  select public.create_reseller_credit_order(
    v_package, 'a3333333-3333-4333-8333-333333333303'
  ) into v_json;
  v_order := (v_json ->> 'order_id')::uuid;
  perform set_config('request.jwt.claim.sub', v_noinvite_user::text, false);
  begin
    perform public.cancel_reseller_credit_order(v_order, 'invasao sem revenda');
    raise exception 'FAIL 7: usuario sem revenda cancelou pedido';
  exception when others then
    if sqlerrm not ilike '%Pedido nao encontrado ou sem permissao%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if (select status from public.reseller_credit_orders where id = v_order) <> 'pendente' then
    raise exception 'FAIL 7b: pedido foi alterado por usuario sem revenda';
  end if;
  execute 'set role service_role';
  perform set_config('request.jwt.claim.role', 'service_role', true);
  begin
    perform public.cancel_reseller_credit_order(v_order, 'cancelamento backend service_role');
  exception when others then
    raise exception 'FAIL 7c: service_role nao conseguiu cancelar pedido: %', sqlerrm;
  end;
  perform set_config('request.jwt.claim.role', '', true);
  execute 'reset role';
  if (select status from public.reseller_credit_orders where id = v_order) <> 'cancelado' then
    raise exception 'FAIL 7d: service_role nao cancelou o pedido';
  end if;
  v_n := v_n + 1; raise notice 'PASS 7 (%/8)', v_n;

  -- 8) Funcoes legadas nao sao executaveis por authenticated/anon.
  if has_function_privilege('authenticated', 'public.activate_reseller_client_v2_legacy(uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.activate_reseller_client_v2_legacy(uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cancel_reseller_credit_order_legacy(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.cancel_reseller_credit_order_legacy(uuid,text)', 'EXECUTE') then
    raise exception 'FAIL 8: funcao legada executavel';
  end if;
  v_n := v_n + 1; raise notice 'PASS 8 (%/8)', v_n;

  raise notice 'ALL PASS (8/8)';
end;
$$;

rollback;
