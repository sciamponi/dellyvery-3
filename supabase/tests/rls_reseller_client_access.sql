-- Convite, ativacao e suspensao do cliente de revenda.
-- Execucao local (apos 20261109000003):
--   Get-Content -Raw supabase/tests/rls_reseller_client_access.sql | docker exec -i supabase_db_dellyvery-3 psql -U postgres -d postgres -v ON_ERROR_STOP=1
-- Transacao revertida ao final. Falha: RAISE EXCEPTION. Sucesso: NOTICE "PASS ...".

begin;

do $$
declare
  v_admin uuid := '33333333-3333-4333-8333-333333333301';
  v_reseller_user uuid := '33333333-3333-4333-8333-333333333302';
  v_other_user uuid := '33333333-3333-4333-8333-333333333303';
  v_client_user uuid := '33333333-3333-4333-8333-333333333304';
  v_auto_user uuid := '33333333-3333-4333-8333-333333333306';
  v_invite uuid := '33333333-3333-4333-8333-333333333305';
  v_reseller uuid;
  v_client uuid := '44444444-4444-4444-8444-444444444401';
  v_client2 uuid := '44444444-4444-4444-8444-444444444402';
  v_auto_client uuid := '44444444-4444-4444-8444-444444444403';
  v_expired_client uuid := '44444444-4444-4444-8444-444444444404';
  v_plan uuid;
  v_plan_old_days int;
  v_company uuid;
  v_product uuid;
  v_token text;
  v_token2 text;
  v_auto_token text;
  v_auto_invite_id uuid;
  v_expired_token text;
  v_expired_invite_id uuid;
  v_proof_id uuid;
  v_proof_expires timestamptz;
  v_invite_id uuid;
  v_invite2 public.reseller_client_invites%rowtype;
  v_json jsonb;
  v_first_expires timestamptz;
  v_renew_expires timestamptz;
  v_count int;
  v_n int := 0;
begin
  delete from public.reseller_client_invites where reseller_id in (select id from public.resellers where user_id = v_reseller_user);
  delete from public.companies where id in (select company_id from public.reseller_clients where reseller_id in (select id from public.resellers where user_id = v_reseller_user));
  delete from public.reseller_credit_entries where reseller_id in (select id from public.resellers where user_id = v_reseller_user);
  delete from public.reseller_activations where reseller_id in (select id from public.resellers where user_id = v_reseller_user);
  delete from public.reseller_clients where id in (v_client, v_client2, v_auto_client, v_expired_client);
  delete from public.resellers where user_id = v_reseller_user;
  delete from public.reseller_invites where id = v_invite;
  delete from public.profiles where id in (v_admin, v_reseller_user, v_other_user, v_client_user, v_auto_user);
  delete from auth.users where id in (v_admin, v_reseller_user, v_other_user, v_client_user, v_auto_user);

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, confirmation_sent_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, confirmation_token, recovery_token)
  values
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ca_admin@test.local', crypt('password', gen_salt('bf')), now(), now() - interval '1 minute', now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_reseller_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ca_reseller@test.local', crypt('password', gen_salt('bf')), now(), now() - interval '1 minute', now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_other_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ca_other@test.local', crypt('password', gen_salt('bf')), now(), now() - interval '1 minute', now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_client_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ca_client@test.local', crypt('password', gen_salt('bf')), now(), now() - interval '1 minute', now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_auto_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ca_auto@test.local', crypt('password', gen_salt('bf')), now(), null, now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', '');

  insert into public.profiles (id, email, name, platform_role) values
    (v_admin, 'ca_admin@test.local', 'CA Admin', 'PLATFORM_ADMIN'),
    (v_reseller_user, 'ca_reseller@test.local', 'CA Reseller', 'USER'),
    (v_other_user, 'ca_other@test.local', 'CA Other', 'USER'),
    (v_client_user, 'ca_client@test.local', 'CA Client', 'USER'),
    (v_auto_user, 'ca_auto@test.local', 'CA Auto', 'USER')
  on conflict (id) do update set platform_role = excluded.platform_role;

  insert into public.reseller_invites (id, token, name, phone, status, registration, decided_at)
  values (v_invite, 'ccccccccccccccccccccccccccccccc1', 'CA Reseller', '5511990000301', 'aprovado',
          '{"email":"ca_reseller@test.local","phone":"5511990000301"}'::jsonb, now());
  insert into public.resellers (user_id, invite_id, status, approved_by)
  values (v_reseller_user, v_invite, 'ativo', v_admin) returning id into v_reseller;

  -- Fixture: desabilita a guarda apenas para semear clientes prospectos.
  alter table public.reseller_clients disable trigger trg_reseller_client_guard;
  execute 'set role service_role';
  insert into public.reseller_clients (id, reseller_id, name, trade_name, email, phone, status, created_by)
  values
    (v_client, v_reseller, 'Cliente Convite', 'Cantina Convite', 'ca_client@test.local', '5511990000302', 'prospecto', v_admin),
    (v_client2, v_reseller, 'Cliente Revogado', 'Cantina Revogada', 'ca_client2@test.local', '5511990000303', 'prospecto', v_admin),
    (v_auto_client, v_reseller, 'Cliente Auto', 'Cantina Auto', 'ca_auto@test.local', '5511990000304', 'prospecto', v_admin),
    (v_expired_client, v_reseller, 'Cliente Expirado', 'Cantina Expirada', 'ca_other@test.local', '5511990000305', 'prospecto', v_admin);
  execute 'reset role';
  alter table public.reseller_clients enable trigger trg_reseller_client_guard;

  select id, access_days into v_plan, v_plan_old_days from public.plans where active = true order by created_at limit 1;
  if v_plan is null then raise exception 'FAIL setup: nenhum plano ativo'; end if;
  update public.plans set access_days = 30 where id = v_plan;

  -- 1) Convite e resolvido publicamente, com token em hash.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_reseller_user::text, false);
  select public.create_reseller_client_invite(v_client) into v_json;
  v_token := v_json ->> 'token';
  v_invite_id := (v_json ->> 'invite_id')::uuid;
  if length(v_token) <> 48 then raise exception 'FAIL 1: token inesperado %', v_token; end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if not exists (
    select 1 from public.reseller_client_invites
    where id = v_invite_id and token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
  ) then
    raise exception 'FAIL 1b: token nao foi armazenado em hash';
  end if;
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_reseller_user::text, false);
  begin
    select count(*) into v_count from public.reseller_client_invites;
    raise exception 'FAIL 1c: revendedor leu a tabela de convites';
  exception when insufficient_privilege then
    null;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS 1 (%/25)', v_n;

  -- 2) Resolve publico nao expoe hash e retorna pending.
  execute 'set role anon';
  select public.resolve_reseller_client_invite(v_token) into v_json;
  execute 'reset role';
  if v_json ->> 'status' <> 'pending' or v_json ->> 'invited_email' <> 'ca_client@test.local' then
    raise exception 'FAIL 2: resolve inesperado %', v_json;
  end if;
  if v_json ? 'token_hash' or v_json ? 'token' then
    raise exception 'FAIL 2b: resolve expoe token/hash';
  end if;
  if v_json ? 'client_id' then
    raise exception 'FAIL 2c: resolve expoe client_id interno';
  end if;
  v_n := v_n + 1; raise notice 'PASS 2 (%/25)', v_n;

  -- 3) Revogacao invalida o link.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_reseller_user::text, false);
  select public.create_reseller_client_invite(v_client2) into v_json;
  v_token2 := v_json ->> 'token';
  perform public.revoke_reseller_client_invite((v_json ->> 'invite_id')::uuid);
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  execute 'set role anon';
  select public.resolve_reseller_client_invite(v_token2) into v_json;
  execute 'reset role';
  if v_json ->> 'status' <> 'revoked' then raise exception 'FAIL 3: convite revogado ainda resolve %', v_json; end if;
  v_n := v_n + 1; raise notice 'PASS 3 (%/25)', v_n;

  -- 4) Conta com e-mail diferente nao aceita o convite.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_other_user::text, false);
  begin
    perform public.claim_reseller_client_invite(v_token);
    raise exception 'FAIL 4: outro e-mail aceitou o convite';
  exception when others then
    if sqlerrm not ilike '%e-mail que recebeu o convite%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if (select user_id from public.reseller_clients where id = v_client) is not null then
    raise exception 'FAIL 4b: vinculo criado por e-mail errado';
  end if;
  v_n := v_n + 1; raise notice 'PASS 4 (%/25)', v_n;

  -- 5) Cliente correto, com prova dedicada, aceita e pode repetir a operacao.
  select public.record_reseller_invite_email_proof(
    v_invite_id, v_client_user, 'ca_client@test.local', 900
  ) into v_json;
  v_proof_id := (v_json ->> 'proof_id')::uuid;
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_client_user::text, false);
  select public.claim_reseller_client_invite(v_token) into v_json;
  if (v_json ->> 'status') <> 'accepted' or (v_json ->> 'reused')::boolean then
    raise exception 'FAIL 5: claim inesperado %', v_json;
  end if;
  select public.claim_reseller_client_invite(v_token) into v_json;
  if not (v_json ->> 'reused')::boolean then raise exception 'FAIL 5b: claim nao foi idempotente'; end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  select count(*) into v_count from public.reseller_client_invites where reseller_id = v_reseller;
  if v_count <> 2 then raise exception 'FAIL 5c: convites inesperados %', v_count; end if;
  if (select user_id from public.reseller_clients where id = v_client) <> v_client_user then
    raise exception 'FAIL 5d: user_id nao vinculado';
  end if;
  if (select status from public.reseller_clients where id = v_client) = 'ativo' then
    raise exception 'FAIL 5e: aceitar convite ativou o acesso';
  end if;
  if (select consumed_at from public.reseller_invite_email_proofs where id = v_proof_id) is null then
    raise exception 'FAIL 5f: prova de e-mail nao foi consumida';
  end if;
  v_n := v_n + 1; raise notice 'PASS 5 (%/25)', v_n;

  -- 6) Antes da ativacao o cliente esta pendente e sem empresa.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_client_user::text, false);
  select public.get_my_reseller_client_access() into v_json;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if v_json ->> 'status' <> 'pending' or (v_json ->> 'company_id') is not null then
    raise exception 'FAIL 6: estado pendente inesperado %', v_json;
  end if;
  v_n := v_n + 1; raise notice 'PASS 6 (%/25)', v_n;

  -- 7) Vinculo direto nao pode ser alterado pelo revendedor.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_reseller_user::text, false);
  begin
    update public.reseller_clients set user_id = null where id = v_client;
    raise exception 'FAIL 7: revendedor alterou user_id diretamente';
  exception when others then
    if sqlerrm not ilike '%gerenciado pela ativacao%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS 7 (%/25)', v_n;

  -- 8) Master concede 2 creditos.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  perform public.grant_reseller_credits(v_reseller, 2, 'teste convite');
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS 8 (%/25)', v_n;

  -- 9) Primeira ativacao: cria empresa/OWNER/assinatura, consome 1 credito.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_reseller_user::text, false);
  select public.activate_reseller_client_v2(v_client, v_plan, 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1') into v_json;
  v_company := (v_json ->> 'company_id')::uuid;
  v_first_expires := (v_json ->> 'new_expires_at')::timestamptz;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if v_company is null or (v_json ->> 'balance')::int <> 1 or (v_json ->> 'credits')::int <> 1 then
    raise exception 'FAIL 9: retorno inesperado %', v_json;
  end if;
  if (v_json ->> 'kind') <> 'first_activation' or (v_json ->> 'access_days')::int <> 30 then
    raise exception 'FAIL 9b: duracao/tipo inesperados %', v_json;
  end if;
  if (select count(*) from public.company_members where company_id = v_company and user_id = v_client_user and role = 'OWNER') <> 1 then
    raise exception 'FAIL 9c: OWNER nao criado';
  end if;
  if (select count(*) from public.subscriptions where company_id = v_company) <> 1 then
    raise exception 'FAIL 9d: assinatura nao criada';
  end if;
  v_n := v_n + 1; raise notice 'PASS 9 (%/25)', v_n;

  -- 10) Cliente ativo: estado e acesso.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_client_user::text, false);
  select public.get_my_reseller_client_access() into v_json;
  if v_json ->> 'status' <> 'active' or (v_json ->> 'company_id')::uuid <> v_company then
    raise exception 'FAIL 10: estado ativo inesperado %', v_json;
  end if;
  if not public.is_company_member(v_company) or not public.company_has_active_access(v_company) then
    raise exception 'FAIL 10b: gate nao liberou cliente ativo';
  end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS 10 (%/25)', v_n;

  -- 11) Renovacao soma ao vencimento atual e consome o ultimo credito.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_reseller_user::text, false);
  select public.activate_reseller_client_v2(v_client, v_plan, 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2') into v_json;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_renew_expires := (v_json ->> 'new_expires_at')::timestamptz;
  if (v_json ->> 'kind') <> 'renewal' or (v_json ->> 'balance')::int <> 0 then
    raise exception 'FAIL 11: renovacao inesperada %', v_json;
  end if;
  if (v_json ->> 'previous_expires_at')::timestamptz <> v_first_expires then
    raise exception 'FAIL 11b: renovacao nao partiu do vencimento atual';
  end if;
  if v_renew_expires <> v_first_expires + interval '30 days' then
    raise exception 'FAIL 11c: renovacao nao somou 30 dias';
  end if;
  v_n := v_n + 1; raise notice 'PASS 11 (%/25)', v_n;

  -- 12) Vencimento suspende operacao mas mantem leitura da conta.
  insert into public.products (company_id, name, price, active)
  values (v_company, 'Produto Gate', 10, true) returning id into v_product;
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_client_user::text, false);
  select count(*) into v_count from public.products where id = v_product;
  if v_count <> 1 then raise exception 'FAIL 12: cliente ativo nao leu produto'; end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  update public.subscriptions set expires_at = now() - interval '1 day', status = 'ativo' where company_id = v_company;
  -- Fixture: simula vencimento sem usar a guarda de producao.
  alter table public.reseller_clients disable trigger trg_reseller_client_guard;
  update public.reseller_clients set access_expires_at = now() - interval '1 day' where id = v_client;
  alter table public.reseller_clients enable trigger trg_reseller_client_guard;
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_client_user::text, false);
  select count(*) into v_count from public.products where id = v_product;
  if v_count <> 0 then raise exception 'FAIL 12b: cliente vencido leu produto'; end if;
  select public.get_my_reseller_client_access() into v_json;
  if v_json ->> 'status' <> 'expired' then raise exception 'FAIL 12c: estado vencido inesperado %', v_json; end if;
  if public.is_company_member(v_company) then raise exception 'FAIL 12d: is_company_member liberou vencido'; end if;
  if not public.is_company_member_raw(v_company) then raise exception 'FAIL 12e: helper raw perdeu membership'; end if;
  select count(*) into v_count from public.companies where id = v_company;
  if v_count <> 1 then raise exception 'FAIL 12f: cliente vencido nao le a propria empresa'; end if;
  select count(*) into v_count from public.subscriptions where company_id = v_company;
  if v_count <> 1 then raise exception 'FAIL 12g: cliente vencido nao le a assinatura'; end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS 12 (%/25)', v_n;

  -- 13) Cardapio publico bloqueado quando vencido.
  begin
    perform public.get_storefront_by_slug((select slug from public.companies where id = v_company));
    raise exception 'FAIL 13: cardapio vencido respondeu';
  exception when others then
    if sqlerrm not ilike '%temporariamente indispon%' then raise; end if;
  end;
  v_n := v_n + 1; raise notice 'PASS 13 (%/25)', v_n;

  -- 14) Cliente vencido nao troca assinatura.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_client_user::text, false);
  begin
    perform public.manage_subscription('upgrade', v_plan);
    raise exception 'FAIL 14: cliente de revenda alterou assinatura';
  exception when others then
    if sqlerrm not ilike '%gerenciada pelo revendedor%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS 14 (%/25)', v_n;

  -- 15) Cliente de revenda nao cria outra empresa direto.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_client_user::text, false);
  begin
    perform public.create_company_with_owner('Empresa Paralela', 'empresa-paralela-ca', null);
    raise exception 'FAIL 15: cliente de revenda criou empresa direto';
  exception when others then
    if sqlerrm not ilike '%gerenciada por um revendedor%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS 15 (%/25)', v_n;

  -- 16) Inserir pedido em empresa vencida e bloqueado pelo trigger.
  begin
    insert into public.orders (company_id, order_number, total)
    values (v_company, 1, 0);
    raise exception 'FAIL 16: pedido em empresa vencida passou';
  exception when others then
    if sqlerrm not ilike '%indisponivel%' then raise; end if;
  end;
  v_n := v_n + 1; raise notice 'PASS 16 (%/25)', v_n;

  -- 17) Lista de convites do revendedor nao vaza para anon.
  execute 'set role anon';
  begin
    perform public.list_reseller_client_invites();
    raise exception 'FAIL 17: anon listou convites';
  exception when insufficient_privilege or others then
    if sqlerrm not ilike '%permission%' and sqlerrm not ilike '%permiss%' then raise; end if;
  end;
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS 17 (%/25)', v_n;

  -- 18) RPC antiga foi removida.
  if to_regprocedure('public.activate_reseller_client(uuid,uuid,integer,date,date)') is not null then
    raise exception 'FAIL 18: RPC antiga ainda existe';
  end if;
  v_n := v_n + 1; raise notice 'PASS 18 (%/25)', v_n;

  -- 19) Conta autoconfirmada, sem prova dedicada, e recusada.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_reseller_user::text, false);
  select public.create_reseller_client_invite(v_auto_client) into v_json;
  v_auto_token := v_json ->> 'token';
  v_auto_invite_id := (v_json ->> 'invite_id')::uuid;
  perform set_config('request.jwt.claim.sub', v_auto_user::text, false);
  begin
    perform public.claim_reseller_client_invite(v_auto_token);
    raise exception 'FAIL 19: conta autoconfirmada aceitou sem prova';
  exception when others then
    if sqlerrm not ilike '%posse do e-mail%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if (select user_id from public.reseller_clients where id = v_auto_client) is not null then
    raise exception 'FAIL 19b: vinculo criado sem prova de e-mail';
  end if;
  if (select status from public.reseller_client_invites where client_id = v_auto_client) <> 'pending' then
    raise exception 'FAIL 19c: convite mudou de estado sem prova de e-mail';
  end if;
  v_n := v_n + 1; raise notice 'PASS 19 (%/25)', v_n;

  -- 20) Prova nao pode ser registrada para outro usuario ou outro e-mail.
  begin
    perform public.record_reseller_invite_email_proof(
      v_auto_invite_id, v_other_user, 'ca_auto@test.local', 900
    );
    raise exception 'FAIL 20: prova registrada para outro usuario';
  exception when others then
    if sqlerrm not ilike '%Conta nao corresponde%' then raise; end if;
  end;
  begin
    perform public.record_reseller_invite_email_proof(
      v_auto_invite_id, v_auto_user, 'ca_other@test.local', 900
    );
    raise exception 'FAIL 20b: prova registrada para outro e-mail';
  exception when others then
    if sqlerrm not ilike '%E-mail nao corresponde%' then raise; end if;
  end;
  select count(*) into v_count
  from public.reseller_invite_email_proofs
  where invite_id = v_auto_invite_id;
  if v_count <> 0 then raise exception 'FAIL 20c: prova invalida foi persistida'; end if;
  v_n := v_n + 1; raise notice 'PASS 20 (%/25)', v_n;

  -- 21) Prova expirada nao autoriza o aceite.
  select public.record_reseller_invite_email_proof(
    v_auto_invite_id, v_auto_user, 'ca_auto@test.local', 60
  ) into v_json;
  v_proof_id := (v_json ->> 'proof_id')::uuid;
  update public.reseller_invite_email_proofs
  set verified_at = now() - interval '2 minutes',
      expires_at = now() - interval '1 minute'
  where id = v_proof_id;
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_auto_user::text, false);
  begin
    perform public.claim_reseller_client_invite(v_auto_token);
    raise exception 'FAIL 21: prova expirada aceitou o convite';
  exception when others then
    if sqlerrm not ilike '%posse do e-mail%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if (select user_id from public.reseller_clients where id = v_auto_client) is not null then
    raise exception 'FAIL 21b: vinculo criado com prova expirada';
  end if;
  v_n := v_n + 1; raise notice 'PASS 21 (%/25)', v_n;

  -- 22) Prova valida e vinculada ao convite/usuario/e-mail aceita e e consumida.
  select public.record_reseller_invite_email_proof(
    v_auto_invite_id, v_auto_user, 'ca_auto@test.local', 900
  ) into v_json;
  v_proof_id := (v_json ->> 'proof_id')::uuid;
  v_proof_expires := (v_json ->> 'expires_at')::timestamptz;
  if v_proof_expires <= now() then raise exception 'FAIL 22: validade da prova invalida'; end if;
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_auto_user::text, false);
  select public.claim_reseller_client_invite(v_auto_token) into v_json;
  if (v_json ->> 'status') <> 'accepted' or (v_json ->> 'reused')::boolean then
    raise exception 'FAIL 22b: claim com prova inesperado %', v_json;
  end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if (select user_id from public.reseller_clients where id = v_auto_client) <> v_auto_user then
    raise exception 'FAIL 22c: user_id nao vinculado apos prova';
  end if;
  if (select consumed_at from public.reseller_invite_email_proofs where id = v_proof_id) is null then
    raise exception 'FAIL 22d: prova nao foi consumida';
  end if;
  v_n := v_n + 1; raise notice 'PASS 22 (%/25)', v_n;

  -- 23) Convite expirado e marcado no resolve e o claim nao desfaz a atualizacao.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_reseller_user::text, false);
  select public.create_reseller_client_invite(v_expired_client) into v_json;
  v_expired_token := v_json ->> 'token';
  v_expired_invite_id := (v_json ->> 'invite_id')::uuid;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  update public.reseller_client_invites
  set expires_at = now() - interval '1 minute'
  where id = v_expired_invite_id;
  execute 'set role anon';
  select public.resolve_reseller_client_invite(v_expired_token) into v_json;
  execute 'reset role';
  if v_json ->> 'status' <> 'expired' then
    raise exception 'FAIL 23: resolve nao retornou expirado %', v_json;
  end if;
  if (select status from public.reseller_client_invites where id = v_expired_invite_id) <> 'expired' then
    raise exception 'FAIL 23b: resolve nao persistiu o vencimento';
  end if;
  begin
    perform public.record_reseller_invite_email_proof(
      v_expired_invite_id, v_other_user, 'ca_other@test.local', 900
    );
    raise exception 'FAIL 23c: prova registrada para convite expirado';
  exception when others then
    if sqlerrm not ilike '%expirado%' then raise; end if;
  end;
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_other_user::text, false);
  begin
    perform public.claim_reseller_client_invite(v_expired_token);
    raise exception 'FAIL 23d: convite expirado aceitou';
  exception when others then
    if sqlerrm not ilike '%expirado%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if (select status from public.reseller_client_invites where id = v_expired_invite_id) <> 'expired' then
    raise exception 'FAIL 23e: claim desfez a marcaÃ§Ã£o de expirado';
  end if;
  v_n := v_n + 1; raise notice 'PASS 23 (%/25)', v_n;

  -- 24) Prova nao pode ser registrada depois que o convite foi aceito.
  begin
    perform public.record_reseller_invite_email_proof(
      v_auto_invite_id, v_auto_user, 'ca_auto@test.local', 900
    );
    raise exception 'FAIL 24: prova registrada apos aceite';
  exception when others then
    if sqlerrm not ilike '%nao esta mais disponivel%' then raise; end if;
  end;
  v_n := v_n + 1; raise notice 'PASS 24 (%/25)', v_n;

  -- 25) Tabela de provas nao e acessivel diretamente pelo cliente.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_auto_user::text, false);
  begin
    select count(*) into v_count from public.reseller_invite_email_proofs;
    raise exception 'FAIL 25: cliente leu a tabela de provas';
  exception when insufficient_privilege then
    null;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS 25 (%/25)', v_n;

  raise notice 'ALL PASS (25/25)';
end;
$$;

rollback;
