-- Compra de plano com Pix: snapshot, idempotencia, confirmacao manual,
-- rejeicao, expiracao, RLS/ACL e protecao dos dados Pix.
-- Execucao local (apos 20261120000000_plan_purchase_pix, 20261121000000_platform_pix_qr_storage e 20261122000000_plan_purchase_pix_display_reseller):
--   Get-Content -Raw supabase/tests/rls_plan_purchase_pix.sql | docker exec -i supabase_db_dellyvery-3 psql -U postgres -d postgres -v ON_ERROR_STOP=1
-- Falha: RAISE EXCEPTION. Sucesso: NOTICE "PASS P<n> (<n>/18)".

begin;

do $$
declare
  v_admin             uuid := 'd1111111-1111-4111-8111-111111111111';
  v_owner             uuid := 'd2222222-2222-4222-8222-222222222222';
  v_attendant         uuid := 'd3333333-3333-4333-8333-333333333333';
  v_owner2            uuid := 'd4444444-4444-4444-8444-444444444444';
  v_reseller_owner    uuid := 'd5555555-5555-4555-8555-555555555555';
  v_reseller_user     uuid := 'd6666666-6666-4666-8666-666666666666';

  v_free_plan         uuid := 'd8111111-1111-4111-8111-111111111111';
  v_paid_plan         uuid := 'd8222222-2222-4222-8222-222222222222';
  v_noaccess_plan     uuid := 'd8333333-3333-4333-8333-333333333333';
  v_inactive_plan     uuid := 'd8444444-4444-4444-8444-444444444444';

  v_company_a         uuid := 'd9111111-1111-4111-8111-111111111111';
  v_company_b         uuid := 'd9222222-2222-4222-8222-222222222222';
  v_company_reseller  uuid := 'd9333333-3333-4333-8333-333333333333';

  v_key_a1            uuid := 'e1111111-1111-4111-8111-111111111111';
  v_key_a2            uuid := 'e2222222-2222-4222-8222-222222222222';
  v_key_b1            uuid := 'e3333333-3333-4333-8333-333333333333';
  v_key_b2            uuid := 'e4444444-4444-4444-8444-444444444444';
  v_key_b3            uuid := 'e5555555-5555-4555-8555-555555555555';
  v_key_b4            uuid := 'e6666666-6666-4666-8666-666666666666';
  v_key_b5            uuid := 'e7777777-7777-4777-8777-777777777777';
  v_key_b6            uuid := 'e9999999-9999-4999-8999-999999999999';
  v_key_reseller      uuid := 'e8888888-8888-4888-8888-888888888888';

  v_pix_key           text := 'test-pix-key-secret-123';
  v_qr_url_a          text := 'https://test.supabase.co/storage/v1/object/public/platform-assets/pix-qr/qr-a.png';
  v_qr_url_b          text := 'https://test.supabase.co/storage/v1/object/public/platform-assets/pix-qr/qr-b.png';
  v_req_a             uuid;
  v_req_b             uuid;
  v_reseller_id       uuid;
  v_json              jsonb;
  v_json2             jsonb;
  v_status            text;
  v_sub               public.subscriptions%rowtype;
  v_original_expires  timestamptz;
  v_new_expires       timestamptz;
  v_count             int;
  v_n                 int := 0;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    is_super_admin, confirmation_token, recovery_token
  ) values
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pp_admin@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pp_owner@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_attendant, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pp_attendant@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_owner2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pp_owner2@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_reseller_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pp_reseller_owner@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_reseller_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pp_reseller_user@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', '')
  on conflict (id) do nothing;

  insert into public.profiles (id, email, name, platform_role) values
    (v_admin, 'pp_admin@test.local', 'Pix Purchase Admin', 'PLATFORM_ADMIN'),
    (v_owner, 'pp_owner@test.local', 'Pix Purchase Owner', 'USER'),
    (v_attendant, 'pp_attendant@test.local', 'Pix Purchase Attendant', 'USER'),
    (v_owner2, 'pp_owner2@test.local', 'Pix Purchase Owner 2', 'USER'),
    (v_reseller_owner, 'pp_reseller_owner@test.local', 'Pix Purchase Reseller Owner', 'USER'),
    (v_reseller_user, 'pp_reseller_user@test.local', 'Pix Purchase Reseller', 'USER')
  on conflict (id) do update set platform_role = excluded.platform_role;

  insert into public.plans
    (id, name, slug, price, billing_cycle, features, limits, active, sort_order, access_days, is_free)
  values
    (v_free_plan, 'Plano Gratuito Pix Teste', 'plano-gratuito-pix-teste', 0, 'monthly', '[]'::jsonb, '{}'::jsonb, true, 1, null, true),
    (v_paid_plan, 'Plano Pago Pix Teste', 'plano-pago-pix-teste', 99.90, 'monthly', '[]'::jsonb, '{}'::jsonb, true, 2, 30, false),
    (v_noaccess_plan, 'Plano Sem Duracao Pix', 'plano-sem-duracao-pix', 49.90, 'monthly', '[]'::jsonb, '{}'::jsonb, true, 3, null, false),
    (v_inactive_plan, 'Plano Inativo Pix', 'plano-inativo-pix', 39.90, 'monthly', '[]'::jsonb, '{}'::jsonb, false, 4, 30, false);

  insert into public.companies (id, name, slug) values
    (v_company_a, 'Empresa Pix A', 'empresa-pix-a'),
    (v_company_b, 'Empresa Pix B', 'empresa-pix-b'),
    (v_company_reseller, 'Empresa Pix Revenda', 'empresa-pix-revenda');

  insert into public.company_members (company_id, user_id, role, active) values
    (v_company_a, v_owner, 'OWNER', true),
    (v_company_a, v_attendant, 'ATTENDANT', true),
    (v_company_b, v_owner2, 'OWNER', true),
    (v_company_reseller, v_reseller_owner, 'OWNER', true);

  insert into public.subscriptions (company_id, plan_id, status, started_at, expires_at) values
    (v_company_a, v_free_plan, 'trial', now(), now() + interval '7 days'),
    (v_company_b, v_free_plan, 'trial', now(), now() + interval '7 days'),
    (v_company_reseller, v_free_plan, 'trial', now(), now() + interval '7 days');

  insert into public.resellers (user_id, status, approved_by)
  values (v_reseller_user, 'ativo', v_admin)
  returning id into v_reseller_id;

  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  insert into public.reseller_clients (reseller_id, company_id, name, user_id, status)
  values (v_reseller_id, v_company_reseller, 'Cliente da Revenda Pix', v_reseller_owner, 'ativo');
  perform set_config('request.jwt.claim.sub', '', false);

  select expires_at into v_original_expires
  from public.subscriptions where company_id = v_company_a;

  -- P1: somente Master configura validade/Pix; versao, QR e auditoria sem segredo.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_owner::text, false);
  begin
    perform public.set_plan_purchase_expiry_days(2);
    raise exception 'FAIL P1: OWNER alterou validade';
  exception when others then
    if sqlerrm not ilike '%Apenas PLATFORM_ADMIN%' then raise; end if;
  end;
  begin
    perform public.set_platform_pix_settings(false, 'email', v_pix_key, null, v_qr_url_a, null, null);
    raise exception 'FAIL P1b: OWNER alterou Pix';
  exception when others then
    if sqlerrm not ilike '%Sem permissao%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  select (public.set_plan_purchase_expiry_days(1)).plan_purchase_expiry_days into v_count;
  if v_count <> 1 then raise exception 'FAIL P1c: validade nao atualizada %', v_count; end if;
  select public.set_platform_pix_settings(
    true, 'email', v_pix_key, 'Dellyvery Teste', v_qr_url_a, 'test-payload', 'Pague e informe a referencia'
  ) into v_json;
  if (v_json ->> 'version')::int < 2 then raise exception 'FAIL P1d: versao Pix nao incrementou %', v_json; end if;
  if (v_json ->> 'qr_image_path') <> 'pix-qr/qr-a.png' then
    raise exception 'FAIL P1e: caminho do QR inesperado %', v_json;
  end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';

  select count(*) into v_count from storage.buckets
  where id = 'platform-assets' and public and file_size_limit = 8388608;
  if v_count <> 1 then raise exception 'FAIL P1f: bucket platform-assets incorreto'; end if;
  select count(*) into v_count from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname in (
      'Public read platform assets', 'Platform admin write platform assets',
      'Platform admin update platform assets', 'Platform admin delete platform assets'
    );
  if v_count <> 4 then raise exception 'FAIL P1g: policies do platform-assets ausentes'; end if;
  select count(*) into v_count from public.audit_logs
  where action = 'plan_purchase_expiry_days_updated' and user_id = v_admin;
  if v_count < 1 then raise exception 'FAIL P1h: validade sem auditoria'; end if;
  select count(*) into v_count from public.audit_logs
  where action = 'platform_pix_settings_updated' and user_id = v_admin;
  if v_count < 1 then raise exception 'FAIL P1i: Pix sem auditoria'; end if;
  select count(*) into v_count from public.audit_logs
  where user_id = v_admin and metadata::text ilike '%' || v_pix_key || '%';
  if v_count <> 0 then raise exception 'FAIL P1j: chave Pix vazou na auditoria'; end if;
  select count(*) into v_count from public.audit_logs
  where user_id = v_admin and metadata::text ilike '%test-payload%';
  if v_count <> 0 then raise exception 'FAIL P1k: payload Pix vazou na auditoria'; end if;
  v_n := v_n + 1; raise notice 'PASS P1 (%/18)', v_n;

  -- P2: membro comum e anon nao criam solicitacao.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_attendant::text, false);
  begin
    perform public.create_plan_purchase_request(v_company_a, v_paid_plan, v_key_a1);
    raise exception 'FAIL P2: ATTENDANT criou solicitacao';
  exception when others then
    if sqlerrm not ilike '%Apenas OWNER ou ADMIN%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  execute 'set role anon';
  begin
    perform public.create_plan_purchase_request(v_company_a, v_paid_plan, v_key_a1);
    raise exception 'FAIL P2b: anon criou solicitacao';
  exception when insufficient_privilege then
    null;
  end;
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS P2 (%/18)', v_n;

  -- P3: OWNER cria pendente com snapshot, sem alterar assinatura.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_owner::text, false);
  select public.create_plan_purchase_request(v_company_a, v_paid_plan, v_key_a1) into v_json;
  v_req_a := (v_json ->> 'request_id')::uuid;
  if (v_json ->> 'status') <> 'pendente' then raise exception 'FAIL P3: status inesperado %', v_json; end if;
  if (v_json ->> 'price')::numeric <> 99.90 or (v_json ->> 'access_days')::int <> 30 then
    raise exception 'FAIL P3b: snapshot inesperado %', v_json;
  end if;
  if (v_json ->> 'pending_expires_at') is null then raise exception 'FAIL P3c: sem prazo'; end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  select * into v_sub from public.subscriptions where company_id = v_company_a;
  if v_sub.plan_id <> v_free_plan or v_sub.status <> 'trial' or v_sub.expires_at <> v_original_expires then
    raise exception 'FAIL P3d: solicitacao alterou assinatura';
  end if;
  v_n := v_n + 1; raise notice 'PASS P3 (%/18)', v_n;

  -- P4: idempotencia e uma unica pendencia por empresa.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_owner::text, false);
  select public.create_plan_purchase_request(v_company_a, v_paid_plan, v_key_a1) into v_json;
  if (v_json ->> 'request_id')::uuid <> v_req_a or not (v_json ->> 'reused')::boolean then
    raise exception 'FAIL P4: replay da criacao inesperado %', v_json;
  end if;
  select public.create_plan_purchase_request(v_company_a, v_paid_plan, v_key_a2) into v_json;
  if (v_json ->> 'request_id')::uuid <> v_req_a or not (v_json ->> 'reused')::boolean then
    raise exception 'FAIL P4b: mesma pendencia nao foi reaproveitada %', v_json;
  end if;
  begin
    perform public.create_plan_purchase_request(v_company_a, v_noaccess_plan, v_key_a2);
    raise exception 'FAIL P4c: criou pendencia para outro plano';
  exception when others then
    if sqlerrm not ilike '%Ja existe uma solicitacao pendente%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS P4 (%/18)', v_n;

  -- P5: envio de referencia exige texto e nao ativa assinatura.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_owner::text, false);
  begin
    perform public.submit_plan_purchase_payment(v_req_a, '   ', null, null);
    raise exception 'FAIL P5: aceitou referencia vazia';
  exception when others then
    if sqlerrm not ilike '%Referencia de pagamento obrigatoria%' then raise; end if;
  end;
  select public.submit_plan_purchase_payment(v_req_a, '  pix 123  ', null, '  Maria  ') into v_json;
  if (v_json ->> 'status') <> 'pendente' or (v_json ->> 'payment_reference') <> 'pix 123' then
    raise exception 'FAIL P5b: envio inesperado %', v_json;
  end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  select * into v_sub from public.subscriptions where company_id = v_company_a;
  if v_sub.plan_id <> v_free_plan or v_sub.status <> 'trial' then
    raise exception 'FAIL P5c: envio ativou assinatura';
  end if;
  v_n := v_n + 1; raise notice 'PASS P5 (%/18)', v_n;

  -- P6: instrucoes Pix so para OWNER/ADMIN da empresa e sem vazar na listagem.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_owner::text, false);
  select public.get_plan_purchase_pix_instructions(v_req_a) into v_json;
  if not (v_json ->> 'available')::boolean or (v_json ->> 'pix_key') <> v_pix_key then
    raise exception 'FAIL P6: instrucoes indisponiveis %', v_json;
  end if;
  if (v_json ->> 'qr_image_url') <> v_qr_url_a then
    raise exception 'FAIL P6b: QR nao exibido %', v_json;
  end if;
  if (v_json ->> 'qr_image_path') <> 'pix-qr/qr-a.png' then
    raise exception 'FAIL P6c: caminho do QR inesperado %', v_json;
  end if;
  select public.get_my_plan_purchase_requests(v_company_a) into v_json2;
  if v_json2::text ilike '%' || v_pix_key || '%' then
    raise exception 'FAIL P6d: chave Pix vazou no historico';
  end if;
  perform set_config('request.jwt.claim.sub', v_owner2::text, false);
  begin
    perform public.get_plan_purchase_pix_instructions(v_req_a);
    raise exception 'FAIL P6e: outra empresa leu instrucoes';
  exception when others then
    if sqlerrm not ilike '%Sem permissao%' then raise; end if;
  end;
  begin
    perform public.get_my_plan_purchase_requests(v_company_a);
    raise exception 'FAIL P6f: outra empresa leu historico';
  exception when others then
    if sqlerrm not ilike '%Sem permissao%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS P6 (%/18)', v_n;

  -- P7: escrita direta nas tabelas de compra/Pix e negada ao cliente.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_owner::text, false);
  begin
    insert into public.plan_purchase_requests (company_id, requested_by, plan_id, plan_name_snapshot, plan_slug_snapshot, price_snapshot, billing_cycle_snapshot, access_days_snapshot, idempotency_key)
    values (v_company_a, v_owner, v_paid_plan, 'X', 'x', 1, 'monthly', 1, gen_random_uuid());
    raise exception 'FAIL P7: insert direto permitido';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.plan_purchase_requests set status = 'confirmada' where id = v_req_a;
    raise exception 'FAIL P7b: update direto permitido';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.plan_purchase_requests where id = v_req_a;
    raise exception 'FAIL P7c: delete direto permitido';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.plan_purchase_events (request_id, event_type, to_status)
    values (v_req_a, 'created', 'pendente');
    raise exception 'FAIL P7d: insert de evento permitido';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.platform_pix_settings where id = true;
    raise exception 'FAIL P7e: leitura direta do Pix permitida';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.platform_settings set plan_purchase_expiry_days = 99 where id = true;
    raise exception 'FAIL P7f: update direto de settings permitido';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS P7 (%/18)', v_n;

  -- P8: fila e confirmacao sao exclusivas do Master.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_owner::text, false);
  begin
    perform public.list_plan_purchase_requests('pendente');
    raise exception 'FAIL P8: OWNER listou fila Master';
  exception when others then
    if sqlerrm not ilike '%Sem permissao%' then raise; end if;
  end;
  begin
    perform public.confirm_plan_purchase_request(v_req_a, 99.90, 'pix 123', null);
    raise exception 'FAIL P8b: OWNER confirmou pagamento';
  exception when others then
    if sqlerrm not ilike '%Sem permissao%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  select public.list_plan_purchase_requests('pendente') into v_json;
  if jsonb_array_length(v_json) < 1 then raise exception 'FAIL P8c: fila Master vazia'; end if;
  begin
    perform public.list_plan_purchase_requests('invalido');
    raise exception 'FAIL P8d: status invalido aceito';
  exception when others then
    if sqlerrm not ilike '%Status invalido%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS P8 (%/18)', v_n;

  -- P9: valor e referencia sao obrigatorios e divergencia bloqueia.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  begin
    perform public.confirm_plan_purchase_request(v_req_a, 99.90, '   ', null);
    raise exception 'FAIL P9: confirmou sem referencia';
  exception when others then
    if sqlerrm not ilike '%Referencia de pagamento obrigatoria%' then raise; end if;
  end;
  begin
    perform public.confirm_plan_purchase_request(v_req_a, 1.00, 'pix 123', null);
    raise exception 'FAIL P9b: confirmou valor divergente';
  exception when others then
    if sqlerrm not ilike '%Valor confirmado divergente%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  select * into v_sub from public.subscriptions where company_id = v_company_a;
  if v_sub.plan_id <> v_free_plan or v_sub.status <> 'trial' then
    raise exception 'FAIL P9c: validacao ativou assinatura';
  end if;
  v_n := v_n + 1; raise notice 'PASS P9 (%/18)', v_n;

  -- P10: confirmacao ativa uma vez, replay nao estende e auditoria/evento existem.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  select public.confirm_plan_purchase_request(v_req_a, 99.90, 'pix 123', 'conferido') into v_json;
  if (v_json ->> 'status') <> 'confirmada' or (v_json ->> 'reused')::boolean then
    raise exception 'FAIL P10: confirmacao inesperada %', v_json;
  end if;
  v_new_expires := (v_json ->> 'expires_at')::timestamptz;
  select public.confirm_plan_purchase_request(v_req_a, 99.90, 'pix 123', 'conferido') into v_json2;
  if not (v_json2 ->> 'reused')::boolean or (v_json2 ->> 'expires_at')::timestamptz <> v_new_expires then
    raise exception 'FAIL P10b: replay estendeu ou nao foi idempotente %', v_json2;
  end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  select * into v_sub from public.subscriptions where company_id = v_company_a;
  if v_sub.plan_id <> v_paid_plan or v_sub.status <> 'ativo' or v_sub.canceled_at is not null then
    raise exception 'FAIL P10c: assinatura nao ativada corretamente';
  end if;
  if v_sub.expires_at <> v_new_expires then raise exception 'FAIL P10d: expires_at divergente'; end if;
  if v_sub.expires_at < v_original_expires + interval '29 days' then
    raise exception 'FAIL P10e: prazo de acesso nao estendido';
  end if;
  select count(*) into v_count from public.plan_purchase_events
  where request_id = v_req_a and event_type = 'confirmed';
  if v_count <> 1 then raise exception 'FAIL P10f: evento confirmado duplicado/ausente'; end if;
  select count(*) into v_count from public.audit_logs
  where action = 'plan_purchase_confirmed' and entity_id = v_req_a;
  if v_count < 1 then raise exception 'FAIL P10g: confirmacao sem auditoria'; end if;
  v_n := v_n + 1; raise notice 'PASS P10 (%/18)', v_n;

  -- P11: rejeicao exige motivo, nao ativa e e idempotente.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_owner2::text, false);
  select public.create_plan_purchase_request(v_company_b, v_paid_plan, v_key_b1) into v_json;
  v_req_b := (v_json ->> 'request_id')::uuid;
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  begin
    perform public.reject_plan_purchase_request(v_req_b, '   ');
    raise exception 'FAIL P11: rejeitou sem motivo';
  exception when others then
    if sqlerrm not ilike '%Motivo da rejeicao obrigatorio%' then raise; end if;
  end;
  select public.reject_plan_purchase_request(v_req_b, '  comprovante ilegivel  ') into v_json;
  if (v_json ->> 'status') <> 'rejeitada' then raise exception 'FAIL P11b: rejeicao inesperada %', v_json; end if;
  select public.reject_plan_purchase_request(v_req_b, 'repetido') into v_json;
  if not (v_json ->> 'reused')::boolean then raise exception 'FAIL P11c: replay da rejeicao nao idempotente'; end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  select * into v_sub from public.subscriptions where company_id = v_company_b;
  if v_sub.plan_id <> v_free_plan or v_sub.status <> 'trial' then
    raise exception 'FAIL P11d: rejeicao ativou assinatura';
  end if;
  select count(*) into v_count from public.plan_purchase_events
  where request_id = v_req_b and event_type = 'rejected';
  if v_count <> 1 then raise exception 'FAIL P11e: evento de rejeicao ausente/duplicado'; end if;
  select count(*) into v_count from public.audit_logs
  where action = 'plan_purchase_rejected' and entity_id = v_req_b;
  if v_count < 1 then raise exception 'FAIL P11f: rejeicao sem auditoria'; end if;
  v_n := v_n + 1; raise notice 'PASS P11 (%/18)', v_n;

  -- P12: expiracao lazy nao ativa e confirmacao de expirada nao estende.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_owner2::text, false);
  select public.create_plan_purchase_request(v_company_b, v_paid_plan, v_key_b2) into v_json;
  v_req_b := (v_json ->> 'request_id')::uuid;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  update public.plan_purchase_requests
  set pending_expires_at = now() - interval '1 minute'
  where id = v_req_b;
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_owner2::text, false);
  select public.get_my_plan_purchase_requests(v_company_b) into v_json;
  if not exists (
    select 1 from jsonb_array_elements(v_json) e
    where e ->> 'id' = v_req_b::text and e ->> 'status' = 'expirada'
  ) then
    raise exception 'FAIL P12: expiracao lazy nao aplicada %', v_json;
  end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  select public.confirm_plan_purchase_request(v_req_b, 99.90, 'pix expirado', null) into v_json;
  if (v_json ->> 'status') <> 'expirada' or not (v_json ->> 'expired')::boolean then
    raise exception 'FAIL P12b: confirmacao de expirada inesperada %', v_json;
  end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  select * into v_sub from public.subscriptions where company_id = v_company_b;
  if v_sub.plan_id <> v_free_plan or v_sub.status <> 'trial' then
    raise exception 'FAIL P12c: expiracao ativou assinatura';
  end if;
  select count(*) into v_count from public.audit_logs
  where action = 'plan_purchase_expired' and entity_id = v_req_b;
  if v_count < 1 then raise exception 'FAIL P12d: expiracao sem auditoria'; end if;
  v_n := v_n + 1; raise notice 'PASS P12 (%/18)', v_n;

  -- P13: plano gratuito, sem access_days ou inativo nao gera compra.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_owner2::text, false);
  begin
    perform public.create_plan_purchase_request(v_company_b, v_free_plan, v_key_b3);
    raise exception 'FAIL P13: plano gratuito gerou compra';
  exception when others then
    if sqlerrm not ilike '%Plano gratuito nao gera compra%' then raise; end if;
  end;
  begin
    perform public.create_plan_purchase_request(v_company_b, v_noaccess_plan, v_key_b4);
    raise exception 'FAIL P13b: plano sem access_days gerou compra';
  exception when others then
    if sqlerrm not ilike '%sem duracao de acesso%' then raise; end if;
  end;
  begin
    perform public.create_plan_purchase_request(v_company_b, v_inactive_plan, v_key_b5);
    raise exception 'FAIL P13c: plano inativo gerou compra';
  exception when others then
    if sqlerrm not ilike '%Plano indisponivel%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS P13 (%/18)', v_n;

  -- P14: empresa gerenciada por revendedor nao compra direto.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_reseller_owner::text, false);
  begin
    perform public.create_plan_purchase_request(v_company_reseller, v_paid_plan, v_key_reseller);
    raise exception 'FAIL P14: empresa de revenda comprou direto';
  exception when others then
    if sqlerrm not ilike '%gerenciada pelo revendedor%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS P14 (%/18)', v_n;

  -- P15: manage_subscription continua bloqueando upgrade pago.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_owner::text, false);
  begin
    perform public.manage_subscription('upgrade', v_paid_plan);
    raise exception 'FAIL P15: upgrade pago passou';
  exception when others then
    if sqlerrm not ilike '%e pago%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS P15 (%/18)', v_n;

  -- P16: Master substitui o QR preservando a chave; URL externa e recusada.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  select public.set_platform_pix_settings(
    true, 'email', v_pix_key, 'Dellyvery Teste', v_qr_url_b, 'test-payload', 'Pague e informe a referencia'
  ) into v_json;
  if (v_json ->> 'qr_image_path') <> 'pix-qr/qr-b.png' then
    raise exception 'FAIL P16: novo QR nao salvo %', v_json;
  end if;
  if (v_json ->> 'previous_qr_image_path') <> 'pix-qr/qr-a.png' then
    raise exception 'FAIL P16b: QR anterior nao retornado %', v_json;
  end if;
  if (v_json ->> 'pix_key') <> v_pix_key then
    raise exception 'FAIL P16c: substituicao perdeu a chave %', v_json;
  end if;
  begin
    perform public.set_platform_pix_settings(
      true, 'email', v_pix_key, 'Dellyvery Teste', 'https://evil.example/qr.png', null, null
    );
    raise exception 'FAIL P16d: aceitou QR externo';
  exception when others then
    if sqlerrm not ilike '%armazenamento do sistema%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  select count(*) into v_count from public.audit_logs
  where action = 'platform_pix_settings_updated'
    and user_id = v_admin and coalesce((metadata ->> 'qr_image_replaced')::boolean, false);
  if v_count < 1 then raise exception 'FAIL P16e: substituicao do QR sem auditoria'; end if;
  v_n := v_n + 1; raise notice 'PASS P16 (%/18)', v_n;

  -- P17: desativar o Pix oculta chave/QR sem cancelar a solicitacao pendente.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_owner2::text, false);
  select public.create_plan_purchase_request(v_company_b, v_paid_plan, v_key_b6) into v_json;
  v_req_b := (v_json ->> 'request_id')::uuid;
  if (v_json ->> 'status') <> 'pendente' then
    raise exception 'FAIL P17: solicitacao nao ficou pendente %', v_json;
  end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  select public.set_platform_pix_settings(
    false, 'email', v_pix_key, 'Dellyvery Teste', v_qr_url_b, 'test-payload', 'Pague e informe a referencia'
  ) into v_json;
  if (v_json ->> 'active')::boolean then
    raise exception 'FAIL P17b: Pix nao foi desativado %', v_json;
  end if;
  perform set_config('request.jwt.claim.sub', v_owner2::text, false);
  select public.get_plan_purchase_pix_instructions(v_req_b) into v_json;
  if (v_json ->> 'available')::boolean then
    raise exception 'FAIL P17c: instrucoes disponiveis com Pix inativo %', v_json;
  end if;
  if (v_json ->> 'pix_key') is not null or (v_json ->> 'qr_image_url') is not null or (v_json ->> 'qr_image_path') is not null then
    raise exception 'FAIL P17d: dados Pix expostos com configuracao inativa %', v_json;
  end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  select status into v_status from public.plan_purchase_requests where id = v_req_b;
  if v_status <> 'pendente' then
    raise exception 'FAIL P17e: desativar Pix cancelou a solicitacao %', v_status;
  end if;
  select * into v_sub from public.subscriptions where company_id = v_company_b;
  if v_sub.plan_id <> v_free_plan or v_sub.status <> 'trial' then
    raise exception 'FAIL P17f: desativar Pix ativou assinatura';
  end if;
  v_n := v_n + 1; raise notice 'PASS P17 (%/18)', v_n;

  -- P18: fila Master exibe revendedor vinculado a empresa.
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  insert into public.reseller_clients (reseller_id, company_id, name, user_id, status)
  values (v_reseller_id, v_company_b, 'Cliente B da Revenda', v_owner2, 'ativo')
  on conflict do nothing;
  perform set_config('request.jwt.claim.sub', '', false);

  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  select public.list_plan_purchase_requests('todas') into v_json;
  if not exists (
    select 1 from jsonb_array_elements(v_json) e
    where e ->> 'id' = v_req_b::text
      and e ->> 'reseller_id' = v_reseller_id::text
      and e ->> 'reseller_name' = 'Pix Purchase Reseller'
      and e ->> 'reseller_email' = 'pp_reseller_user@test.local'
      and e ->> 'reseller_client_status' = 'ativo'
  ) then
    raise exception 'FAIL P18: revendedor ausente na fila %', v_json;
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_json) e
    where e ->> 'id' = v_req_a::text
      and (e ->> 'reseller_id') is not null
  ) then
    raise exception 'FAIL P18b: empresa sem revendedor recebeu vinculo';
  end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS P18 (%/18)', v_n;

  raise notice 'ALL PASS (18/18)';
end;
$$;

rollback;
