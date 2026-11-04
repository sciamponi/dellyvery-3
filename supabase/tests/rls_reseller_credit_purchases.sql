-- Compra de creditos da revenda: RLS, RPCs, idempotencia e ledger.
-- Execucao local (apos 20261118000000_dellyvery3_reseller_credit_purchase_hardening.sql):
--   Get-Content -Raw supabase/tests/rls_reseller_credit_purchases.sql | docker exec -i supabase_db_dellyvery-3 psql -U postgres -d postgres -v ON_ERROR_STOP=1
-- Falha: RAISE EXCEPTION. Sucesso: NOTICE "PASS <id> (<n>/18)".

begin;

do $$
declare
  v_admin     uuid := '66666666-6666-4666-8666-666666666602';
  v_user      uuid := '77777777-7777-4777-8777-777777777702';
  v_other     uuid := '88888888-8888-4888-8888-888888888802';
  v_invite1   uuid := '99999999-9999-4999-8999-999999999903';
  v_invite2   uuid := '99999999-9999-4999-8999-999999999904';
  v_pkg_on    uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
  v_pkg_off   uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02';
  v_reseller1 uuid;
  v_reseller2 uuid;
  v_key1      uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01';
  v_key2      uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02';
  v_key3      uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb03';
  v_order1    uuid;
  v_order2    uuid;
  v_count     int;
  v_json      jsonb;
  v_n         int := 0;
begin
  -- Setup isolado: remove apenas os registros deste teste.
  delete from public.reseller_credit_entries
    where reseller_id in (select id from public.resellers where user_id in (v_admin, v_user, v_other));
  delete from public.reseller_credit_orders
    where reseller_id in (select id from public.resellers where user_id in (v_admin, v_user, v_other))
       or package_id in (v_pkg_on, v_pkg_off);
  delete from public.reseller_credit_packages where id in (v_pkg_on, v_pkg_off);
  delete from public.reseller_activations
    where reseller_id in (select id from public.resellers where user_id in (v_admin, v_user, v_other));
  delete from public.reseller_clients
    where reseller_id in (select id from public.resellers where user_id in (v_admin, v_user, v_other));
  delete from public.resellers where user_id in (v_admin, v_user, v_other);
  delete from public.reseller_invites where id in (v_invite1, v_invite2);
  delete from public.profiles where id in (v_admin, v_user, v_other);
  delete from auth.users where id in (v_admin, v_user, v_other);

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, confirmation_token, recovery_token)
  values
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rc_admin@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rc_user@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rc_other@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', '')
  on conflict (id) do nothing;

  insert into public.profiles (id, email, name, platform_role) values
    (v_admin, 'rc_admin@test.local', 'Credit Admin', 'PLATFORM_ADMIN'),
    (v_user, 'rc_user@test.local', 'Credit User', 'USER'),
    (v_other, 'rc_other@test.local', 'Credit Other', 'USER')
  on conflict (id) do update set platform_role = excluded.platform_role;

  insert into public.reseller_invites (id, token, name, phone, status, registration, decided_at) values
    (v_invite1, 'ccccccccccccccccccccccccccccccc1', 'Credit User', '5511990000301', 'aprovado',
     '{"email":"rc_user@test.local","phone":"5511990000301"}'::jsonb, now()),
    (v_invite2, 'ccccccccccccccccccccccccccccccc2', 'Credit Other', '5511990000302', 'aprovado',
     '{"email":"rc_other@test.local","phone":"5511990000302"}'::jsonb, now());

  insert into public.resellers (user_id, invite_id, status, approved_by)
  values (v_user, v_invite1, 'ativo', v_admin)
  returning id into v_reseller1;

  insert into public.resellers (user_id, invite_id, status, approved_by)
  values (v_other, v_invite2, 'ativo', v_admin)
  returning id into v_reseller2;

  insert into public.reseller_credit_packages
    (id, name, description, credits, price, currency, active, sort_order, created_by)
  values
    (v_pkg_on, 'Pacote Ativo', 'Dez creditos', 10, 99.90, 'BRL', true, 1, v_admin),
    (v_pkg_off, 'Pacote Inativo', 'Nao deve aparecer', 20, 150.00, 'BRL', false, 2, v_admin);

  -- A1: anon nao acessa as tabelas de compra.
  execute 'set role anon';
  begin
    select count(*) into v_count from public.reseller_credit_orders;
    raise exception 'FAIL A1: anon leu % pedidos', v_count;
  exception when insufficient_privilege then
    null;
  end;
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS A1 (%/18)', v_n;

  -- A2: revendedor ve somente pacotes ativos; admin ve todos.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  select count(*) into v_count from public.reseller_credit_packages where id in (v_pkg_on, v_pkg_off);
  if v_count <> 1 then raise exception 'FAIL A2: revendedor viu % pacotes', v_count; end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  select count(*) into v_count from public.reseller_credit_packages where id in (v_pkg_on, v_pkg_off);
  if v_count <> 2 then raise exception 'FAIL A2b: admin viu % pacotes', v_count; end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS A2 (%/18)', v_n;

  -- B1: revendedor nao escreve pedido diretamente.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  begin
    insert into public.reseller_credit_orders
      (reseller_id, package_id, package_name, package_snapshot, credits, amount, currency, idempotency_key)
    values
      (v_reseller1, v_pkg_on, 'Invasao', '{}', 10, 0, 'BRL', v_key3);
    raise exception 'FAIL B1: insert direto de pedido passou';
  exception when insufficient_privilege then
    null;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS B1 (%/18)', v_n;

  -- B2: cria pedido com snapshot vindo do pacote.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  select public.create_reseller_credit_order(v_pkg_on, v_key1) into v_json;
  v_order1 := (v_json ->> 'order_id')::uuid;
  if v_order1 is null or (v_json ->> 'status') <> 'pendente' then
    raise exception 'FAIL B2: retorno inesperado %', v_json;
  end if;
  if (v_json ->> 'credits')::int <> 10 or (v_json ->> 'amount')::numeric <> 99.90 then
    raise exception 'FAIL B2b: snapshot incorreto %', v_json;
  end if;
  if (select package_snapshot ->> 'name' from public.reseller_credit_orders where id = v_order1) <> 'Pacote Ativo' then
    raise exception 'FAIL B2c: snapshot do pacote ausente';
  end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS B2 (%/18)', v_n;

  -- B3: repetir a mesma chave retorna o mesmo pedido.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  select public.create_reseller_credit_order(v_pkg_on, v_key1) into v_json;
  if (v_json ->> 'order_id')::uuid <> v_order1 or not (v_json ->> 'reused')::boolean then
    raise exception 'FAIL B3: idempotencia nao reutilizou o pedido %', v_json;
  end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if (select count(*) from public.reseller_credit_orders where reseller_id = v_reseller1) <> 1 then
    raise exception 'FAIL B3b: pedido duplicado';
  end if;
  v_n := v_n + 1; raise notice 'PASS B3 (%/18)', v_n;

  -- B4: revendedor nao cancela pedido alheio.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_other::text, false);
  begin
    perform public.cancel_reseller_credit_order(v_order1, 'invasao');
    raise exception 'FAIL B4: cancelou pedido alheio';
  exception when others then
    if sqlerrm not ilike '%sem permissao%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS B4 (%/18)', v_n;

  -- B5: revendedor cancela o proprio pedido pendente, sem creditar.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  select public.cancel_reseller_credit_order(v_order1, 'desistencia') into v_json;
  if (v_json ->> 'status') <> 'cancelado' then
    raise exception 'FAIL B5: retorno inesperado %', v_json;
  end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if exists (select 1 from public.reseller_credit_entries where purchase_order_id = v_order1) then
    raise exception 'FAIL B5b: pedido cancelado gerou lancamento';
  end if;
  v_n := v_n + 1; raise notice 'PASS B5 (%/18)', v_n;

  -- B6: revendedor nao confirma o proprio pagamento.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  select public.create_reseller_credit_order(v_pkg_on, v_key2) into v_json;
  v_order2 := (v_json ->> 'order_id')::uuid;
  begin
    perform public.confirm_reseller_credit_order(v_order2, 99.90, 'auto');
    raise exception 'FAIL B6: revendedor confirmou pagamento';
  exception when others then
    if sqlerrm not ilike '%Sem permissao%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS B6 (%/18)', v_n;

  -- C1: Master confirma e o ledger recebe exatamente o snapshot.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  select public.confirm_reseller_credit_order(v_order2, 99.90, '  comprovante 1  ') into v_json;
  if (v_json ->> 'balance')::int <> 10 or (v_json ->> 'reused')::boolean then
    raise exception 'FAIL C1: retorno inesperado %', v_json;
  end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if (select status from public.reseller_credit_orders where id = v_order2) <> 'creditado' then
    raise exception 'FAIL C1b: pedido nao foi creditado';
  end if;
  if (select amount from public.reseller_credit_entries where purchase_order_id = v_order2) <> 10
     or (select kind from public.reseller_credit_entries where purchase_order_id = v_order2) <> 'compra' then
    raise exception 'FAIL C1c: lancamento incorreto';
  end if;
  if (select payment_reference from public.reseller_credit_orders where id = v_order2) <> 'comprovante 1' then
    raise exception 'FAIL C1d: referencia nao normalizada';
  end if;
  if (select confirmed_amount from public.reseller_credit_orders where id = v_order2) <> 99.90 then
    raise exception 'FAIL C1e: valor confirmado nao registrado';
  end if;
  v_n := v_n + 1; raise notice 'PASS C1 (%/18)', v_n;

  -- C2: confirmar novamente nao duplica credito.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  select public.confirm_reseller_credit_order(v_order2, 99.90, 'repetido') into v_json;
  if not (v_json ->> 'reused')::boolean or (v_json ->> 'balance')::int <> 10 then
    raise exception 'FAIL C2: retorno inesperado %', v_json;
  end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if (select count(*) from public.reseller_credit_entries where purchase_order_id = v_order2) <> 1 then
    raise exception 'FAIL C2b: credito duplicado';
  end if;
  v_n := v_n + 1; raise notice 'PASS C2 (%/18)', v_n;

  -- C3: pedido creditado nao pode ser cancelado.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  begin
    perform public.cancel_reseller_credit_order(v_order2, 'tarde demais');
    raise exception 'FAIL C3: cancelou pedido creditado';
  exception when others then
    if sqlerrm not ilike '%Somente pedidos pendentes%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS C3 (%/18)', v_n;

  -- C4: pedido cancelado nao pode ser confirmado.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  begin
    perform public.confirm_reseller_credit_order(v_order1, 99.90, 'nao');
    raise exception 'FAIL C4: confirmou pedido cancelado';
  exception when others then
    if sqlerrm not ilike '%Somente pedidos pendentes%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS C4 (%/18)', v_n;

  -- D1: pacote inativo nao gera pedido.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  begin
    perform public.create_reseller_credit_order(v_pkg_off, v_key3);
    raise exception 'FAIL D1: comprou pacote inativo';
  exception when others then
    if sqlerrm not ilike '%Pacote indisponivel%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS D1 (%/18)', v_n;

  -- D2: alterar o pacote depois nao muda o pedido (snapshot imutavel).
  update public.reseller_credit_packages
  set name = 'Pacote Renomeado', price = 1.00
  where id = v_pkg_on;
  if (select package_name from public.reseller_credit_orders where id = v_order2) <> 'Pacote Ativo'
     or (select amount from public.reseller_credit_orders where id = v_order2) <> 99.90
     or (select package_snapshot ->> 'price' from public.reseller_credit_orders where id = v_order2)::numeric <> 99.90 then
    raise exception 'FAIL D2: snapshot do pedido mudou';
  end if;
  v_n := v_n + 1; raise notice 'PASS D2 (%/18)', v_n;

  -- D3: nem o Master escreve direto no ledger.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  begin
    insert into public.reseller_credit_entries (reseller_id, kind, amount)
    values (v_reseller1, 'compra', 100);
    raise exception 'FAIL D3: insert direto no ledger passou';
  exception when insufficient_privilege then
    null;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS D3 (%/18)', v_n;

  -- D4: revendedor nao cria nem altera pacotes.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  begin
    insert into public.reseller_credit_packages (name, credits, price, currency)
    values ('Pacote Pirata', 999, 0, 'BRL');
    raise exception 'FAIL D4: revendedor criou pacote';
  exception when others then
    if sqlerrm not ilike '%row-level%' and sqlerrm not ilike '%permission%' and sqlerrm not ilike '%permiss%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS D4 (%/18)', v_n;

  -- E1: isolamento de leitura dos pedidos.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  select count(*) into v_count from public.reseller_credit_orders where reseller_id in (v_reseller1, v_reseller2);
  if v_count <> 2 then raise exception 'FAIL E1: revendedor leu % pedidos', v_count; end if;
  perform set_config('request.jwt.claim.sub', v_other::text, false);
  select count(*) into v_count from public.reseller_credit_orders where reseller_id in (v_reseller1, v_reseller2);
  if v_count <> 0 then raise exception 'FAIL E1b: outro leu % pedidos', v_count; end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  select count(*) into v_count from public.reseller_credit_orders where reseller_id in (v_reseller1, v_reseller2);
  if v_count <> 2 then raise exception 'FAIL E1c: admin leu % pedidos', v_count; end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS E1 (%/18)', v_n;

  -- E2: saldo e extrato respeitam o isolamento.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  if public.reseller_credit_balance(null) <> 10 then
    raise exception 'FAIL E2: saldo proprio incorreto';
  end if;
  perform set_config('request.jwt.claim.sub', v_other::text, false);
  select count(*) into v_count from public.reseller_credit_entries;
  if v_count <> 0 then raise exception 'FAIL E2b: outro leu % lancamentos', v_count; end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS E2 (%/18)', v_n;

  -- Cleanup
  delete from public.reseller_credit_entries where reseller_id in (v_reseller1, v_reseller2);
  delete from public.reseller_credit_orders where reseller_id in (v_reseller1, v_reseller2);
  delete from public.reseller_credit_packages where id in (v_pkg_on, v_pkg_off);
  delete from public.reseller_activations where reseller_id in (v_reseller1, v_reseller2);
  delete from public.reseller_clients where reseller_id in (v_reseller1, v_reseller2);
  delete from public.resellers where id in (v_reseller1, v_reseller2);
  delete from public.reseller_invites where id in (v_invite1, v_invite2);
  delete from public.profiles where id in (v_admin, v_user, v_other);
  delete from auth.users where id in (v_admin, v_user, v_other);
  raise notice 'ALL PASS (18/18)';
end;
$$;

rollback;
