-- Follow-up da auditoria S0-S8: owners, search_path, grants, contexto escopado
-- e trigger de guarda.
-- Execucao local (apos 20261113000000):
--   Get-Content -Raw supabase/tests/rls_reseller_security_followup.sql |
--     docker exec -i <container> psql -U supabase_admin -d <db> -v ON_ERROR_STOP=1
-- Transacao revertida ao final. Falha: RAISE EXCEPTION.

begin;

do $$
declare
  v_bad text;
  v_owner text;
  v_config text;
  v_prosecdef boolean;
  v_def text;
  v_n int := 0;
  v_user uuid := 'b1111111-1111-4111-8111-111111111101';
  v_claim_user uuid := 'b1111111-1111-4111-8111-111111111103';
  v_invite uuid := 'b1111111-1111-4111-8111-111111111102';
  v_client uuid := 'b2222222-2222-4222-8222-222222222201';
  v_client_claim uuid := 'b2222222-2222-4222-8222-222222222202';
  v_reseller uuid;
  v_result jsonb;
begin
  -- 1) Owners e search_path deterministas.
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_bad
  from pg_proc p
  where p.oid in (
    'public.activate_reseller_client_v2(uuid,uuid,uuid)'::regprocedure,
    'public.activate_reseller_client_v2_legacy(uuid,uuid,uuid)'::regprocedure,
    'public.cancel_reseller_credit_order(uuid,text)'::regprocedure,
    'public.cancel_reseller_credit_order_legacy(uuid,text)'::regprocedure,
    'public.guard_reseller_client_write()'::regprocedure,
    'public.claim_reseller_client_invite(text)'::regprocedure,
    'public.claim_reseller_client_invite_legacy(text)'::regprocedure,
    'public.is_reseller_write_context_active(text,uuid,uuid,uuid)'::regprocedure,
    'dellyvery_private.begin_reseller_write_context(text,uuid,uuid,uuid)'::regprocedure,
    'dellyvery_private.end_reseller_write_context(text,uuid,uuid,uuid)'::regprocedure
  )
    and pg_get_userbyid(p.proowner) <> 'postgres';
  if v_bad is not null then
    raise exception 'FAIL 1: funcoes fora de postgres: %', v_bad;
  end if;
  v_n := v_n + 1; raise notice 'PASS 1 (%/23)', v_n;

  select string_agg(p.oid::regprocedure::text || '=' || coalesce(array_to_string(p.proconfig, ','), '<null>'), ', ')
    into v_bad
  from pg_proc p
  where p.oid in (
    'public.activate_reseller_client_v2(uuid,uuid,uuid)'::regprocedure,
    'public.activate_reseller_client_v2_legacy(uuid,uuid,uuid)'::regprocedure,
    'public.cancel_reseller_credit_order(uuid,text)'::regprocedure,
    'public.cancel_reseller_credit_order_legacy(uuid,text)'::regprocedure,
    'public.guard_reseller_client_write()'::regprocedure,
    'public.claim_reseller_client_invite(text)'::regprocedure,
    'public.claim_reseller_client_invite_legacy(text)'::regprocedure
  )
    and not coalesce(p.proconfig, array[]::text[]) @> array['search_path=pg_catalog, public, pg_temp'];
  if v_bad is not null then
    raise exception 'FAIL 2: search_path public incorreto: %', v_bad;
  end if;

  select string_agg(p.oid::regprocedure::text || '=' || coalesce(array_to_string(p.proconfig, ','), '<null>'), ', ')
    into v_bad
  from pg_proc p
  where p.oid in (
    'public.is_reseller_write_context_active(text,uuid,uuid,uuid)'::regprocedure,
    'dellyvery_private.begin_reseller_write_context(text,uuid,uuid,uuid)'::regprocedure,
    'dellyvery_private.end_reseller_write_context(text,uuid,uuid,uuid)'::regprocedure
  )
    and not coalesce(p.proconfig, array[]::text[]) @> array['search_path=pg_catalog, dellyvery_private, pg_temp'];
  if v_bad is not null then
    raise exception 'FAIL 2b: search_path privado incorreto: %', v_bad;
  end if;
  v_n := v_n + 1; raise notice 'PASS 2 (%/23)', v_n;

  -- 3) Guard nao e SECURITY DEFINER e as demais funcoes criticas sao.
  select p.oid::regprocedure::text || '=' || p.prosecdef::text
    into v_bad
  from pg_proc p
  where p.oid = 'public.guard_reseller_client_write()'::regprocedure
    and p.prosecdef;
  if v_bad is not null then
    raise exception 'FAIL 3: guard nao deveria ser SECURITY DEFINER: %', v_bad;
  end if;
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_bad
  from pg_proc p
  where p.oid in (
    'public.activate_reseller_client_v2(uuid,uuid,uuid)'::regprocedure,
    'public.activate_reseller_client_v2_legacy(uuid,uuid,uuid)'::regprocedure,
    'public.cancel_reseller_credit_order(uuid,text)'::regprocedure,
    'public.cancel_reseller_credit_order_legacy(uuid,text)'::regprocedure,
    'public.claim_reseller_client_invite(text)'::regprocedure,
    'public.claim_reseller_client_invite_legacy(text)'::regprocedure,
    'public.is_reseller_write_context_active(text,uuid,uuid,uuid)'::regprocedure,
    'dellyvery_private.begin_reseller_write_context(text,uuid,uuid,uuid)'::regprocedure,
    'dellyvery_private.end_reseller_write_context(text,uuid,uuid,uuid)'::regprocedure
  )
    and not p.prosecdef;
  if v_bad is not null then
    raise exception 'FAIL 3b: funcoes sem SECURITY DEFINER: %', v_bad;
  end if;
  v_n := v_n + 1; raise notice 'PASS 3 (%/23)', v_n;

  -- 4) Contratos de grants.
  if not has_function_privilege('authenticated', 'public.activate_reseller_client_v2(uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.activate_reseller_client_v2(uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.activate_reseller_client_v2(uuid,uuid,uuid)', 'EXECUTE') then
    raise exception 'FAIL 4: grants de activate_reseller_client_v2 incorretos';
  end if;
  -- O grant historico de service_role e preservado, mas nao e usado como
  -- autorizacao pelo corpo da funcao.
  if not has_function_privilege('authenticated', 'public.cancel_reseller_credit_order(uuid,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.cancel_reseller_credit_order(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.cancel_reseller_credit_order(uuid,text)', 'EXECUTE') then
    raise exception 'FAIL 4b: grants de cancel_reseller_credit_order incorretos';
  end if;
  if not has_function_privilege('authenticated', 'public.claim_reseller_client_invite(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.claim_reseller_client_invite(text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.claim_reseller_client_invite(text)', 'EXECUTE') then
    raise exception 'FAIL 4c: grants de claim_reseller_client_invite incorretos';
  end if;
  v_n := v_n + 1; raise notice 'PASS 4 (%/23)', v_n;

  -- 5) Funcoes legadas, guard e contexto privado nao sao executaveis por API.
  if has_function_privilege('authenticated', 'public.activate_reseller_client_v2_legacy(uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.activate_reseller_client_v2_legacy(uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.activate_reseller_client_v2_legacy(uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cancel_reseller_credit_order_legacy(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.cancel_reseller_credit_order_legacy(uuid,text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.cancel_reseller_credit_order_legacy(uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.claim_reseller_client_invite_legacy(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.claim_reseller_client_invite_legacy(text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.claim_reseller_client_invite_legacy(text)', 'EXECUTE') then
    raise exception 'FAIL 5: funcao legada executavel por role de API';
  end if;
  if has_function_privilege('authenticated', 'dellyvery_private.begin_reseller_write_context(text,uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'dellyvery_private.begin_reseller_write_context(text,uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'dellyvery_private.begin_reseller_write_context(text,uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'dellyvery_private.end_reseller_write_context(text,uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'dellyvery_private.end_reseller_write_context(text,uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'dellyvery_private.end_reseller_write_context(text,uuid,uuid,uuid)', 'EXECUTE') then
    raise exception 'FAIL 5b: funcao privada executavel por role de API';
  end if;
  if has_function_privilege('authenticated', 'public.guard_reseller_client_write()', 'EXECUTE')
     or has_function_privilege('anon', 'public.guard_reseller_client_write()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.guard_reseller_client_write()', 'EXECUTE') then
    raise exception 'FAIL 5c: guard executavel por role de API';
  end if;
  if not has_function_privilege('authenticated', 'public.is_reseller_write_context_active(text,uuid,uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.is_reseller_write_context_active(text,uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.is_reseller_write_context_active(text,uuid,uuid,uuid)', 'EXECUTE') then
    raise exception 'FAIL 5d: grants do helper de contexto incorretos';
  end if;
  v_n := v_n + 1; raise notice 'PASS 5 (%/23)', v_n;

  -- 6) Schema/tabela privados inacessiveis pelas roles de API.
  if has_schema_privilege('authenticated', 'dellyvery_private', 'USAGE')
     or has_schema_privilege('anon', 'dellyvery_private', 'USAGE')
     or has_schema_privilege('service_role', 'dellyvery_private', 'USAGE') then
    raise exception 'FAIL 6: schema privado acessivel por role de API';
  end if;
  if has_table_privilege('authenticated', 'dellyvery_private.reseller_write_context', 'SELECT')
     or has_table_privilege('anon', 'dellyvery_private.reseller_write_context', 'SELECT')
     or has_table_privilege('service_role', 'dellyvery_private.reseller_write_context', 'SELECT') then
    raise exception 'FAIL 6b: tabela de contexto acessivel por role de API';
  end if;
  if not exists (
    select 1
    from pg_class c
    where c.oid = 'dellyvery_private.reseller_write_context'::regclass
      and c.relrowsecurity
      and pg_get_userbyid(c.relowner) = 'postgres'
  ) then
    raise exception 'FAIL 6c: contexto sem RLS ou owner postgres';
  end if;
  v_n := v_n + 1; raise notice 'PASS 6 (%/23)', v_n;

  -- 7) public continua sem CREATE para roles de API.
  if has_schema_privilege('authenticated', 'public', 'CREATE')
     or has_schema_privilege('anon', 'public', 'CREATE')
     or has_schema_privilege('service_role', 'public', 'CREATE') then
    raise exception 'FAIL 7: public permite CREATE para role de API';
  end if;
  v_n := v_n + 1; raise notice 'PASS 7 (%/23)', v_n;

  -- 8) Contexto inicia desligado, escopa por operacao/cliente e suporta aninhamento.
  if public.is_reseller_write_context_active(
    'activation', 'b3333333-3333-4333-8333-333333333301',
    'b4444444-4444-4444-8444-444444444401', v_user
  ) then
    raise exception 'FAIL 8: Contexto ativo fora da operacao';
  end if;
  perform dellyvery_private.begin_reseller_write_context(
    'activation', 'b3333333-3333-4333-8333-333333333301', v_client, v_user
  );
  if not public.is_reseller_write_context_active(
    'activation', 'b3333333-3333-4333-8333-333333333301', v_client, v_user
  ) then
    raise exception 'FAIL 8b: Contexto nao ativou';
  end if;
  if public.is_reseller_write_context_active(
    'claim', 'b3333333-3333-4333-8333-333333333301', v_client, v_user
  ) or public.is_reseller_write_context_active(
    'activation', 'b3333333-3333-4333-8333-333333333301', v_client_claim, v_user
  ) then
    raise exception 'FAIL 8c: Contexto vazou para outro escopo';
  end if;
  perform dellyvery_private.begin_reseller_write_context(
    'activation', 'b3333333-3333-4333-8333-333333333301', v_client, v_user
  );
  perform dellyvery_private.end_reseller_write_context(
    'activation', 'b3333333-3333-4333-8333-333333333301', v_client, v_user
  );
  if not public.is_reseller_write_context_active(
    'activation', 'b3333333-3333-4333-8333-333333333301', v_client, v_user
  ) then
    raise exception 'FAIL 8d: Contexto aninhado encerrou cedo';
  end if;
  perform dellyvery_private.end_reseller_write_context(
    'activation', 'b3333333-3333-4333-8333-333333333301', v_client, v_user
  );
  if public.is_reseller_write_context_active(
    'activation', 'b3333333-3333-4333-8333-333333333301', v_client, v_user
  ) then
    raise exception 'FAIL 8e: Contexto nao desligou';
  end if;
  v_n := v_n + 1; raise notice 'PASS 8 (%/23)', v_n;

  -- 9) Contexto conflitante e rejeitado sem substituir o contexto original.
  perform dellyvery_private.begin_reseller_write_context(
    'activation', 'b3333333-3333-4333-8333-333333333301', v_client, v_user
  );
  begin
    perform dellyvery_private.begin_reseller_write_context(
      'activation', 'b3333333-3333-4333-8333-333333333302', v_client_claim, v_user
    );
    raise exception 'FAIL 9: Contexto conflitante foi aceito';
  exception when others then
    if sqlerrm not ilike '%conflitante%' then raise; end if;
  end;
  if not public.is_reseller_write_context_active(
    'activation', 'b3333333-3333-4333-8333-333333333301', v_client, v_user
  ) then
    raise exception 'FAIL 9b: Contexto original foi perdido';
  end if;
  perform dellyvery_private.end_reseller_write_context(
    'activation', 'b3333333-3333-4333-8333-333333333301', v_client, v_user
  );
  v_n := v_n + 1; raise notice 'PASS 9 (%/23)', v_n;

  -- 10) Rollback de subtransacao nao deixa contexto orfao.
  begin
    perform dellyvery_private.begin_reseller_write_context(
      'activation', 'b3333333-3333-4333-8333-333333333301', v_client, v_user
    );
    raise exception 'rollback de contexto';
  exception when others then
    if sqlerrm <> 'rollback de contexto' then raise; end if;
  end;
  if public.is_reseller_write_context_active(
    'activation', 'b3333333-3333-4333-8333-333333333301', v_client, v_user
  ) then
    raise exception 'FAIL 10: Contexto sobreviveu ao rollback';
  end if;
  v_n := v_n + 1; raise notice 'PASS 10 (%/23)', v_n;

  -- Fixture minima para provar que owner nao e confiavel e que o contexto
  -- escopado autoriza somente a linha/operacao correta.
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    is_super_admin, confirmation_token, recovery_token
  )
  values
    (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'followup_guard@test.local', crypt('password', gen_salt('bf')), now(), now(), now(),
     '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_claim_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'followup_claim@test.local', crypt('password', gen_salt('bf')), now(), now(), now(),
     '{"provider":"email","providers":["email"]}', '{}', false, '', '')
  on conflict (id) do nothing;

  insert into public.profiles (id, email, name, platform_role)
  values
    (v_user, 'followup_guard@test.local', 'Followup Guard', 'USER'),
    (v_claim_user, 'followup_claim@test.local', 'Followup Claim User', 'USER')
  on conflict (id) do update set platform_role = excluded.platform_role;

  insert into public.reseller_invites (id, token, name, phone, status, registration, decided_at)
  values (
    v_invite, 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeee1', 'Followup Reseller',
    '5511990000991', 'aprovado',
    '{"email":"followup_guard@test.local","phone":"5511990000991"}'::jsonb, now()
  )
  on conflict (id) do nothing;

  insert into public.resellers (user_id, invite_id, status)
  values (v_user, v_invite, 'ativo')
  on conflict (user_id) do update set status = excluded.status
  returning id into v_reseller;

  -- Fixture: desabilita a guarda apenas para semear colunas protegidas. A
  -- trigger de producao e reativada antes de qualquer assercao.
  alter table public.reseller_clients disable trigger trg_reseller_client_guard;
  insert into public.reseller_clients
    (id, reseller_id, name, email, status, created_by, user_id)
  values
    (v_client, v_reseller, 'Followup Cliente', 'followup_client@test.local', 'prospecto', v_user, v_user),
    (v_client_claim, v_reseller, 'Followup Claim', 'followup_claim@test.local', 'prospecto', v_user, null);
  alter table public.reseller_clients enable trigger trg_reseller_client_guard;

  -- 11) Owner postgres nao autoriza update de campo protegido.
  execute 'set role postgres';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  begin
    update public.reseller_clients
    set access_expires_at = now() + interval '1 day'
    where id = v_client;
    raise exception 'FAIL 11: update de owner passou sem contexto';
  exception when others then
    if sqlerrm not ilike '%gerenciado pela ativacao%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS 11 (%/23)', v_n;

  -- 12) Contexto de ativacao autoriza a linha correta e apenas activation.
  perform dellyvery_private.begin_reseller_write_context(
    'activation', v_reseller, v_client, v_user
  );
  begin
    update public.reseller_clients
    set company_id = 'b5555555-5555-4555-8555-555555555501'
    where id = v_client;
    raise exception 'FAIL 12: update com company_id invalida passou';
  exception when foreign_key_violation then
    null;
  end;
  update public.reseller_clients
  set access_expires_at = now() + interval '1 day'
  where id = v_client;
  perform dellyvery_private.end_reseller_write_context(
    'activation', v_reseller, v_client, v_user
  );
  if (select access_expires_at from public.reseller_clients where id = v_client) is null then
    raise exception 'FAIL 12b: Contexto de ativacao nao autorizou o update';
  end if;
  v_n := v_n + 1; raise notice 'PASS 12 (%/23)', v_n;

  -- 13) Contexto de claim autoriza somente o user_id do proprio ator.
  perform set_config('request.jwt.claim.sub', v_claim_user::text, false);
  perform dellyvery_private.begin_reseller_write_context(
    'claim', v_reseller, v_client_claim, v_claim_user
  );
  begin
    update public.reseller_clients
    set user_id = 'b1111111-1111-4111-8111-111111111199'
    where id = v_client_claim;
    raise exception 'FAIL 13: claim vinculou outro usuario';
  exception when others then
    if sqlerrm not ilike '%gerenciado pela ativacao%' then raise; end if;
  end;
  update public.reseller_clients
  set user_id = v_claim_user
  where id = v_client_claim;
  perform dellyvery_private.end_reseller_write_context(
    'claim', v_reseller, v_client_claim, v_claim_user
  );
  if (select user_id from public.reseller_clients where id = v_client_claim) <> v_claim_user then
    raise exception 'FAIL 13b: Contexto de claim nao autorizou o update';
  end if;
  perform set_config('request.jwt.claim.sub', '', false);
  v_n := v_n + 1; raise notice 'PASS 13 (%/23)', v_n;

  -- 14) Trigger, marcador antigo e estrutura privada finais.
  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.reseller_clients'::regclass
      and t.tgname = 'trg_reseller_client_guard'
      and not t.tgisinternal
      and t.tgenabled = 'O'
      and t.tgattr = ''::int2vector
      and t.tgqual is null
      and t.tgfoid = 'public.guard_reseller_client_write()'::regprocedure
  ) then
    raise exception 'FAIL 14: trigger de guarda ausente ou incompleto';
  end if;
  select pg_get_userbyid(n.nspowner)
    into v_owner
  from pg_namespace n
  where n.nspname = 'dellyvery_private';
  if v_owner is distinct from 'postgres' then
    raise exception 'FAIL 14b: owner do schema privado = %', v_owner;
  end if;
  if to_regprocedure('public.is_reseller_activation_in_progress()') is not null then
    if has_function_privilege('authenticated', 'public.is_reseller_activation_in_progress()', 'EXECUTE')
       or has_function_privilege('anon', 'public.is_reseller_activation_in_progress()', 'EXECUTE')
       or has_function_privilege('service_role', 'public.is_reseller_activation_in_progress()', 'EXECUTE') then
      raise exception 'FAIL 14c: marcador antigo ainda executavel por API';
    end if;
  end if;
  v_n := v_n + 1; raise notice 'PASS 14 (%/23)', v_n;

  -- 15) service_role e spoof de auth.role nao contornam a guarda.
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  perform set_config('request.jwt.claim.role', 'service_role', false);
  execute 'set role service_role';
  begin
    update public.reseller_clients
    set access_expires_at = now() + interval '2 days'
    where id = v_client;
    raise exception 'FAIL 15: service_role passou sem contexto';
  exception when others then
    if sqlerrm not ilike '%gerenciado pela ativacao%' then raise; end if;
  end;
  execute 'reset role';
  execute 'set role authenticated';
  begin
    update public.reseller_clients
    set access_expires_at = now() + interval '2 days'
    where id = v_client;
    raise exception 'FAIL 15b: auth.role spoof passou sem contexto';
  exception when others then
    if sqlerrm not ilike '%gerenciado pela ativacao%' then raise; end if;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.role', '', false);
  perform set_config('request.jwt.claim.sub', '', false);
  v_n := v_n + 1; raise notice 'PASS 15 (%/23)', v_n;

  -- 16) Roles de API nao criam, alteram ou ampliam contexto diretamente.
  execute 'set role authenticated';
  begin
    insert into dellyvery_private.reseller_write_context
      (backend_pid, txid, operation, reseller_id, client_id, user_id)
    values
      (pg_backend_pid(), txid_current(), 'activation', v_reseller, v_client, v_user);
    raise exception 'FAIL 16: authenticated inseriu contexto';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform dellyvery_private.begin_reseller_write_context(
      'activation', v_reseller, v_client, v_user
    );
    raise exception 'FAIL 16b: authenticated abriu contexto';
  exception when insufficient_privilege then
    null;
  end;
  if public.is_reseller_write_context_active(
    'activation', v_reseller, v_client, v_user
  ) then
    raise exception 'FAIL 16c: helper forjou contexto para authenticated';
  end if;
  execute 'reset role';
  execute 'set role service_role';
  begin
    insert into dellyvery_private.reseller_write_context
      (backend_pid, txid, operation, reseller_id, client_id, user_id)
    values
      (pg_backend_pid(), txid_current(), 'activation', v_reseller, v_client, v_user);
    raise exception 'FAIL 16d: service_role inseriu contexto';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform dellyvery_private.begin_reseller_write_context(
      'activation', v_reseller, v_client, v_user
    );
    raise exception 'FAIL 16e: service_role abriu contexto';
  exception when insufficient_privilege then
    null;
  end;
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS 16 (%/23)', v_n;

  -- 17) Contexto de ativacao nao autoriza outro revendedor/cliente/usuario.
  perform dellyvery_private.begin_reseller_write_context(
    'activation', v_reseller, v_client, v_user
  );
  if public.is_reseller_write_context_active(
       'activation', 'b3333333-3333-4333-8333-333333333302', v_client, v_user
     )
     or public.is_reseller_write_context_active(
       'activation', v_reseller, v_client_claim, v_user
     )
     or public.is_reseller_write_context_active(
       'activation', v_reseller, v_client, 'b1111111-1111-4111-8111-111111111199'
     ) then
    raise exception 'FAIL 17: contexto autorizou outro escopo';
  end if;
  begin
    update public.reseller_clients
    set access_expires_at = now() + interval '1 day'
    where id = v_client_claim;
    raise exception 'FAIL 17b: contexto autorizou outra linha';
  exception when others then
    if sqlerrm not ilike '%gerenciado pela ativacao%' then raise; end if;
  end;
  perform dellyvery_private.end_reseller_write_context(
    'activation', v_reseller, v_client, v_user
  );
  v_n := v_n + 1; raise notice 'PASS 17 (%/23)', v_n;

  -- 18) Contexto de transacao/backend anterior nao autoriza a transacao atual.
  insert into dellyvery_private.reseller_write_context
    (backend_pid, txid, operation, reseller_id, client_id, user_id, depth)
  values
    (pg_backend_pid(), txid_current() - 1, 'activation', v_reseller, v_client, v_user, 1);
  if public.is_reseller_write_context_active(
    'activation', v_reseller, v_client, v_user
  ) then
    raise exception 'FAIL 18: contexto de transacao anterior autorizou';
  end if;
  delete from dellyvery_private.reseller_write_context
  where backend_pid = pg_backend_pid()
    and txid = txid_current() - 1;
  insert into dellyvery_private.reseller_write_context
    (backend_pid, txid, operation, reseller_id, client_id, user_id, depth)
  values
    (pg_backend_pid() + 1, txid_current(), 'activation', v_reseller, v_client, v_user, 1);
  if public.is_reseller_write_context_active(
    'activation', v_reseller, v_client, v_user
  ) then
    raise exception 'FAIL 18b: contexto de outro backend autorizou';
  end if;
  delete from dellyvery_private.reseller_write_context
  where backend_pid = pg_backend_pid() + 1
    and txid = txid_current();
  v_n := v_n + 1; raise notice 'PASS 18 (%/23)', v_n;

  -- 19) Guard sem trust por role/current_user, defaults, indice e grants DML.
  select pg_get_functiondef('public.guard_reseller_client_write()'::regprocedure)
    into v_def;
  if position('service_role' in lower(v_def)) > 0
     or position('current_user' in lower(v_def)) > 0 then
    raise exception 'FAIL 19: guard ainda cita role/current_user como confianca';
  end if;
  if not exists (
    select 1
    from pg_attrdef d
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
    where d.adrelid = 'dellyvery_private.reseller_write_context'::regclass
      and a.attname = 'depth'
      and pg_get_expr(d.adbin, d.adrelid) = '1'
  ) or not exists (
    select 1
    from pg_attrdef d
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
    where d.adrelid = 'dellyvery_private.reseller_write_context'::regclass
      and a.attname = 'created_at'
      and pg_get_expr(d.adbin, d.adrelid) = 'now()'
  ) then
    raise exception 'FAIL 19b: defaults do contexto ausentes ou incorretos';
  end if;
  if not exists (
    select 1
    from pg_class c
    where c.oid = 'dellyvery_private.idx_reseller_write_context_created'::regclass
      and c.relkind = 'i'
      and pg_get_indexdef(c.oid) = 'CREATE INDEX idx_reseller_write_context_created ON dellyvery_private.reseller_write_context USING btree (created_at)'
  ) then
    raise exception 'FAIL 19c: indice created_at ausente ou incorreto';
  end if;
  if has_table_privilege('authenticated', 'dellyvery_private.reseller_write_context', 'INSERT')
     or has_table_privilege('authenticated', 'dellyvery_private.reseller_write_context', 'UPDATE')
     or has_table_privilege('authenticated', 'dellyvery_private.reseller_write_context', 'DELETE')
     or has_table_privilege('service_role', 'dellyvery_private.reseller_write_context', 'INSERT')
     or has_table_privilege('service_role', 'dellyvery_private.reseller_write_context', 'UPDATE')
     or has_table_privilege('service_role', 'dellyvery_private.reseller_write_context', 'DELETE')
     or has_table_privilege('anon', 'dellyvery_private.reseller_write_context', 'INSERT')
     or has_table_privilege('anon', 'dellyvery_private.reseller_write_context', 'UPDATE')
     or has_table_privilege('anon', 'dellyvery_private.reseller_write_context', 'DELETE') then
    raise exception 'FAIL 19d: tabela de contexto aceita DML de role de API';
  end if;
  v_n := v_n + 1; raise notice 'PASS 19 (%/23)', v_n;

  -- 20) Funcao SECURITY DEFINER pertencente a postgres nao contorna a guarda.
  execute $probe$
    create or replace function public._followup_guard_probe(p_client uuid)
    returns void
    language plpgsql
    security definer
    set search_path = pg_catalog, public
    as $fn$
    begin
      update public.reseller_clients
      set access_expires_at = now() + interval '3 days'
      where id = p_client;
    end;
    $fn$;
  $probe$;
  execute 'alter function public._followup_guard_probe(uuid) owner to postgres';
  execute 'revoke all on function public._followup_guard_probe(uuid) from public, anon, authenticated, service_role';
  execute 'grant execute on function public._followup_guard_probe(uuid) to authenticated';
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  begin
    perform public._followup_guard_probe(v_client);
    raise exception 'FAIL 20: SECURITY DEFINER contornou a guarda';
  exception when others then
    if sqlerrm not ilike '%gerenciado pela ativacao%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  execute 'drop function public._followup_guard_probe(uuid)';
  v_n := v_n + 1; raise notice 'PASS 20 (%/23)', v_n;

  -- 21) extensions: owners das funcoes usam privilegio efetivo.
  select string_agg(p.oid::regprocedure::text || '=' || pg_get_userbyid(p.proowner), ', ')
    into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'dellyvery_private')
    and p.prokind = 'f'
    and (p.prosrc ilike '%extensions.digest%' or p.prosrc ilike '%extensions.gen_random_bytes%')
    and (
      not has_schema_privilege(p.proowner, 'extensions', 'USAGE')
      or not has_function_privilege(p.proowner, 'extensions.digest(bytea,text)', 'EXECUTE')
      or not has_function_privilege(p.proowner, 'extensions.digest(text,text)', 'EXECUTE')
      or not has_function_privilege(p.proowner, 'extensions.gen_random_bytes(integer)', 'EXECUTE')
    );
  if v_bad is not null then
    raise exception 'FAIL 21: owner sem privilegio efetivo em extensions: %', v_bad;
  end if;
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_bad
  from pg_proc p
  where p.oid in (
    'public.claim_reseller_client_invite_legacy(text)'::regprocedure,
    'public.create_reseller_client_invite(uuid)'::regprocedure,
    'public.resolve_reseller_client_invite(text)'::regprocedure,
    'public.claim_reseller_client_invite(text)'::regprocedure
  )
    and not p.prosecdef;
  if v_bad is not null then
    raise exception 'FAIL 21b: funcao de convite com extensions sem SECURITY DEFINER: %', v_bad;
  end if;
  v_n := v_n + 1; raise notice 'PASS 21 (%/23)', v_n;

  -- 22) Default ACL privado sem PUBLIC/API e schema sem USAGE exposto.
  if exists (
    select 1
    from pg_default_acl d
    cross join lateral aclexplode(d.defaclacl) a
    where d.defaclnamespace = 'dellyvery_private'::regnamespace
      and pg_get_userbyid(d.defaclrole) in ('postgres', 'supabase_admin')
      and (a.grantee = 0
           or a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole))
  ) then
    raise exception 'FAIL 22: default ACL privado contem PUBLIC/API';
  end if;
  -- A4: prova dinamica de que uma funcao futura em dellyvery_private continua
  -- inacessivel pela API via USAGE, apesar do EXECUTE PUBLIC nativo.
  execute $probe$
    create or replace function dellyvery_private._followup_private_acl_probe()
    returns void
    language plpgsql
    as $fn$ begin null; end; $fn$;
  $probe$;
  execute 'alter function dellyvery_private._followup_private_acl_probe() owner to postgres';
  execute 'set role anon';
  begin
    perform dellyvery_private._followup_private_acl_probe();
    execute 'reset role';
    raise exception 'FAIL 22d: anon executou funcao nova em dellyvery_private';
  exception when insufficient_privilege then
    execute 'reset role';
  end;
  execute 'drop function dellyvery_private._followup_private_acl_probe()';
  if has_schema_privilege('public', 'dellyvery_private', 'USAGE')
     or has_schema_privilege('anon', 'dellyvery_private', 'USAGE')
     or has_schema_privilege('authenticated', 'dellyvery_private', 'USAGE')
     or has_schema_privilege('service_role', 'dellyvery_private', 'USAGE') then
    raise exception 'FAIL 22b: dellyvery_private com USAGE exposto';
  end if;
  if has_schema_privilege('public', 'public', 'CREATE')
     or has_schema_privilege('anon', 'public', 'CREATE')
     or has_schema_privilege('authenticated', 'public', 'CREATE')
     or has_schema_privilege('service_role', 'public', 'CREATE') then
    raise exception 'FAIL 22c: public com CREATE exposto';
  end if;
  v_n := v_n + 1; raise notice 'PASS 22 (%/23)', v_n;

  -- 23) PUBLIC sem EXECUTE e allowlist minima aplicada.
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'dellyvery_private')
      and p.prokind = 'f'
      and has_function_privilege('public', p.oid, 'EXECUTE')
  ) then
    raise exception 'FAIL 23: PUBLIC ainda executa funcao em public/dellyvery_private';
  end if;
  if has_function_privilege('authenticated', 'public.consume_reseller_rpc_limit(text,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_reseller_client_write()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.normalize_table_key(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.seed_default_order_stages(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_reseller_client_invite(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.activate_reseller_client_v2(uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.activate_reseller_client_v2(uuid,uuid,uuid)', 'EXECUTE') then
    raise exception 'FAIL 23b: funcao interna/restrita executavel por role indevida';
  end if;
  if not has_function_privilege('anon', 'public.create_order(text,text,text,jsonb,jsonb,uuid,text,text,text,numeric,uuid,text,numeric,numeric,numeric,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.next_order_number(uuid)', 'EXECUTE') then
    raise exception 'FAIL 23c: allowlist removeu grant necessario';
  end if;
  if not has_function_privilege('authenticated', 'public.anonymize_lead_ips(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.anonymize_lead_ips(integer)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.anonymize_lead_ips(integer)', 'EXECUTE') then
    raise exception 'FAIL 23d: grant de anonymize_lead_ips divergente do historico';
  end if;
  v_n := v_n + 1; raise notice 'PASS 23 (%/23)', v_n;

  raise notice 'ALL PASS (23/23)';
end;
$$;

rollback;
