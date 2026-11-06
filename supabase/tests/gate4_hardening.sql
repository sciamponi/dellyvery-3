-- Testes locais das correcoes do Gate 4 (20261123000000).
-- Execucao:
--   Get-Content -Raw supabase/migrations/20261123000000_dellyvery3_gate4_hardening.sql |
--     docker exec -i supabase_db_dellyvery-3 psql -U postgres -d postgres -v ON_ERROR_STOP=1
--   Get-Content -Raw supabase/tests/gate4_hardening.sql |
--     docker exec -i supabase_db_dellyvery-3 psql -U postgres -d postgres -v ON_ERROR_STOP=1

begin;

do $test$
declare
  v_admin uuid := 'fa000001-0000-4000-8000-000000000001';
  v_owner_a uuid := 'fa000002-0000-4000-8000-000000000002';
  v_owner_b uuid := 'fa000003-0000-4000-8000-000000000003';
  v_outsider uuid := 'fa000004-0000-4000-8000-000000000004';
  v_reseller_a uuid := 'fa000005-0000-4000-8000-000000000005';
  v_reseller_b uuid := 'fa000006-0000-4000-8000-000000000006';
  v_rejected_user uuid := 'fa000007-0000-4000-8000-000000000007';

  v_plan uuid := 'fb000001-0000-4000-8000-000000000001';
  v_package uuid := 'fb000002-0000-4000-8000-000000000002';

  v_company_a uuid := 'fc000001-0000-4000-8000-000000000001';
  v_company_b uuid := 'fc000002-0000-4000-8000-000000000002';
  v_company_c uuid := 'fc000003-0000-4000-8000-000000000003';
  v_company_d uuid := 'fc000004-0000-4000-8000-000000000004';
  v_company_e uuid := 'fc000005-0000-4000-8000-000000000005';
  v_company_f uuid := 'fc000006-0000-4000-8000-000000000006';

  v_reseller_a_id uuid;
  v_reseller_b_id uuid;
  v_json jsonb;
  v_status text;
  v_count int;
  v_version int;
  v_n int := 0;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    is_super_admin, confirmation_token, recovery_token
  ) values
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'g4_admin@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'g4_owner_a@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'g4_owner_b@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_outsider, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'g4_outsider@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_reseller_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'g4_reseller_a@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_reseller_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'g4_reseller_b@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_rejected_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'g4_rejected@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', '')
  on conflict (id) do nothing;

  insert into public.profiles (id, email, name, platform_role) values
    (v_admin, 'g4_admin@test.local', 'Gate4 Admin', 'PLATFORM_ADMIN'),
    (v_owner_a, 'g4_owner_a@test.local', 'Gate4 Owner A', 'USER'),
    (v_owner_b, 'g4_owner_b@test.local', 'Gate4 Owner B', 'USER'),
    (v_outsider, 'g4_outsider@test.local', 'Gate4 Outsider', 'USER'),
    (v_reseller_a, 'g4_reseller_a@test.local', 'Gate4 Reseller A', 'USER'),
    (v_reseller_b, 'g4_reseller_b@test.local', 'Gate4 Reseller B', 'USER'),
    (v_rejected_user, 'g4_rejected@test.local', 'Gate4 Rejected', 'USER')
  on conflict (id) do update set platform_role = excluded.platform_role;

  insert into public.plans
    (id, name, slug, price, billing_cycle, features, limits, active, sort_order, access_days, is_free)
  values
    (v_plan, 'Plano Gate4', 'plano-gate4', 99.90, 'monthly', '[]'::jsonb, '{}'::jsonb, true, 1, 30, false);

  insert into public.reseller_credit_packages
    (id, name, credits, price, active, sort_order)
  values
    (v_package, 'Pacote Gate4', 5, 100.00, true, 1);

  insert into public.companies (id, name, slug) values
    (v_company_a, 'Gate4 Empresa A', 'gate4-empresa-a'),
    (v_company_b, 'Gate4 Empresa B', 'gate4-empresa-b'),
    (v_company_c, 'Gate4 Empresa C', 'gate4-empresa-c'),
    (v_company_d, 'Gate4 Empresa D', 'gate4-empresa-d'),
    (v_company_e, 'Gate4 Empresa E', 'gate4-empresa-e'),
    (v_company_f, 'Gate4 Empresa F', 'gate4-empresa-f');

  insert into public.company_members (company_id, user_id, role, active) values
    (v_company_a, v_owner_a, 'OWNER', true),
    (v_company_b, v_owner_b, 'OWNER', true);

  insert into public.resellers (user_id, status, approved_by)
  values (v_reseller_a, 'ativo', v_admin)
  returning id into v_reseller_a_id;

  insert into public.resellers (user_id, status, approved_by)
  values (v_reseller_b, 'ativo', v_admin)
  returning id into v_reseller_b_id;

  insert into public.plan_purchase_requests (
    company_id, requested_by, plan_id, plan_name_snapshot, plan_slug_snapshot,
    price_snapshot, currency_snapshot, billing_cycle_snapshot, access_days_snapshot,
    is_free_snapshot, status, payment_method, idempotency_key, pending_expires_at
  ) values
    (v_company_a, v_owner_a, v_plan, 'Plano Gate4', 'plano-gate4', 99.90, 'BRL', 'monthly', 30, false, 'pendente', 'pix', 'fd000001-0000-4000-8000-000000000001', now() - interval '1 hour'),
    (v_company_b, v_owner_b, v_plan, 'Plano Gate4', 'plano-gate4', 99.90, 'BRL', 'monthly', 30, false, 'pendente', 'pix', 'fd000001-0000-4000-8000-000000000002', now() - interval '1 hour');

  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_outsider::text, false);
  select public.expire_plan_purchase_requests() into v_count;
  if v_count <> 0 then raise exception 'FAIL G1: outsider expirou planos: %', v_count; end if;
  perform set_config('request.jwt.claim.sub', v_owner_a::text, false);
  select public.expire_plan_purchase_requests() into v_count;
  if v_count <> 1 then raise exception 'FAIL G2: owner A expirou % planos', v_count; end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';

  select status into v_status from public.plan_purchase_requests where company_id = v_company_a;
  if v_status <> 'expirada' then raise exception 'FAIL G3: plano A nao expirou: %', v_status; end if;
  select status into v_status from public.plan_purchase_requests where company_id = v_company_b;
  if v_status <> 'pendente' then raise exception 'FAIL G4: owner A expirou plano B: %', v_status; end if;

  update public.plan_purchase_requests
  set status = 'pendente', expired_at = null,
      pending_expires_at = now() - interval '1 hour'
  where company_id in (v_company_a, v_company_b);

  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  select public.expire_plan_purchase_requests() into v_count;
  if v_count < 2 then raise exception 'FAIL G5: admin expirou % planos', v_count; end if;
  if (select count(*) from public.plan_purchase_requests
      where company_id in (v_company_a, v_company_b) and status = 'expirada') <> 2 then
    raise exception 'FAIL G5b: admin nao expirou os dois planos do teste';
  end if;
  perform set_config('request.jwt.claim.sub', '', false);
  begin
    perform public.expire_plan_purchase_requests();
    raise exception 'FAIL G6: funcao de planos aceitou chamada sem JWT';
  exception when others then
    if sqlerrm not ilike '%not authenticated%' then raise; end if;
  end;
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS G1 (%/10): expiracao de planos escopada por empresa', v_n;

  insert into public.reseller_credit_orders (
    reseller_id, package_id, package_name, credits, amount, currency,
    status, idempotency_key, pending_expires_at
  ) values
    (v_reseller_a_id, v_package, 'Pacote Gate4', 5, 100.00, 'BRL', 'pendente', 'fe000001-0000-4000-8000-000000000001', now() - interval '1 hour'),
    (v_reseller_b_id, v_package, 'Pacote Gate4', 5, 100.00, 'BRL', 'pendente', 'fe000001-0000-4000-8000-000000000002', now() - interval '1 hour');

  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_outsider::text, false);
  select public.expire_reseller_credit_orders() into v_count;
  if v_count <> 0 then raise exception 'FAIL G7: outsider expirou creditos: %', v_count; end if;
  perform set_config('request.jwt.claim.sub', v_reseller_a::text, false);
  select public.expire_reseller_credit_orders() into v_count;
  if v_count <> 1 then raise exception 'FAIL G8: reseller A expirou % pedidos', v_count; end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  select public.expire_reseller_credit_orders() into v_count;
  if v_count < 1 then raise exception 'FAIL G9: admin expirou % pedidos', v_count; end if;
  if (select status from public.reseller_credit_orders where reseller_id = v_reseller_b_id) <> 'expirado' then
    raise exception 'FAIL G9b: admin nao expirou o pedido da revenda B';
  end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS G2 (%/10): expiracao de creditos escopada por revenda', v_n;

  begin
    insert into public.plan_purchase_requests (
      company_id, requested_by, plan_id, plan_name_snapshot, plan_slug_snapshot,
      price_snapshot, currency_snapshot, billing_cycle_snapshot, access_days_snapshot,
      is_free_snapshot, status, payment_method, payment_reference, idempotency_key, pending_expires_at
    ) values (
      v_company_c, v_owner_a, v_plan, 'Plano Gate4', 'plano-gate4', 99.90, 'BRL', 'monthly', 30,
      false, 'pendente', 'pix', 'DUP-PLAN', 'fd000002-0000-4000-8000-000000000001', now() + interval '1 day'
    );
    insert into public.plan_purchase_requests (
      company_id, requested_by, plan_id, plan_name_snapshot, plan_slug_snapshot,
      price_snapshot, currency_snapshot, billing_cycle_snapshot, access_days_snapshot,
      is_free_snapshot, status, payment_method, payment_reference, idempotency_key, pending_expires_at
    ) values (
      v_company_d, v_owner_a, v_plan, 'Plano Gate4', 'plano-gate4', 99.90, 'BRL', 'monthly', 30,
      false, 'pendente', 'pix', 'dup-plan', 'fd000002-0000-4000-8000-000000000002', now() + interval '1 day'
    );
    raise exception 'FAIL G10: referencia duplicada aceita';
  exception when unique_violation then
    null;
  end;
  v_n := v_n + 1; raise notice 'PASS G3 (%/10): payment_reference unica por tabela', v_n;

  insert into public.plan_purchase_requests (
    company_id, requested_by, plan_id, plan_name_snapshot, plan_slug_snapshot,
    price_snapshot, currency_snapshot, billing_cycle_snapshot, access_days_snapshot,
    is_free_snapshot, status, payment_method, payment_reference,
    confirmed_amount, confirmed_currency, confirmed_by, confirmed_at, activated_at,
    idempotency_key
  ) values (
    v_company_e, v_owner_a, v_plan, 'Plano Gate4', 'plano-gate4', 99.90, 'BRL', 'monthly', 30,
    false, 'confirmada', 'pix', 'CROSS-REF', 99.90, 'BRL', v_admin, now(), now(),
    'fd000003-0000-4000-8000-000000000001'
  );

  begin
    insert into public.reseller_credit_orders (
      reseller_id, package_id, package_name, credits, amount, currency,
      status, payment_reference, confirmed_amount, paid_at, credited_at, idempotency_key
    ) values (
      v_reseller_a_id, v_package, 'Pacote Gate4', 5, 100.00, 'BRL',
      'creditado', 'cross-ref', 100.00, now(), now(), 'fe000002-0000-4000-8000-000000000001'
    );
    raise exception 'FAIL G11: mesma referencia confirmada em plano e credito';
  exception when unique_violation then
    null;
  end;

  select count(*) into v_count
  from dellyvery_private.payment_reference_claims
  where reference_normalized = 'cross-ref';
  if v_count <> 1 then raise exception 'FAIL G12: registry cross-table inconsistente %', v_count; end if;
  v_n := v_n + 1; raise notice 'PASS G4 (%/10): referencia confirmada nao atravessa plano/credito', v_n;

  insert into public.plan_purchase_requests (
    company_id, requested_by, plan_id, plan_name_snapshot, plan_slug_snapshot,
    price_snapshot, currency_snapshot, billing_cycle_snapshot, access_days_snapshot,
    is_free_snapshot, status, payment_method, payment_reference,
    rejected_by, rejected_at, reason, idempotency_key
  ) values (
    v_company_f, v_owner_a, v_plan, 'Plano Gate4', 'plano-gate4', 99.90, 'BRL', 'monthly', 30,
    false, 'rejeitada', 'pix', '', v_rejected_user, now(), 'motivo do teste',
    'fd000004-0000-4000-8000-000000000001'
  );

  if (
    select confdeltype from pg_constraint
    where conname = 'plan_purchase_requests_rejected_by_fkey'
      and conrelid = 'public.plan_purchase_requests'::regclass
  ) is distinct from 'r' then
    raise exception 'FAIL G13: FK rejected_by de plano nao e RESTRICT';
  end if;

  if (
    select confdeltype from pg_constraint
    where conname = 'reseller_credit_orders_rejected_by_fkey'
      and conrelid = 'public.reseller_credit_orders'::regclass
  ) is distinct from 'r' then
    raise exception 'FAIL G14: FK rejected_by de credito nao e RESTRICT';
  end if;

  begin
    delete from public.profiles where id = v_rejected_user;
    raise exception 'FAIL G15: delete de profile rejeitado passou';
  exception when foreign_key_violation then
    null;
  end;
  v_n := v_n + 1; raise notice 'PASS G5 (%/10): rejected_by usa ON DELETE RESTRICT', v_n;

  begin
    insert into public.plan_purchase_requests (
      company_id, requested_by, plan_id, plan_name_snapshot, plan_slug_snapshot,
      price_snapshot, currency_snapshot, billing_cycle_snapshot, access_days_snapshot,
      is_free_snapshot, status, payment_method, proof_url, idempotency_key, pending_expires_at
    ) values (
      v_company_f, v_owner_a, v_plan, 'Plano Gate4', 'plano-gate4', 99.90, 'BRL', 'monthly', 30,
      false, 'pendente', 'pix', 'ftp://invalid.example/proof.pdf', 'fd000005-0000-4000-8000-000000000001', now() + interval '1 day'
    );
    raise exception 'FAIL G16: proof_url invalida aceita';
  exception when check_violation then
    null;
  end;
  v_n := v_n + 1; raise notice 'PASS G6 (%/10): proof_url exige http/https', v_n;

  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  select public.set_platform_pix_settings(
    true, 'email', 'gate4-key', 'Gate4 Receiver',
    'https://test.supabase.co/storage/v1/object/public/platform-assets/pix-qr/gate4.png',
    'gate4-payload', 'gate4-instructions'
  ) into v_json;
  v_version := (v_json ->> 'version')::int;

  select public.set_platform_pix_settings(p_receiver_name => 'Gate4 Receiver 2') into v_json;
  if (v_json ->> 'receiver_name') <> 'Gate4 Receiver 2' then
    raise exception 'FAIL G17: receiver parcial nao atualizado %', v_json;
  end if;
  if (v_json ->> 'pix_key') <> 'gate4-key'
     or (v_json ->> 'qr_image_path') <> 'pix-qr/gate4.png'
     or (v_json ->> 'active')::boolean is not true then
    raise exception 'FAIL G18: atualizacao parcial apagou campos %', v_json;
  end if;
  if (v_json ->> 'version')::int <> v_version + 1 then
    raise exception 'FAIL G19: versao parcial inesperada %', v_json;
  end if;

  select public.patch_platform_pix_settings(
    jsonb_build_object('qr_payload', null, 'instructions', 'gate4-instructions-2')
  ) into v_json;
  if (v_json ->> 'qr_payload') is not null then
    raise exception 'FAIL G20: patch nao limpou qr_payload %', v_json;
  end if;
  if (v_json ->> 'instructions') <> 'gate4-instructions-2'
     or (v_json ->> 'pix_key') <> 'gate4-key'
     or (v_json ->> 'qr_image_path') <> 'pix-qr/gate4.png' then
    raise exception 'FAIL G21: patch parcial perdeu campos %', v_json;
  end if;
  perform set_config('request.jwt.claim.sub', v_owner_a::text, false);
  begin
    perform public.patch_platform_pix_settings('{"instructions":"x"}'::jsonb);
    raise exception 'FAIL G22: nao-admin alterou Pix';
  exception when others then
    if sqlerrm not ilike '%Sem permissao%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  begin
    perform public.set_platform_pix_settings(
      true, 'email', 'gate4-key', 'Gate4 Receiver',
      'https://evil.example/qr.png', null, null
    );
    raise exception 'FAIL G23: QR externo aceito';
  exception when others then
    if sqlerrm not ilike '%armazenamento do sistema%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS G7 (%/10): set_platform_pix_settings preserva campos omitidos', v_n;

  select count(*) into v_count
  from pg_indexes
  where schemaname = 'public'
    and indexname in (
      'uq_plan_purchase_requests_payment_reference_norm',
      'uq_reseller_credit_orders_payment_reference_norm'
    );
  if v_count <> 2 then raise exception 'FAIL G24: indices de referencia ausentes'; end if;
  v_n := v_n + 1; raise notice 'PASS G8 (%/10): indices unicos normalizados presentes', v_n;

  select count(*) into v_count
  from pg_event_trigger
  where evtname = 'dellyvery3_revoke_new_function_acl';
  if v_count > 1 then raise exception 'FAIL G25: event trigger duplicado'; end if;
  v_n := v_n + 1; raise notice 'PASS G9 (%/10): event trigger nao duplicado', v_n;

  if has_function_privilege('anon', 'public.expire_plan_purchase_requests()', 'EXECUTE')
     or has_function_privilege('anon', 'public.expire_reseller_credit_orders()', 'EXECUTE')
     or has_function_privilege('anon', 'public.patch_platform_pix_settings(jsonb)', 'EXECUTE') then
    raise exception 'FAIL G26: funcao de correcao executavel por anon';
  end if;
  if not has_function_privilege('authenticated', 'public.expire_plan_purchase_requests()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.expire_reseller_credit_orders()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.patch_platform_pix_settings(jsonb)', 'EXECUTE') then
    raise exception 'FAIL G27: authenticated perdeu EXECUTE';
  end if;
  v_n := v_n + 1; raise notice 'PASS G10 (%/10): ACL das funcoes de correcao', v_n;

  raise notice 'ALL PASS (%/10)', v_n;
end;
$test$;

rollback;
