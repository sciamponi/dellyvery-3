-- RLS + RPCs do módulo Revenda (local only).
-- Execução: Get-Content -Raw supabase/tests/rls_resellers.sql | docker exec -i supabase_db_dellyvery-3 psql -U postgres -d postgres -v ON_ERROR_STOP=1
-- Padrão do projeto (rls_dellyvery3.sql): superuser postgres contorna o RLS;
-- cada assert troca o role (anon / authenticated + jwt claim) e restaura.
-- Falha: RAISE EXCEPTION (aborta). Sucesso: NOTICE "PASS <id> (<n>/18)".

do $$
declare
  v_admin uuid := '55555555-5555-5555-5555-555555555555';
  v_user  uuid := '44444444-4444-4444-4444-444444444444';
  v_count int;
  v_out jsonb;
  v_token text;
  v_id uuid;
  v_id2 uuid;
  v_n int := 0;
begin
  -- Setup (superuser): limpa execuções anteriores + usuários de teste.
  delete from public.reseller_invites where phone like '55119900000%';
  delete from public.profiles where id in (v_admin, v_user);
  delete from auth.users where id in (v_admin, v_user);
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, confirmation_token, recovery_token)
  values
    (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reseller_user@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reseller_admin@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', '')
  on conflict (id) do nothing;
  insert into public.profiles (id, email, name, platform_role) values
    (v_user, 'reseller_user@test.local', 'Reseller User', 'USER'),
    (v_admin, 'reseller_admin@test.local', 'Reseller Admin', 'PLATFORM_ADMIN')
  on conflict (id) do update set platform_role = excluded.platform_role;

  -- A1: anon não lê (RLS using(false) → 0 linhas, sem erro).
  execute 'set role anon';
  select count(*) into v_count from public.reseller_invites;
  execute 'reset role';
  if v_count <> 0 then raise exception 'FAIL A1: anon leu % linhas', v_count; end if;
  v_n := v_n + 1; raise notice 'PASS A1 (%/18)', v_n;

  -- A2: anon não insere direto.
  execute 'set role anon';
  begin
    insert into public.reseller_invites (token, name, phone)
    values ('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'X', '5511990000011');
    raise exception 'FAIL A2: anon insert passou';
  exception when others then
    if sqlerrm not ilike '%row-level security%' and sqlerrm not ilike '%policy%' and sqlerrm not ilike '%permission%' then
      raise;
    end if;
  end;
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS A2 (%/18)', v_n;

  -- B1: authenticated não-admin não lê.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  select count(*) into v_count from public.reseller_invites;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  if v_count <> 0 then raise exception 'FAIL B1: user leu % linhas', v_count; end if;
  v_n := v_n + 1; raise notice 'PASS B1 (%/18)', v_n;

  -- B2: não-admin não cria convite.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_user::text, false);
  begin
    perform public.create_reseller_invite('Joao', '5511990000011');
    raise exception 'FAIL B2: user criou convite';
  exception when others then
    if sqlerrm not ilike '%sem permiss%o%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS B2 (%/18)', v_n;

  -- Contexto admin para os próximos asserts.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);

  -- C1: nome obrigatório.
  begin
    perform public.create_reseller_invite('', '5511990000011');
    raise exception 'FAIL C1: nome vazio aceito';
  exception when others then
    if sqlerrm not ilike '%nome%obrigat%rio%' then raise; end if;
  end;
  v_n := v_n + 1; raise notice 'PASS C1 (%/18)', v_n;

  -- C2: telefone exige DDI 55 (frontend normaliza; servidor é estrito).
  begin
    perform public.create_reseller_invite('Joao', '11999000011');
    raise exception 'FAIL C2: telefone sem DDI aceito';
  exception when others then
    if sqlerrm not ilike '%whatsapp%inv%lido%' then raise; end if;
  end;
  v_n := v_n + 1; raise notice 'PASS C2 (%/18)', v_n;

  -- C3: criação válida → token 32hex, status criado, sem reuso.
  select public.create_reseller_invite('Joao Silva', '5511990000011') into v_out;
  v_token := v_out ->> 'token';
  v_id := (v_out ->> 'invite_id')::uuid;
  if v_token !~ '^[0-9a-f]{32}$' then raise exception 'FAIL C3: token fora do formato: %', v_token; end if;
  if (v_out ->> 'status') <> 'criado' then raise exception 'FAIL C3: status %', v_out ->> 'status'; end if;
  if coalesce((v_out ->> 'reused')::boolean, true) then raise exception 'FAIL C3: reused inesperado'; end if;
  v_n := v_n + 1; raise notice 'PASS C3 (%/18)', v_n;

  -- C4: mesmo telefone ativo → reutiliza (sem duplicar link).
  select public.create_reseller_invite('Joao Outro Nome', '5511990000011') into v_out;
  v_id2 := (v_out ->> 'invite_id')::uuid;
  if not coalesce((v_out ->> 'reused')::boolean, false) then raise exception 'FAIL C4: não reutilizou'; end if;
  if v_id2 is distinct from v_id then raise exception 'FAIL C4: ids distintos'; end if;
  if (v_out ->> 'token') is distinct from v_token then raise exception 'FAIL C4: token distinto'; end if;
  v_n := v_n + 1; raise notice 'PASS C4 (%/18)', v_n;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', false);

  -- D1: resolve com token malformado.
  execute 'set role anon';
  begin
    perform public.resolve_reseller_invite('curto');
    raise exception 'FAIL D1: token curto aceito';
  exception when others then
    if sqlerrm not ilike '%n%o identificado%' then raise; end if;
  end;
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS D1 (%/18)', v_n;

  -- D2: resolve token inexistente.
  execute 'set role anon';
  begin
    perform public.resolve_reseller_invite('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    raise exception 'FAIL D2: token fantasma aceito';
  exception when others then
    if sqlerrm not ilike '%n%o encontrado%' then raise; end if;
  end;
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS D2 (%/18)', v_n;

  -- D3: resolve válido → só pré-preenchimento (sem token!), produto/modalidade.
  execute 'set role anon';
  select public.resolve_reseller_invite(v_token) into v_out;
  execute 'reset role';
  if (v_out ->> 'name') <> 'Joao Silva' then raise exception 'FAIL D3: nome %', v_out ->> 'name'; end if;
  if (v_out ->> 'phone') <> '5511990000011' then raise exception 'FAIL D3: phone'; end if;
  if (v_out ->> 'product') <> 'dellyvery' or (v_out ->> 'modality') <> 'parceiro' then
    raise exception 'FAIL D3: produto/modalidade';
  end if;
  if (v_out ? 'token') then raise exception 'FAIL D3: token vazado no resolve'; end if;
  v_n := v_n + 1; raise notice 'PASS D3 (%/18)', v_n;

  -- E1: claim com telefone divergente (anti-tamper).
  execute 'set role anon';
  begin
    perform public.claim_reseller_invite(v_token, '{"full_name":"Joao Silva","phone":"5511888888888"}'::jsonb);
    raise exception 'FAIL E1: telefone divergente aceito';
  exception when others then
    if sqlerrm not ilike '%divergente%' then raise; end if;
  end;
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS E1 (%/18)', v_n;

  -- E2: claim válido → aguardando_aprovacao, sanitizado, produto travado.
  execute 'set role anon';
  select public.claim_reseller_invite(v_token,
    '{"full_name":"Joao Silva","phone":"5511990000011","email":"joao@test.local","document":"123","city":"SP","state":"SP","notes":"x","product":"outro","modality":"admin","token":"injetado"}'::jsonb)
    into v_out;
  execute 'reset role';
  if (v_out ->> 'status') <> 'aguardando_aprovacao' then raise exception 'FAIL E2: status %', v_out ->> 'status'; end if;
  if coalesce((v_out ->> 'reused')::boolean, true) then raise exception 'FAIL E2: reused inesperado'; end if;
  select registration into v_out from public.reseller_invites where id = v_id;
  if (v_out ->> 'product') <> 'dellyvery' or (v_out ->> 'modality') <> 'parceiro' then
    raise exception 'FAIL E2: produto/modalidade adulterados';
  end if;
  if (v_out ? 'token') then raise exception 'FAIL E2: chave estranha persistida'; end if;
  if (v_out ->> 'email') <> 'joao@test.local' then raise exception 'FAIL E2: email'; end if;
  v_n := v_n + 1; raise notice 'PASS E2 (%/18)', v_n;

  -- E3: re-claim idempotente (reabertura recupera, sem duplicar).
  execute 'set role anon';
  select public.claim_reseller_invite(v_token, '{"full_name":"Joao Silva","phone":"5511990000011"}'::jsonb) into v_out;
  execute 'reset role';
  if not coalesce((v_out ->> 'reused')::boolean, false) then raise exception 'FAIL E3: não reutilizou'; end if;
  select count(*) into v_count from public.reseller_invites where phone = '5511990000011';
  if v_count <> 1 then raise exception 'FAIL E3: duplicou (% linhas)', v_count; end if;
  v_n := v_n + 1; raise notice 'PASS E3 (%/18)', v_n;

  -- E4: expirado → resolve nega; sweep (transação própria) marca.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  select public.create_reseller_invite('Expirado', '5511990000022') into v_out;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', false);
  update public.reseller_invites set expires_at = now() - interval '1 day' where phone = '5511990000022';
  execute 'set role anon';
  begin
    perform public.resolve_reseller_invite(v_out ->> 'token');
    raise exception 'FAIL E4: expirado resolvido';
  exception when others then
    if sqlerrm not ilike '%expirado%' then raise; end if;
  end;
  execute 'reset role';
  if (select status from public.reseller_invites where phone = '5511990000022') <> 'criado' then
    raise exception 'FAIL E4: resolve não deve alterar nada (rollback)';
  end if;
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  select public.sweep_expired_reseller_invites() into v_out;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', false);
  if coalesce((v_out ->> 'swept')::bigint, 0) < 1 then raise exception 'FAIL E4: sweep não marcou'; end if;
  if (select status from public.reseller_invites where phone = '5511990000022') <> 'expirado' then
    raise exception 'FAIL E4: status não marcado';
  end if;
  v_n := v_n + 1; raise notice 'PASS E4 (%/18)', v_n;

  -- E5: revogado → resolve e claim negam (histórico preservado).
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  select public.create_reseller_invite('Revogado', '5511990000033') into v_out;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', false);
  update public.reseller_invites set status = 'revogado' where phone = '5511990000033';
  execute 'set role anon';
  begin
    perform public.resolve_reseller_invite(v_out ->> 'token');
    raise exception 'FAIL E5a: revogado resolvido';
  exception when others then
    if sqlerrm not ilike '%revogado%' then raise; end if;
  end;
  begin
    perform public.claim_reseller_invite(v_out ->> 'token', '{"full_name":"Revogado","phone":"5511990000033"}'::jsonb);
    raise exception 'FAIL E5b: revogado inscrito';
  exception when others then
    if sqlerrm not ilike '%revogado%' then raise; end if;
  end;
  execute 'reset role';
  select count(*) into v_count from public.reseller_invites where phone = '5511990000033';
  if v_count <> 1 then raise exception 'FAIL E5c: histórico apagado'; end if;
  v_n := v_n + 1; raise notice 'PASS E5 (%/18)', v_n;

  -- F1: update direto admin permitido pelo RLS (transições finas validadas
  -- no frontend — mesmo padrão de commercial_adhesions).
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  update public.reseller_invites set status = 'aprovado', decided_at = now() where id = v_id;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', false);
  select count(*) into v_count from public.reseller_invites where id = v_id and status = 'aprovado';
  if v_count <> 1 then raise exception 'FAIL F1: admin não atualizou'; end if;
  v_n := v_n + 1; raise notice 'PASS F1 (%/18)', v_n;

  -- F2: update direto como anon não altera (using(false) → 0 linhas).
  execute 'set role anon';
  update public.reseller_invites set status = 'recusado' where id = v_id;
  execute 'reset role';
  if (select status from public.reseller_invites where id = v_id) <> 'aprovado' then
    raise exception 'FAIL F2: status corrompido';
  end if;
  v_n := v_n + 1; raise notice 'PASS F2 (%/18)', v_n;

  -- Cleanup (superuser): remove dados de teste.
  delete from public.reseller_invites where phone like '55119900000%';
  delete from public.profiles where id in (v_admin, v_user);
  delete from auth.users where id in (v_admin, v_user);
  raise notice 'ALL PASS (18/18)';
end;
$$;
