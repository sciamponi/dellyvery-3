-- Gestao do vinculo entre carteira de revenda e conta real do cliente.
-- Execucao local (apos 20261125000000):
--   Get-Content -Raw supabase/tests/rls_reseller_client_account_management.sql | docker exec -i supabase_db_dellyvery-3 psql -U postgres -d postgres -v ON_ERROR_STOP=1
-- Transacao revertida ao final. Falha: RAISE EXCEPTION. Sucesso: NOTICE "PASS ...".

begin;

do $$
declare
  v_admin uuid := '55555555-5555-4555-8555-555555555501';
  v_reseller_user uuid := '55555555-5555-4555-8555-555555555502';
  v_other_reseller_user uuid := '55555555-5555-4555-8555-555555555503';
  v_client_user uuid := '55555555-5555-4555-8555-555555555504';
  v_client2_user uuid := '55555555-5555-4555-8555-555555555505';
  v_client3_user uuid := '55555555-5555-4555-8555-555555555506';
  v_reseller_invite uuid := '55555555-5555-4555-8555-555555555511';
  v_other_invite uuid := '55555555-5555-4555-8555-555555555512';
  v_reseller uuid;
  v_other_reseller uuid;
  v_client_a uuid := '66666666-6666-4666-8666-666666666601';
  v_client_b uuid := '66666666-6666-4666-8666-666666666602';
  v_client_c uuid := '66666666-6666-4666-8666-666666666603';
  v_client_other uuid := '66666666-6666-4666-8666-666666666604';
  v_company_a uuid := '77777777-7777-4777-8777-777777777701';
  v_company_c uuid := '77777777-7777-4777-8777-777777777703';
  v_company_free uuid := '77777777-7777-4777-8777-777777777704';
  v_plan uuid;
  v_default_plan uuid;
  v_default_days int;
  v_default_slug text := 'acct-default-days-test';
  v_json jsonb;
  v_count int;
  v_bool boolean;
  v_old_expires timestamptz;
  v_new_expires timestamptz;
  v_audit int;
  v_n int := 0;
begin
  -- Limpeza de fixtures anteriores.
  delete from public.audit_logs
  where entity = 'reseller_client'
    and entity_id in (v_client_a, v_client_b, v_client_c, v_client_other);
  delete from public.reseller_client_invites
  where reseller_id in (
    select id from public.resellers
    where user_id in (v_reseller_user, v_other_reseller_user)
  );
  delete from public.subscriptions
  where company_id in (v_company_a, v_company_c, v_company_free);
  delete from public.company_members
  where company_id in (v_company_a, v_company_c, v_company_free)
     or user_id in (v_client_user, v_client2_user, v_client3_user);
  delete from public.reseller_credit_entries
  where reseller_id in (
    select id from public.resellers
    where user_id in (v_reseller_user, v_other_reseller_user)
  );
  delete from public.reseller_activations
  where reseller_id in (
    select id from public.resellers
    where user_id in (v_reseller_user, v_other_reseller_user)
  );
  delete from public.reseller_clients
  where id in (v_client_a, v_client_b, v_client_c, v_client_other);
  delete from public.companies
  where id in (v_company_a, v_company_c, v_company_free);
  delete from public.resellers
  where user_id in (v_reseller_user, v_other_reseller_user);
  delete from public.reseller_invites
  where id in (v_reseller_invite, v_other_invite);
  delete from public.plans where slug = v_default_slug;
  delete from public.profiles
  where id in (v_admin, v_reseller_user, v_other_reseller_user, v_client_user, v_client2_user, v_client3_user);
  delete from auth.users
  where id in (v_admin, v_reseller_user, v_other_reseller_user, v_client_user, v_client2_user, v_client3_user);

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    confirmation_sent_at, created_at, updated_at, raw_app_meta_data,
    raw_user_meta_data, is_super_admin, confirmation_token, recovery_token
  )
  values
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'acct_admin@test.local', crypt('password', gen_salt('bf')), now(), now() - interval '1 minute',
     now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_reseller_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'acct_reseller@test.local', crypt('password', gen_salt('bf')), now(), now() - interval '1 minute',
     now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_other_reseller_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'acct_other_reseller@test.local', crypt('password', gen_salt('bf')), now(), now() - interval '1 minute',
     now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_client_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'acct_client@test.local', crypt('password', gen_salt('bf')), now(), now() - interval '1 minute',
     now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_client2_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'acct_client2@test.local', crypt('password', gen_salt('bf')), now(), now() - interval '1 minute',
     now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_client3_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'acct_client3@test.local', crypt('password', gen_salt('bf')), now(), now() - interval '1 minute',
     now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', '');

  insert into public.profiles (id, email, name, platform_role) values
    (v_admin, 'acct_admin@test.local', 'Acct Admin', 'PLATFORM_ADMIN'),
    (v_reseller_user, 'acct_reseller@test.local', 'Acct Reseller', 'USER'),
    (v_other_reseller_user, 'acct_other_reseller@test.local', 'Acct Other Reseller', 'USER'),
    (v_client_user, 'acct_client@test.local', 'Acct Client', 'USER'),
    (v_client2_user, 'acct_client2@test.local', 'Acct Client 2', 'USER'),
    (v_client3_user, 'acct_client3@test.local', 'Acct Client 3', 'USER')
  on conflict (id) do update set platform_role = excluded.platform_role;

  insert into public.reseller_invites (id, token, name, phone, status, registration, decided_at)
  values
    (v_reseller_invite, 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeee1', 'Acct Reseller', '5511990000501',
     'aprovado', '{"email":"acct_reseller@test.local","phone":"5511990000501"}'::jsonb, now()),
    (v_other_invite, 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeee2', 'Acct Other', '5511990000502',
     'aprovado', '{"email":"acct_other_reseller@test.local","phone":"5511990000502"}'::jsonb, now());

  insert into public.resellers (user_id, invite_id, status, approved_by)
  values (v_reseller_user, v_reseller_invite, 'ativo', v_admin)
  returning id into v_reseller;

  insert into public.resellers (user_id, invite_id, status, approved_by)
  values (v_other_reseller_user, v_other_invite, 'ativo', v_admin)
  returning id into v_other_reseller;

  select id into v_plan
  from public.plans
  where active = true
  order by created_at
  limit 1;
  if v_plan is null then raise exception 'FAIL setup: nenhum plano ativo'; end if;
  update public.plans set access_days = 30 where id = v_plan;

  insert into public.companies (id, name, slug, description, phone, email, address, city, state)
  values
    (v_company_a, 'Cantina Vinculada', 'acct-company-a', 'Dados originais', '5511990000511',
     'empresa_a@test.local', 'Rua A, 1', 'Sao Paulo', 'SP'),
    (v_company_c, 'Cantina Renovavel', 'acct-company-c', 'Dados C', '5511990000513',
     'empresa_c@test.local', 'Rua C, 3', 'Campinas', 'SP'),
    (v_company_free, 'Cantina Livre', 'acct-company-free', 'Dados livres', '5511990000514',
     'empresa_free@test.local', 'Rua D, 4', 'Santos', 'SP');

  insert into public.company_members (company_id, user_id, role, active) values
    (v_company_a, v_client_user, 'OWNER', true),
    (v_company_c, v_client2_user, 'OWNER', true),
    (v_company_free, v_client3_user, 'OWNER', true);

  insert into public.subscriptions (company_id, plan_id, status, started_at, expires_at) values
    (v_company_a, v_plan, 'ativo', now() - interval '5 days', now() + interval '25 days'),
    (v_company_c, v_plan, 'ativo', now() - interval '5 days', now() + interval '10 days'),
    (v_company_free, v_plan, 'ativo', now() - interval '5 days', now() + interval '15 days');

  alter table public.reseller_clients disable trigger trg_reseller_client_guard;
  execute 'set role service_role';
  insert into public.reseller_clients (
    id, reseller_id, name, trade_name, document, email, phone, city, state,
    status, user_id, company_id, activated_at, access_expires_at, created_by
  )
  values
    (v_client_a, v_reseller, 'Cantina Vinculada', 'Cantina A', '11111111111',
     'acct_client@test.local', '5511990000511', 'Sao Paulo', 'SP', 'ativo',
     v_client_user, v_company_a, now() - interval '5 days', now() + interval '25 days', v_admin),
    (v_client_b, v_reseller, 'Cantina Sem Conta', 'Cantina B', '22222222222',
     'acct_sem_conta@test.local', '5511990000512', 'Osasco', 'SP', 'prospecto',
     null, null, null, null, v_admin),
    (v_client_c, v_reseller, 'Cantina Renovavel', 'Cantina C', '33333333333',
     'acct_client2@test.local', '5511990000513', 'Campinas', 'SP', 'ativo',
     v_client2_user, v_company_c, now() - interval '5 days', now() + interval '10 days', v_admin),
    (v_client_other, v_other_reseller, 'Cantina de Outro', 'Cantina Outro', '44444444444',
     'acct_outro@test.local', '5511990000514', 'Santos', 'SP', 'prospecto',
     null, null, null, null, v_admin);
  execute 'reset role';
  alter table public.reseller_clients enable trigger trg_reseller_client_guard;

  insert into public.reseller_client_invites (
    reseller_id, client_id, token_hash, invited_email, status, expires_at,
    accepted_by, accepted_at, created_by
  )
  values (
    v_reseller, v_client_c, repeat('a', 64), 'acct_client2@test.local', 'accepted',
    now() + interval '7 days', v_client2_user, now(), v_admin
  );

  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  perform public.grant_reseller_credits(v_reseller, 2, 'teste gestao');
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';

  -- 1) Revendedor lista apenas a propria carteira.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_reseller_user::text, false);
  select count(*) into v_count
  from public.list_reseller_client_accounts();
  if v_count <> 3 then raise exception 'FAIL 1: carteira inesperada %, esperado 3', v_count; end if;
  select count(*) into v_count
  from public.list_reseller_client_accounts()
  where reseller_id = v_other_reseller;
  if v_count <> 0 then raise exception 'FAIL 1b: vazou carteira de outro revendedor'; end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS 1 (%/25)', v_n;

  -- 2) p_reseller_id nao permite ao revendedor ler outro revendedor.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_reseller_user::text, false);
  select count(*) into v_count
  from public.list_reseller_client_accounts(v_other_reseller);
  if v_count <> 3 then raise exception 'FAIL 2: filtro externo alterou a carteira %', v_count; end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS 2 (%/25)', v_n;

  -- 3) Usuario comum (nao revendedor) nao acessa a listagem.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_client_user::text, false);
  begin
    perform public.list_reseller_client_accounts();
    raise exception 'FAIL 3: usuario comum listou carteira';
  exception when others then
    if sqlerrm not ilike '%Acesso de revenda inativo%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS 3 (%/25)', v_n;

  -- 4) A listagem nao expoe user_id nem credenciais.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_reseller_user::text, false);
  select bool_or(to_jsonb(t) ? 'user_id')
  into v_bool
  from public.list_reseller_client_accounts() t;
  if coalesce(v_bool, false) then raise exception 'FAIL 4: listagem expoe user_id'; end if;
  select count(*) into v_count
  from public.list_reseller_client_accounts()
  where account_state = 'active';
  if v_count <> 2 then raise exception 'FAIL 4b: estados ativos inesperados %', v_count; end if;
  select count(*) into v_count
  from public.list_reseller_client_accounts()
  where account_state = 'unlinked'
    and has_user = false;
  if v_count <> 1 then raise exception 'FAIL 4c: cliente sem conta inesperado %', v_count; end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS 4 (%/25)', v_n;

  -- 5) Detalhes da propria conta real.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_reseller_user::text, false);
  select public.get_reseller_client_account(v_client_a) into v_json;
  if (v_json ->> 'account_state') <> 'active' then
    raise exception 'FAIL 5: estado inesperado %', v_json;
  end if;
  if (v_json #>> '{company,id}')::uuid <> v_company_a then
    raise exception 'FAIL 5b: empresa incorreta %', v_json;
  end if;
  if (v_json #>> '{subscription,status}') <> 'ativo' then
    raise exception 'FAIL 5c: assinatura incorreta %', v_json;
  end if;
  if not (v_json #>> '{permissions,can_edit_company}')::boolean then
    raise exception 'FAIL 5d: sem permissao de edicao';
  end if;
  if (v_json -> 'activation_history') is null then
    raise exception 'FAIL 5e: historico ausente';
  end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS 5 (%/25)', v_n;

  -- 6) Detalhes de outro revendedor sao negados.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_other_reseller_user::text, false);
  begin
    perform public.get_reseller_client_account(v_client_a);
    raise exception 'FAIL 6: revendedor leu detalhes de outro';
  exception when others then
    if sqlerrm not ilike '%Cliente nao encontrado ou sem permissao%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS 6 (%/25)', v_n;

  -- 7) Master audita qualquer cliente e enxerga o estado real.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  select public.get_reseller_client_account(v_client_a) into v_json;
  if not (v_json #>> '{permissions,is_master}')::boolean then
    raise exception 'FAIL 7: Master nao reconhecido';
  end if;
  if (v_json #>> '{client,reseller_id}')::uuid <> v_reseller then
    raise exception 'FAIL 7b: reseller_id incorreto';
  end if;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS 7 (%/25)', v_n;

  -- 8) Edicao do estabelecimento atualiza a empresa e espelha na carteira.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_reseller_user::text, false);
  select public.update_reseller_client_company(
    v_client_a,
    jsonb_build_object(
      'name', 'Cantina Editada',
      'description', 'Nova descricao',
      'phone', '5511990000599',
      'email', 'editada@test.local',
      'address', 'Rua Nova, 10',
      'city', 'Sao Paulo',
      'state', 'sp',
      'zip_code', '01000-000',
      'whatsapp', '5511990000599'
    )
  ) into v_json;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if (select name from public.companies where id = v_company_a) <> 'Cantina Editada' then
    raise exception 'FAIL 8: empresa nao atualizada';
  end if;
  if (select state from public.companies where id = v_company_a) <> 'SP' then
    raise exception 'FAIL 8b: UF nao normalizada';
  end if;
  if (select name from public.reseller_clients where id = v_client_a) <> 'Cantina Editada' then
    raise exception 'FAIL 8c: carteira nao espelhada';
  end if;
  if (select email from public.reseller_clients where id = v_client_a) <> 'editada@test.local' then
    raise exception 'FAIL 8d: e-mail nao espelhado';
  end if;
  if jsonb_array_length(v_json -> 'changed_fields') <> 9 then
    raise exception 'FAIL 8e: campos alterados inesperados %', v_json;
  end if;
  v_n := v_n + 1; raise notice 'PASS 8 (%/25)', v_n;

  -- 9) Campo fora da whitelist e rejeitado.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_reseller_user::text, false);
  begin
    perform public.update_reseller_client_company(
      v_client_a, jsonb_build_object('reseller_id', v_other_reseller)
    );
    raise exception 'FAIL 9: campo indevido aceito';
  exception when others then
    if sqlerrm not ilike '%Campos nao permitidos%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS 9 (%/25)', v_n;

  -- 10) Nome vazio e e-mail invalido sao rejeitados.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_reseller_user::text, false);
  begin
    perform public.update_reseller_client_company(v_client_a, jsonb_build_object('name', '   '));
    raise exception 'FAIL 10: nome vazio aceito';
  exception when others then
    if sqlerrm not ilike '%Informe o nome%' then raise; end if;
  end;
  begin
    perform public.update_reseller_client_company(v_client_a, jsonb_build_object('email', 'invalido'));
    raise exception 'FAIL 10b: e-mail invalido aceito';
  exception when others then
    if sqlerrm not ilike '%E-mail invalido%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS 10 (%/25)', v_n;

  -- 11) Outro revendedor nao edita a empresa do cliente alheio.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_other_reseller_user::text, false);
  begin
    perform public.update_reseller_client_company(v_client_a, jsonb_build_object('name', 'Hack'));
    raise exception 'FAIL 11: outro revendedor editou';
  exception when others then
    if sqlerrm not ilike '%Cliente nao encontrado ou sem permissao%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS 11 (%/25)', v_n;

  -- 12) Cliente sem empresa vinculada nao pode ser editado como estabelecimento.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_reseller_user::text, false);
  begin
    perform public.update_reseller_client_company(v_client_b, jsonb_build_object('name', 'X'));
    raise exception 'FAIL 12: editou cliente sem empresa';
  exception when others then
    if sqlerrm not ilike '%ainda nao possui empresa vinculada%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS 12 (%/25)', v_n;

  -- 13) Suspensao mantem empresa/assinatura e bloqueia a operacao.
  select s.expires_at into v_old_expires
  from public.subscriptions s
  where s.company_id = v_company_a;

  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_reseller_user::text, false);
  select public.suspend_reseller_client(v_client_a, 'inadimplencia') into v_json;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';

  if not (v_json ->> 'suspended')::boolean or (v_json ->> 'reused')::boolean then
    raise exception 'FAIL 13: retorno inesperado %', v_json;
  end if;
  if (select status::text from public.subscriptions where company_id = v_company_a) <> 'suspenso' then
    raise exception 'FAIL 13b: assinatura nao suspensa';
  end if;
  if (select expires_at from public.subscriptions where company_id = v_company_a) <> v_old_expires then
    raise exception 'FAIL 13c: vencimento alterado na suspensao';
  end if;
  if (select status from public.reseller_clients where id = v_client_a) <> 'inativo' then
    raise exception 'FAIL 13d: carteira nao marcada inativa';
  end if;
  if (select count(*) from public.companies where id = v_company_a) <> 1 then
    raise exception 'FAIL 13e: empresa apagada';
  end if;
  if (select name from public.companies where id = v_company_a) <> 'Cantina Editada' then
    raise exception 'FAIL 13f: dados da empresa alterados';
  end if;
  if (v_json #>> '{account,account_state}') <> 'suspended' then
    raise exception 'FAIL 13g: estado suspenso inesperado %', v_json;
  end if;
  v_n := v_n + 1; raise notice 'PASS 13 (%/25)', v_n;

  -- 14) Suspensao e idempotente e nao duplica auditoria.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_reseller_user::text, false);
  select public.suspend_reseller_client(v_client_a, 'repeticao') into v_json;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if not (v_json ->> 'reused')::boolean then
    raise exception 'FAIL 14: suspensao nao foi idempotente %', v_json;
  end if;
  select count(*) into v_audit
  from public.audit_logs
  where entity = 'reseller_client'
    and entity_id = v_client_a
    and action = 'reseller_client_suspended';
  if v_audit <> 1 then raise exception 'FAIL 14b: auditoria duplicada %', v_audit; end if;
  v_n := v_n + 1; raise notice 'PASS 14 (%/25)', v_n;

  -- 15) Gate operacional bloqueia a empresa suspensa.
  if public.company_has_active_access(v_company_a) then
    raise exception 'FAIL 15: gate liberou empresa suspensa';
  end if;
  v_n := v_n + 1; raise notice 'PASS 15 (%/25)', v_n;

  -- 16) Cliente ve a conta como bloqueada.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_client_user::text, false);
  select public.get_my_reseller_client_access() into v_json;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if (v_json ->> 'status') <> 'expired' then
    raise exception 'FAIL 16: cliente nao viu bloqueio %', v_json;
  end if;
  v_n := v_n + 1; raise notice 'PASS 16 (%/25)', v_n;

  -- 17) Master suspende qualquer cliente.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  select public.suspend_reseller_client(v_client_c, 'auditoria') into v_json;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if (select status::text from public.subscriptions where company_id = v_company_c) <> 'suspenso' then
    raise exception 'FAIL 17: Master nao suspendeu';
  end if;
  v_n := v_n + 1; raise notice 'PASS 17 (%/25)', v_n;

  -- 18) Outro revendedor nao suspende cliente alheio.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_other_reseller_user::text, false);
  begin
    perform public.suspend_reseller_client(v_client_c, 'tentativa');
    raise exception 'FAIL 18: outro revendedor suspendeu';
  exception when others then
    if sqlerrm not ilike '%Cliente nao encontrado ou sem permissao%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS 18 (%/25)', v_n;

  -- 19) Auditoria registra autor e motivo.
  select count(*) into v_audit
  from public.audit_logs
  where entity = 'reseller_client'
    and entity_id = v_client_a
    and action = 'reseller_client_suspended'
    and metadata ->> 'reason' = 'inadimplencia'
    and metadata ->> 'actor_role' = 'RESELLER';
  if v_audit <> 1 then raise exception 'FAIL 19: auditoria de suspensao ausente'; end if;
  select count(*) into v_audit
  from public.audit_logs
  where entity = 'reseller_client'
    and entity_id = v_client_a
    and action = 'reseller_client_company_updated'
    and metadata ->> 'actor_role' = 'RESELLER';
  if v_audit <> 1 then raise exception 'FAIL 19b: auditoria de edicao ausente'; end if;
  v_n := v_n + 1; raise notice 'PASS 19 (%/25)', v_n;

  -- 20) Revendedor nao corrige vinculo.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_reseller_user::text, false);
  begin
    perform public.admin_relink_reseller_client(v_client_b, v_company_free, null);
    raise exception 'FAIL 20: revendedor corrigiu vinculo';
  exception when others then
    if sqlerrm not ilike '%Apenas PLATFORM_ADMIN%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS 20 (%/25)', v_n;

  -- 21) Master corrige vinculo e o usuario e derivado do OWNER ativo.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  select public.admin_relink_reseller_client(v_client_b, v_company_free, null) into v_json;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if (select user_id from public.reseller_clients where id = v_client_b) <> v_client3_user then
    raise exception 'FAIL 21: OWNER nao derivado';
  end if;
  if (select company_id from public.reseller_clients where id = v_client_b) <> v_company_free then
    raise exception 'FAIL 21b: empresa nao vinculada';
  end if;
  if (select access_expires_at from public.reseller_clients where id = v_client_b)
     <> (select expires_at from public.subscriptions where company_id = v_company_free) then
    raise exception 'FAIL 21c: vencimento do vinculo incorreto';
  end if;
  if (v_json ->> 'account_state') <> 'active' then
    raise exception 'FAIL 21d: estado apos correcao inesperado %', v_json;
  end if;
  v_n := v_n + 1; raise notice 'PASS 21 (%/25)', v_n;

  -- 22) Master nao vincula empresa de outro cliente.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  begin
    perform public.admin_relink_reseller_client(v_client_b, v_company_a, null);
    raise exception 'FAIL 22: empresa duplicada aceita';
  exception when others then
    if sqlerrm not ilike '%Empresa ja vinculada%' then raise; end if;
  end;
  v_n := v_n + 1; raise notice 'PASS 22 (%/25)', v_n;

  -- 23) Master nao vincula usuario que nao e membro da empresa.
  begin
    perform public.admin_relink_reseller_client(v_client_b, v_company_free, v_client_user);
    raise exception 'FAIL 23: usuario externo aceito';
  exception when others then
    if sqlerrm not ilike '%Usuario nao e membro ativo%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS 23 (%/25)', v_n;

  -- 24) Renovacao reativa a conta suspensa usando 1 credito e 30 dias.
  select expires_at into v_old_expires
  from public.subscriptions
  where company_id = v_company_c;

  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_reseller_user::text, false);
  select public.activate_reseller_client_v2(
    v_client_c, v_plan, 'ffffffff-ffff-4fff-8fff-fffffffffff1'
  ) into v_json;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';

  v_new_expires := (v_json ->> 'new_expires_at')::timestamptz;
  if (select status::text from public.subscriptions where company_id = v_company_c) <> 'ativo' then
    raise exception 'FAIL 24: assinatura nao reativada';
  end if;
  if (v_json ->> 'access_days')::int <> 30 then
    raise exception 'FAIL 24b: duracao diferente de 30 dias %', v_json;
  end if;
  if v_new_expires <> v_old_expires + interval '30 days' then
    raise exception 'FAIL 24c: renovacao nao somou 30 dias';
  end if;
  if (v_json ->> 'balance')::int <> 1 then
    raise exception 'FAIL 24d: credito consumido incorretamente %', v_json;
  end if;
  if (select status from public.reseller_clients where id = v_client_c) <> 'ativo' then
    raise exception 'FAIL 24e: carteira nao reativada';
  end if;
  v_n := v_n + 1; raise notice 'PASS 24 (%/25)', v_n;

  -- 25) Plano novo sem duracao recebe o padrao de 30 dias.
  insert into public.plans (slug, name, price, billing_cycle, features, limits, active, sort_order)
  values (v_default_slug, 'Acct Default', 0, 'monthly', '[]'::jsonb, '{}'::jsonb, false, 9999)
  returning id, access_days into v_default_plan, v_default_days;
  if v_default_days <> 30 then
    raise exception 'FAIL 25: duracao padrao inesperada %', v_default_days;
  end if;
  delete from public.plans where id = v_default_plan;
  v_n := v_n + 1; raise notice 'PASS 25 (%/25)', v_n;

  raise notice 'ALL PASS (25/25)';
end;
$$;

rollback;
