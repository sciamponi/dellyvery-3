-- Modulos da revenda: clientes, creditos e ativacoes.
-- Execucao local (apos 20261106000000_dellyvery3_reseller_modules.sql):
--   Get-Content -Raw supabase/tests/rls_reseller_modules.sql | docker exec -i supabase_db_dellyvery-3 psql -U postgres -d postgres -v ON_ERROR_STOP=1
-- Falha: RAISE EXCEPTION. Sucesso: NOTICE "PASS <id> (<n>/16)".

begin;

do $$
declare
  v_admin    uuid := '66666666-6666-6666-6666-666666666601';
  v_user     uuid := '77777777-7777-7777-7777-777777777701';
  v_other    uuid := '88888888-8888-8888-8888-888888888801';
  v_client_user1 uuid := '22222222-2222-4222-8222-222222222201';
  v_client_user2 uuid := '22222222-2222-4222-8222-222222222202';
  v_invite1  uuid := '99999999-9999-4999-8999-999999999901';
  v_invite2  uuid := '99999999-9999-4999-8999-999999999902';
  v_client1  uuid := '11111111-1111-4111-8111-111111111101';
  v_client2  uuid := '11111111-1111-4111-8111-111111111102';
  v_client3  uuid := '11111111-1111-4111-8111-111111111103';
  v_reseller1 uuid;
  v_reseller2 uuid;
  v_plan     uuid;
  v_plan_old_days int;
  v_activation uuid;
  v_company1 uuid;
  v_key      uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  v_count    int;
  v_json     jsonb;
  v_json2    jsonb;
  v_n        int := 0;
begin
  -- Setup
  delete from public.reseller_client_invites
    where reseller_id in (select id from public.resellers where user_id in (v_admin, v_user, v_other));
  delete from public.companies
    where id in (
      select company_id from public.reseller_clients
      where reseller_id in (select id from public.resellers where user_id in (v_admin, v_user, v_other))
    );
  delete from public.reseller_credit_entries
    where reseller_id in (select id from public.resellers where user_id in (v_admin, v_user, v_other));
  delete from public.reseller_activations
    where reseller_id in (select id from public.resellers where user_id in (v_admin, v_user, v_other));
  delete from public.reseller_clients
    where reseller_id in (select id from public.resellers where user_id in (v_admin, v_user, v_other));
  delete from public.resellers where user_id in (v_admin, v_user, v_other);
  delete from public.reseller_invites where id in (v_invite1, v_invite2);
  delete from public.profiles where id in (v_admin, v_user, v_other, v_client_user1, v_client_user2);
  delete from auth.users where id in (v_admin, v_user, v_other, v_client_user1, v_client_user2);

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, confirmation_token, recovery_token)
  values
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rm_admin@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rm_user@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rm_other@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_client_user1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rm_client1@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_client_user2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rm_client2@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', '')
  on conflict (id) do nothing;

  insert into public.profiles (id, email, name, platform_role) values
    (v_admin, 'rm_admin@test.local', 'Modules Admin', 'PLATFORM_ADMIN'),
    (v_user, 'rm_user@test.local', 'Modules User', 'USER'),
    (v_other, 'rm_other@test.local', 'Modules Other', 'USER'),
    (v_client_user1, 'rm_client1@test.local', 'Cliente 1', 'USER'),
    (v_client_user2, 'rm_client2@test.local', 'Cliente 2', 'USER')
  on conflict (id) do update set platform_role = excluded.platform_role;

  insert into public.reseller_invites (id, token, name, phone, status, registration, decided_at) values
    (v_invite1, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1', 'Modules User', '5511990000201', 'aprovado',
     '{"email":"rm_user@test.local","phone":"5511990000201"}'::jsonb, now()),
    (v_invite2, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2', 'Modules Other', '5511990000202', 'aprovado',
     '{"email":"rm_other@test.local","phone":"5511990000202"}'::jsonb, now());

  insert into public.resellers (user_id, invite_id, status, approved_by)
  values (v_user, v_invite1, 'ativo', v_admin)
  returning id into v_reseller1;

  insert into public.resellers (user_id, invite_id, status, approved_by)
  values (v_other, v_invite2, 'ativo', v_admin)
  returning id into v_reseller2;

  -- Fixture: desabilita a guarda apenas para semear clientes com vinculo.
  alter table public.reseller_clients disable trigger trg_reseller_client_guard;
  execute 'set role service_role';
  insert into public.reseller_clients (id, reseller_id, name, email, status, created_by, user_id) values
    (v_client1, v_reseller1, 'Cliente Revenda 1', 'rm_client1@test.local', 'prospecto', v_admin, v_client_user1),
    (v_client2, v_reseller2, 'Cliente Revenda 2', 'rm_client2@test.local', 'prospecto', v_admin, v_client_user2);
  execute 'reset role';
  alter table public.reseller_clients enable trigger trg_reseller_client_guard;

  select id, access_days into v_plan, v_plan_old_days from public.plans where active = true order by created_at limit 1;
  if v_plan is null then raise exception 'FAIL setup: nenhum plano ativo para o teste'; end if;
  update public.plans set access_days = 30 where id = v_plan;

  -- A1: anon nao acessa as tabelas dos modulos.
  execute 'set role anon';
  begin
    select count(*) into v_count from public.reseller_clients;
    raise exception 'FAIL A1: anon leu % clientes', v_count;
  exception when insufficient_privilege then
    null;
  end;
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS A1 (%/16)', v_n;

  -- A2: cada revendedor le apenas seus clientes; admin le todos.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  select count(*) into v_count from public.reseller_clients where id in (v_client1, v_client2);
  if v_count <> 1 then raise exception 'FAIL A2: revendedor leu % clientes', v_count; end if;
  perform set_config('request.jwt.claim.sub', v_other::text, false);
  select count(*) into v_count from public.reseller_clients where id in (v_client1, v_client2);
  if v_count <> 1 then raise exception 'FAIL A2b: outro leu % clientes', v_count; end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  select count(*) into v_count from public.reseller_clients where id in (v_client1, v_client2);
  if v_count <> 2 then raise exception 'FAIL A2c: admin leu % clientes', v_count; end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS A2 (%/16)', v_n;

  -- B1: insert em carteira alheia e negado pela RLS.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  begin
    insert into public.reseller_clients (id, reseller_id, name, status)
    values (v_client3, v_reseller2, 'Invasao', 'prospecto');
    raise exception 'FAIL B1: insert em carteira alheia passou';
  exception when others then
    if sqlerrm not ilike '%row-level%' and sqlerrm not ilike '%permission%' and sqlerrm not ilike '%permiss%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if exists (select 1 from public.reseller_clients where id = v_client3) then
    raise exception 'FAIL B1: cliente invasor persistiu';
  end if;
  v_n := v_n + 1; raise notice 'PASS B1 (%/16)', v_n;

  -- B2: revendedor cria cliente na propria carteira.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  insert into public.reseller_clients (id, reseller_id, name, status)
  values (v_client3, v_reseller1, 'Cliente Proprio', 'prospecto');
  if (select created_by from public.reseller_clients where id = v_client3) <> v_user then
    raise exception 'FAIL B2: created_by nao veio de auth.uid()';
  end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS B2 (%/16)', v_n;

  -- B3: update em cliente alheio nao afeta a linha.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  update public.reseller_clients set name = 'Alterado' where id = v_client2;
  update public.reseller_clients set status = 'inativo' where id = v_client1;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if (select name from public.reseller_clients where id = v_client2) <> 'Cliente Revenda 2' then
    raise exception 'FAIL B3: cliente alheio foi alterado';
  end if;
  if (select status from public.reseller_clients where id = v_client1) <> 'inativo' then
    raise exception 'FAIL B3b: update proprio nao aplicado';
  end if;
  v_n := v_n + 1; raise notice 'PASS B3 (%/16)', v_n;

  -- C1: escrita direta de ativacao e negada.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  begin
    insert into public.reseller_activations (reseller_id, client_id, plan_id, expires_on)
    values (v_reseller1, v_client1, v_plan, current_date + 30);
    raise exception 'FAIL C1: insert direto de ativacao passou';
  exception when insufficient_privilege then
    null;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS C1 (%/16)', v_n;

  -- C2: escrita direta no extrato e negada.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  begin
    insert into public.reseller_credit_entries (reseller_id, kind, amount)
    values (v_reseller1, 'credito', 5);
    raise exception 'FAIL C2: insert direto no extrato passou';
  exception when insufficient_privilege then
    null;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS C2 (%/16)', v_n;

  -- C3: extrato imutavel mesmo para service_role.
  execute 'set role service_role';
  begin
    update public.reseller_credit_entries set amount = 1 where false;
    delete from public.reseller_credit_entries where false;
    insert into public.reseller_credit_entries (reseller_id, kind, amount)
    values (v_reseller1, 'credito', 1);
    begin
      update public.reseller_credit_entries set amount = 9;
      raise exception 'FAIL C3: update direto no extrato passou';
    exception when others then
      if sqlerrm not ilike '%imutavel%' then raise; end if;
    end;
  exception when others then
    raise;
  end;
  execute 'reset role';
  delete from public.reseller_credit_entries where reseller_id = v_reseller1 and amount = 1 and kind = 'credito';
  v_n := v_n + 1; raise notice 'PASS C3 (%/16)', v_n;

  -- D1: revendedor nao concede creditos.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  begin
    perform public.grant_reseller_credits(v_reseller1, 10, 'tentativa');
    raise exception 'FAIL D1: revendedor concedeu creditos';
  exception when others then
    if sqlerrm not ilike '%Sem permissao%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS D1 (%/16)', v_n;

  -- D2: Master concede e o saldo/ledger refletem a operacao.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  select public.grant_reseller_credits(v_reseller1, 10, 'pacote teste') into v_json;
  if (v_json ->> 'balance')::int <> 10 then
    raise exception 'FAIL D2: saldo apos concessao = %', v_json;
  end if;
  if (select count(*) from public.reseller_credit_entries where reseller_id = v_reseller1) <> 1 then
    raise exception 'FAIL D2b: ledger nao registrou um lancamento';
  end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS D2 (%/16)', v_n;

  -- D3: revendedor consulta apenas o proprio saldo.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  if public.reseller_credit_balance(null) <> 10 then
    raise exception 'FAIL D3: saldo proprio incorreto';
  end if;
  begin
    perform public.reseller_credit_balance(v_reseller2);
    raise exception 'FAIL D3b: revendedor leu saldo alheio';
  exception when others then
    if sqlerrm not ilike '%Sem permissao%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS D3 (%/16)', v_n;

  -- E1: ativacao de cliente alheio e recusada.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  begin
    perform public.activate_reseller_client_v2(v_client2, v_plan, v_key);
    raise exception 'FAIL E1: ativou cliente alheio';
  exception when others then
    if sqlerrm not ilike '%Cliente nao encontrado%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS E1 (%/16)', v_n;

  -- E2: saldo insuficiente nao cria ativacao nem debita.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_other::text, false);
  begin
    perform public.activate_reseller_client_v2(v_client2, v_plan, v_key);
    raise exception 'FAIL E2: ativou sem saldo';
  exception when others then
    if sqlerrm not ilike '%Saldo insuficiente%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if (select count(*) from public.reseller_activations where reseller_id = v_reseller2) <> 0 then
    raise exception 'FAIL E2b: ativacao criada mesmo sem saldo';
  end if;
  if (select coalesce(sum(amount), 0) from public.reseller_credit_entries where reseller_id = v_reseller2) <> 0 then
    raise exception 'FAIL E2c: saldo debitado indevidamente';
  end if;
  v_n := v_n + 1; raise notice 'PASS E2 (%/16)', v_n;

  -- E3: ativacao v2 consome exatamente 1 credito e usa access_days do plano.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  select public.activate_reseller_client_v2(v_client1, v_plan, v_key) into v_json;
  v_activation := (v_json ->> 'activation_id')::uuid;
  v_company1 := (v_json ->> 'company_id')::uuid;
  if v_activation is null or v_company1 is null or (v_json ->> 'balance')::int <> 9 then
    raise exception 'FAIL E3: retorno inesperado %', v_json;
  end if;
  if (v_json ->> 'credits')::int <> 1 or (v_json ->> 'access_days')::int <> 30
     or v_json ->> 'kind' <> 'first_activation' then
    raise exception 'FAIL E3b: retorno sem 1 credito/30 dias/first_activation %', v_json;
  end if;
  select public.activate_reseller_client_v2(v_client1, v_plan, v_key) into v_json2;
  if not (v_json2 ->> 'reused')::boolean or (v_json2 ->> 'activation_id')::uuid <> v_activation then
    raise exception 'FAIL E3c: idempotencia nao reutilizou a ativacao %', v_json2;
  end if;
  if (select count(*) from public.reseller_activations where reseller_id = v_reseller1) <> 1 then
    raise exception 'FAIL E3d: idempotencia criou outra ativacao';
  end if;
  perform set_config('request.jwt.claim.sub', v_client_user1::text, false);
  if not public.is_company_member(v_company1) then
    raise exception 'FAIL E3e: cliente nao reconhecido como membro ativo';
  end if;
  if not public.company_has_active_access(v_company1) then
    raise exception 'FAIL E3f: empresa ativada sem acesso';
  end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if (select status from public.reseller_clients where id = v_client1) <> 'ativo' then
    raise exception 'FAIL E3g: cliente nao ativado';
  end if;
  if (select credits from public.reseller_activations where id = v_activation) <> 1 then
    raise exception 'FAIL E3h: creditos da ativacao incorretos';
  end if;
  if (select amount from public.reseller_credit_entries where activation_id = v_activation) <> -1 then
    raise exception 'FAIL E3i: debito ausente no extrato';
  end if;
  if (select count(*) from public.company_members where company_id = v_company1 and user_id = v_client_user1 and role = 'OWNER') <> 1 then
    raise exception 'FAIL E3j: OWNER da empresa nao criado';
  end if;
  if (select expires_at from public.subscriptions where company_id = v_company1) <= now() + interval '29 days' then
    raise exception 'FAIL E3k: assinatura sem 30 dias';
  end if;
  if (select coalesce(sum(amount), 0) from public.reseller_credit_entries where reseller_id = v_reseller1) <> 9 then
    raise exception 'FAIL E3l: saldo final incorreto';
  end if;
  v_n := v_n + 1; raise notice 'PASS E3 (%/16)', v_n;

  -- E4: Master nao executa ativacao como revendedor.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  begin
    perform public.activate_reseller_client_v2(v_client1, v_plan, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2');
    raise exception 'FAIL E4: admin ativou cliente';
  exception when others then
    if sqlerrm not ilike '%Acesso de revenda inativo%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS E4 (%/16)', v_n;

  -- F1: isolamento de leitura de ativacoes e extrato.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  select count(*) into v_count from public.reseller_activations;
  if v_count <> 1 then raise exception 'FAIL F1: revendedor leu % ativacoes', v_count; end if;
  select count(*) into v_count from public.reseller_credit_entries;
  if v_count <> 2 then raise exception 'FAIL F1b: revendedor leu % lancamentos', v_count; end if;
  perform set_config('request.jwt.claim.sub', v_other::text, false);
  select count(*) into v_count from public.reseller_activations;
  if v_count <> 0 then raise exception 'FAIL F1c: outro leu % ativacoes', v_count; end if;
  select count(*) into v_count from public.reseller_credit_entries;
  if v_count <> 0 then raise exception 'FAIL F1d: outro leu % lancamentos', v_count; end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  select count(*) into v_count from public.reseller_activations;
  if v_count <> 1 then raise exception 'FAIL F1e: admin leu % ativacoes', v_count; end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS F1 (%/16)', v_n;

  -- Cleanup
  delete from public.reseller_credit_entries where reseller_id in (v_reseller1, v_reseller2);
  delete from public.reseller_activations where reseller_id in (v_reseller1, v_reseller2);
  delete from public.reseller_client_invites where reseller_id in (v_reseller1, v_reseller2);
  delete from public.reseller_clients where reseller_id in (v_reseller1, v_reseller2);
  delete from public.audit_logs where company_id = v_company1;
  delete from public.companies where id = v_company1;
  delete from public.resellers where id in (v_reseller1, v_reseller2);
  delete from public.reseller_invites where id in (v_invite1, v_invite2);
  update public.plans set access_days = v_plan_old_days where id = v_plan;
  delete from public.profiles where id in (v_admin, v_user, v_other, v_client_user1, v_client_user2);
  delete from auth.users where id in (v_admin, v_user, v_other, v_client_user1, v_client_user2);
  raise notice 'ALL PASS (16/16)';
end;
$$;

rollback;
