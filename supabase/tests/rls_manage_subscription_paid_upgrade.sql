-- Bloqueio de upgrade pago direto em manage_subscription.
-- Execucao local (apos 20261119000000_dellyvery3_block_paid_plan_upgrade.sql):
--   Get-Content -Raw supabase/tests/rls_manage_subscription_paid_upgrade.sql | docker exec -i supabase_db_dellyvery-3 psql -U postgres -d postgres -v ON_ERROR_STOP=1
-- Falha: RAISE EXCEPTION. Sucesso: NOTICE "PASS T<n> (<n>/6)".

begin;

do $$
declare
  v_owner      uuid := 'a1111111-1111-4111-8111-111111111111';
  v_free_plan  uuid := 'a2222222-2222-4222-8222-222222222222';
  v_paid_plan  uuid := 'a3333333-3333-4333-8333-333333333333';
  v_company    uuid := 'a4444444-4444-4444-8444-444444444444';
  v_sub        public.subscriptions%rowtype;
  v_count      int;
  v_n          int := 0;
begin
  delete from public.subscriptions where company_id = v_company;
  delete from public.company_members where company_id = v_company;
  delete from public.companies where id = v_company;
  delete from public.plans where id in (v_free_plan, v_paid_plan);
  delete from public.profiles where id = v_owner;
  delete from auth.users where id = v_owner;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    is_super_admin, confirmation_token, recovery_token
  ) values (
    v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'paid_upgrade_owner@test.local', crypt('password', gen_salt('bf')), now(),
    now(), now(), '{"provider":"email","providers":["email"]}', '{}',
    false, '', ''
  ) on conflict (id) do nothing;

  insert into public.profiles (id, email, name, platform_role)
  values (v_owner, 'paid_upgrade_owner@test.local', 'Paid Upgrade Owner', 'USER')
  on conflict (id) do update set platform_role = excluded.platform_role;

  insert into public.plans
    (id, name, slug, price, billing_cycle, features, limits, active, sort_order, is_free)
  values
    (v_free_plan, 'Plano Gratuito Teste', 'plano-gratuito-bloqueio-upgrade', 0,
     'monthly', '[]'::jsonb, '{}'::jsonb, true, 1, true),
    (v_paid_plan, 'Plano Pago Teste', 'plano-pago-bloqueio-upgrade', 99.90,
     'monthly', '[]'::jsonb, '{}'::jsonb, true, 2, false);

  insert into public.companies (id, name, slug)
  values (v_company, 'Empresa Teste Bloqueio Upgrade', 'empresa-teste-bloqueio-upgrade');

  insert into public.company_members (company_id, user_id, role, active)
  values (v_company, v_owner, 'OWNER', true);

  insert into public.subscriptions (company_id, plan_id, status, started_at, expires_at)
  values (v_company, v_free_plan, 'trial', now(), now() + interval '7 days');

  -- T1: upgrade para plano pago e bloqueado sem alterar assinatura.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_owner::text, false);
  begin
    perform public.manage_subscription('upgrade', v_paid_plan);
    raise exception 'FAIL T1: upgrade pago passou';
  exception when others then
    if sqlerrm not ilike '%O plano % e pago%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';

  select * into v_sub from public.subscriptions where company_id = v_company;
  if v_sub.plan_id <> v_free_plan then
    raise exception 'FAIL T1b: plano mudou para %', v_sub.plan_id;
  end if;
  if v_sub.status <> 'trial' then
    raise exception 'FAIL T1c: status mudou para %', v_sub.status;
  end if;
  v_n := v_n + 1; raise notice 'PASS T1 (%/6)', v_n;

  -- T2: upgrade para plano gratuito continua permitido.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_owner::text, false);
  v_sub := public.manage_subscription('upgrade', v_free_plan);
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';

  if v_sub.plan_id <> v_free_plan then
    raise exception 'FAIL T2: plano gratuito nao aplicado';
  end if;
  if v_sub.status <> 'ativo' then
    raise exception 'FAIL T2b: trial nao virou ativo';
  end if;
  v_n := v_n + 1; raise notice 'PASS T2 (%/6)', v_n;

  -- T3: cancelamento continua funcionando.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_owner::text, false);
  v_sub := public.manage_subscription('cancel', null);
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';

  if v_sub.status <> 'cancelado' then
    raise exception 'FAIL T3: cancelamento nao aplicado';
  end if;
  v_n := v_n + 1; raise notice 'PASS T3 (%/6)', v_n;

  -- T4: reativacao continua funcionando.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_owner::text, false);
  v_sub := public.manage_subscription('reactivate', null);
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';

  if v_sub.status <> 'ativo' then
    raise exception 'FAIL T4: reativacao nao aplicada';
  end if;
  v_n := v_n + 1; raise notice 'PASS T4 (%/6)', v_n;

  -- T5: anon nao executa a RPC.
  execute 'set role anon';
  begin
    perform public.manage_subscription('upgrade', v_paid_plan);
    raise exception 'FAIL T5: anon executou manage_subscription';
  exception when insufficient_privilege then
    null;
  end;
  execute 'reset role';
  v_n := v_n + 1; raise notice 'PASS T5 (%/6)', v_n;

  -- T6: OWNER nao contorna o bloqueio atualizando a tabela direto.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', v_owner::text, false);
  update public.subscriptions set plan_id = v_paid_plan where company_id = v_company;
  get diagnostics v_count = row_count;
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'reset role';

  if v_count <> 0 then
    raise exception 'FAIL T6: update direto alterou % assinatura(s)', v_count;
  end if;
  select * into v_sub from public.subscriptions where company_id = v_company;
  if v_sub.plan_id <> v_free_plan then
    raise exception 'FAIL T6b: plano mudou via update direto';
  end if;
  v_n := v_n + 1; raise notice 'PASS T6 (%/6)', v_n;
end;
$$;

rollback;
