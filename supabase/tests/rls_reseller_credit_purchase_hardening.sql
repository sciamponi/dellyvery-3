-- Compra de creditos da revenda: referencia/valor obrigatorios, rejeicao,
-- expiracao, uma pendencia por revendedor e auditoria.
-- Execucao local (apos 20261118000000_dellyvery3_reseller_credit_purchase_hardening.sql):
--   Get-Content -Raw supabase/tests/rls_reseller_credit_purchase_hardening.sql | docker exec -i supabase_db_dellyvery-3 psql -U postgres -d postgres -v ON_ERROR_STOP=1
-- Falha: RAISE EXCEPTION. Sucesso: NOTICE "PASS H<n> (<n>/10)".

begin;

do $$
declare
  v_admin      uuid := '66666666-6666-4666-8666-666666666603';
  v_user       uuid := '77777777-7777-4777-8777-777777777703';
  v_other      uuid := '88888888-8888-4888-8888-888888888803';
  v_invite1    uuid := '99999999-9999-4999-8999-999999999905';
  v_invite2    uuid := '99999999-9999-4999-8999-999999999906';
  v_pkg        uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03';
  v_reseller   uuid;
  v_key1       uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb04';
  v_key2       uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb05';
  v_key3       uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb06';
  v_order_rej  uuid;
  v_order_exp  uuid;
  v_order_ok   uuid;
  v_json       jsonb;
  v_count      int;
  v_n          int := 0;
begin
  delete from public.reseller_credit_entries
    where reseller_id in (select id from public.resellers where user_id in (v_admin, v_user, v_other));
  delete from public.reseller_credit_orders
    where reseller_id in (select id from public.resellers where user_id in (v_admin, v_user, v_other))
       or package_id = v_pkg;
  delete from public.reseller_credit_packages where id = v_pkg;
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
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rch_admin@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rch_user@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rch_other@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', '')
  on conflict (id) do nothing;

  insert into public.profiles (id, email, name, platform_role) values
    (v_admin, 'rch_admin@test.local', 'Credit Hardening Admin', 'PLATFORM_ADMIN'),
    (v_user, 'rch_user@test.local', 'Credit Hardening User', 'USER'),
    (v_other, 'rch_other@test.local', 'Credit Hardening Other', 'USER')
  on conflict (id) do update set platform_role = excluded.platform_role;

  insert into public.reseller_invites (id, token, name, phone, status, registration, decided_at) values
    (v_invite1, 'ccccccccccccccccccccccccccccccc3', 'Credit Hardening User', '5511990000311', 'aprovado',
     '{"email":"rch_user@test.local","phone":"5511990000311"}'::jsonb, now()),
    (v_invite2, 'ccccccccccccccccccccccccccccccc4', 'Credit Hardening Other', '5511990000312', 'aprovado',
     '{"email":"rch_other@test.local","phone":"5511990000312"}'::jsonb, now());

  insert into public.resellers (user_id, invite_id, status, approved_by)
  values (v_user, v_invite1, 'ativo', v_admin)
  returning id into v_reseller;

  insert into public.resellers (user_id, invite_id, status, approved_by)
  values (v_other, v_invite2, 'ativo', v_admin);

  insert into public.reseller_credit_packages
    (id, name, description, credits, price, currency, active, sort_order, created_by)
  values
    (v_pkg, 'Pacote Hardening', 'Dez creditos', 10, 99.90, 'BRL', true, 1, v_admin);

  -- H1: revendedor nao altera a validade dos pedidos.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  begin
    perform public.set_credit_order_expiry_days(1);
    raise exception 'FAIL H1: revendedor alterou a validade';
  exception when others then
    if sqlerrm not ilike '%Apenas PLATFORM_ADMIN%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS H1 (%/10)', v_n;

  -- H2: Master configura validade e a acao e auditada.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  begin
    perform public.set_credit_order_expiry_days(0);
    raise exception 'FAIL H2: aceitou zero dias';
  exception when others then
    if sqlerrm not ilike '%maior que zero%' then raise; end if;
  end;
  select (public.set_credit_order_expiry_days(1)).credit_order_expiry_days into v_count;
  if v_count <> 1 then
    raise exception 'FAIL H2b: validade nao atualizada %', v_count;
  end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  select count(*) into v_count from public.audit_logs
  where action = 'credit_order_expiry_days_updated' and user_id = v_admin;
  if v_count < 1 then raise exception 'FAIL H2c: alteracao de validade sem auditoria'; end if;
  v_n := v_n + 1; raise notice 'PASS H2 (%/10)', v_n;

  -- H3: pedido pendente recebe prazo e impede outro pendente.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  select public.create_reseller_credit_order(v_pkg, v_key1) into v_json;
  v_order_rej := (v_json ->> 'order_id')::uuid;
  if (v_json ->> 'status') <> 'pendente' or (v_json ->> 'pending_expires_at') is null then
    raise exception 'FAIL H3: pedido sem prazo %', v_json;
  end if;
  begin
    perform public.create_reseller_credit_order(v_pkg, v_key2);
    raise exception 'FAIL H3b: criou segundo pedido pendente';
  exception when others then
    if sqlerrm not ilike '%Ja existe um pedido pendente%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS H3 (%/10)', v_n;

  -- H4: referencia de pagamento e obrigatoria.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  begin
    perform public.confirm_reseller_credit_order(v_order_rej, 99.90, '   ');
    raise exception 'FAIL H4: confirmou sem referencia';
  exception when others then
    if sqlerrm not ilike '%Referencia de pagamento obrigatoria%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS H4 (%/10)', v_n;

  -- H5: valor confirmado e obrigatorio.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  begin
    perform public.confirm_reseller_credit_order(v_order_rej, null, 'ref');
    raise exception 'FAIL H5: confirmou sem valor';
  exception when others then
    if sqlerrm not ilike '%Valor confirmado obrigatorio%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS H5 (%/10)', v_n;

  -- H6: divergencia de valor bloqueia sem lancar credito.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  begin
    perform public.confirm_reseller_credit_order(v_order_rej, 1.00, 'ref');
    raise exception 'FAIL H6: confirmou valor divergente';
  exception when others then
    if sqlerrm not ilike '%Valor confirmado divergente%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if exists (select 1 from public.reseller_credit_entries where purchase_order_id = v_order_rej) then
    raise exception 'FAIL H6b: divergencia gerou lancamento';
  end if;
  v_n := v_n + 1; raise notice 'PASS H6 (%/10)', v_n;

  -- H7: rejeicao exige Master e motivo, preserva pedido e audita.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  begin
    perform public.reject_reseller_credit_order(v_order_rej, 'invasao');
    raise exception 'FAIL H7: revendedor rejeitou pedido';
  exception when others then
    if sqlerrm not ilike '%Sem permissao%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  begin
    perform public.reject_reseller_credit_order(v_order_rej, '   ');
    raise exception 'FAIL H7b: rejeitou sem motivo';
  exception when others then
    if sqlerrm not ilike '%Motivo da rejeicao obrigatorio%' then raise; end if;
  end;
  select public.reject_reseller_credit_order(v_order_rej, '  comprovante ilegivel  ') into v_json;
  if (v_json ->> 'status') <> 'rejeitado' or (v_json ->> 'rejection_reason') <> 'comprovante ilegivel' then
    raise exception 'FAIL H7c: rejeicao inesperada %', v_json;
  end if;
  select public.reject_reseller_credit_order(v_order_rej, 'repetido') into v_json;
  if not (v_json ->> 'reused')::boolean then
    raise exception 'FAIL H7d: replay da rejeicao nao foi idempotente %', v_json;
  end if;
  begin
    perform public.confirm_reseller_credit_order(v_order_rej, 99.90, 'ref');
    raise exception 'FAIL H7e: confirmou pedido rejeitado';
  exception when others then
    if sqlerrm not ilike '%Somente pedidos pendentes%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if exists (select 1 from public.reseller_credit_entries where purchase_order_id = v_order_rej) then
    raise exception 'FAIL H7f: rejeicao gerou lancamento';
  end if;
  select count(*) into v_count from public.audit_logs
  where action = 'reseller_credit_order_rejected' and entity_id = v_order_rej;
  if v_count < 1 then raise exception 'FAIL H7g: rejeicao sem auditoria'; end if;
  v_n := v_n + 1; raise notice 'PASS H7 (%/10)', v_n;

  -- H8: pedido vencido expira, audita e nao pode ser confirmado/rejeitado.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  select public.create_reseller_credit_order(v_pkg, v_key2) into v_json;
  v_order_exp := (v_json ->> 'order_id')::uuid;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  update public.reseller_credit_orders
  set pending_expires_at = now() - interval '1 minute'
  where id = v_order_exp;
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  select public.expire_reseller_credit_orders() into v_count;
  if v_count < 1 then raise exception 'FAIL H8: expiracao nao processou pedido'; end if;
  select public.confirm_reseller_credit_order(v_order_exp, 99.90, 'ref') into v_json;
  if (v_json ->> 'status') <> 'expirado' or not (v_json ->> 'expired')::boolean then
    raise exception 'FAIL H8b: confirmacao de expirado inesperada %', v_json;
  end if;
  select public.reject_reseller_credit_order(v_order_exp, 'motivo') into v_json;
  if (v_json ->> 'status') <> 'expirado' or not (v_json ->> 'expired')::boolean then
    raise exception 'FAIL H8c: rejeicao de expirado inesperada %', v_json;
  end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if (select status from public.reseller_credit_orders where id = v_order_exp) <> 'expirado'
     or (select expired_at from public.reseller_credit_orders where id = v_order_exp) is null then
    raise exception 'FAIL H8d: pedido nao foi marcado como expirado';
  end if;
  if exists (select 1 from public.reseller_credit_entries where purchase_order_id = v_order_exp) then
    raise exception 'FAIL H8e: expiracao gerou lancamento';
  end if;
  select count(*) into v_count from public.audit_logs
  where action = 'reseller_credit_order_expired' and entity_id = v_order_exp;
  if v_count < 1 then raise exception 'FAIL H8f: expiracao sem auditoria'; end if;
  v_n := v_n + 1; raise notice 'PASS H8 (%/10)', v_n;

  -- H9: confirmacao valida grava valor/referencia e replay nao duplica ledger.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  select public.create_reseller_credit_order(v_pkg, v_key3) into v_json;
  v_order_ok := (v_json ->> 'order_id')::uuid;
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  select public.confirm_reseller_credit_order(v_order_ok, 99.90, '  comprovante ok  ') into v_json;
  if (v_json ->> 'status') <> 'creditado' or (v_json ->> 'balance')::int <> 10 then
    raise exception 'FAIL H9: confirmacao inesperada %', v_json;
  end if;
  select public.confirm_reseller_credit_order(v_order_ok, 99.90, 'repetido') into v_json;
  if not (v_json ->> 'reused')::boolean or (v_json ->> 'balance')::int <> 10 then
    raise exception 'FAIL H9b: replay inesperado %', v_json;
  end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if (select confirmed_amount from public.reseller_credit_orders where id = v_order_ok) <> 99.90
     or (select payment_reference from public.reseller_credit_orders where id = v_order_ok) <> 'comprovante ok' then
    raise exception 'FAIL H9c: valor/referencia nao preservados';
  end if;
  select count(*) into v_count from public.reseller_credit_entries where purchase_order_id = v_order_ok;
  if v_count <> 1 then raise exception 'FAIL H9d: ledger duplicado'; end if;
  v_n := v_n + 1; raise notice 'PASS H9 (%/10)', v_n;

  -- H10: pedido creditado nao pode ser rejeitado.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  begin
    perform public.reject_reseller_credit_order(v_order_ok, 'tarde demais');
    raise exception 'FAIL H10: rejeitou pedido creditado';
  exception when others then
    if sqlerrm not ilike '%Somente pedidos pendentes%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS H10 (%/10)', v_n;

  delete from public.audit_logs
  where user_id in (v_admin, v_user, v_other)
     or entity_id in (v_order_rej, v_order_exp, v_order_ok);
  delete from public.reseller_credit_entries
    where reseller_id in (select id from public.resellers where user_id in (v_admin, v_user, v_other));
  delete from public.reseller_credit_orders
    where reseller_id in (select id from public.resellers where user_id in (v_admin, v_user, v_other));
  delete from public.reseller_credit_packages where id = v_pkg;
  delete from public.reseller_activations
    where reseller_id in (select id from public.resellers where user_id in (v_admin, v_user, v_other));
  delete from public.reseller_clients
    where reseller_id in (select id from public.resellers where user_id in (v_admin, v_user, v_other));
  delete from public.resellers where user_id in (v_admin, v_user, v_other);
  delete from public.reseller_invites where id in (v_invite1, v_invite2);
  delete from public.profiles where id in (v_admin, v_user, v_other);
  delete from auth.users where id in (v_admin, v_user, v_other);

  raise notice 'ALL PASS (10/10)';
end;
$$;

rollback;
