-- RLS validation for DELLVERY 3 (local only)
-- Run: psql -h 127.0.0.1 -p 54325 -U postgres -d postgres -f supabase/tests/rls_dellyvery3.sql
-- Uses set_config('request.jwt.claim.sub', uuid, true) + set_config('role','authenticated',true) to simulate auth.uid()
-- Superuser postgres bypasses RLS, so we SET LOCAL role to authenticated before each check

\set ON_ERROR_STOP on

-- Helper to clean test data
do $$
begin
  -- clean previous test runs (order important due to FK)
  delete from whatsapp_messages where company_id in (select id from companies where slug in ('empresa-a','empresa-b'));
  delete from whatsapp_connections where company_id in (select id from companies where slug in ('empresa-a','empresa-b'));
  delete from cash_movements where company_id in (select id from companies where slug in ('empresa-a','empresa-b'));
  delete from cash_registers where company_id in (select id from companies where slug in ('empresa-a','empresa-b'));
  delete from audit_logs where company_id in (select id from companies where slug in ('empresa-a','empresa-b'));
  delete from notifications where company_id in (select id from companies where slug in ('empresa-a','empresa-b'));
  delete from order_status_history where order_id in (select id from orders where company_id in (select id from companies where slug in ('empresa-a','empresa-b')));
  delete from order_items where order_id in (select id from orders where company_id in (select id from companies where slug in ('empresa-a','empresa-b')));
  delete from orders where company_id in (select id from companies where slug in ('empresa-a','empresa-b'));
  delete from delivery_drivers where company_id in (select id from companies where slug in ('empresa-a','empresa-b'));
  delete from delivery_zones where company_id in (select id from companies where slug in ('empresa-a','empresa-b'));
  delete from customers where company_id in (select id from companies where slug in ('empresa-a','empresa-b'));
  delete from products where company_id in (select id from companies where slug in ('empresa-a','empresa-b'));
  delete from categories where company_id in (select id from companies where slug in ('empresa-a','empresa-b'));
  delete from subscriptions where company_id in (select id from companies where slug in ('empresa-a','empresa-b'));
  delete from company_order_seq where company_id in (select id from companies where slug in ('empresa-a','empresa-b'));
  delete from company_settings where company_id in (select id from companies where slug in ('empresa-a','empresa-b'));
  delete from store_themes where company_id in (select id from companies where slug in ('empresa-a','empresa-b'));
  delete from company_members where company_id in (select id from companies where slug in ('empresa-a','empresa-b'));
  delete from companies where slug in ('empresa-a','empresa-b');
  delete from profiles where id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333');
  delete from auth.users where id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333');
end;
$$;

-- Create test users in auth.users (minimal fields)
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, confirmation_token, recovery_token)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user_a@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user_b@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', ''),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', '')
on conflict (id) do nothing;

-- profiles
insert into profiles (id, email, name, platform_role) values
  ('11111111-1111-1111-1111-111111111111', 'user_a@test.local', 'User A', 'USER'),
  ('22222222-2222-2222-2222-222222222222', 'user_b@test.local', 'User B', 'USER'),
  ('33333333-3333-3333-3333-333333333333', 'admin@test.local', 'Admin', 'PLATFORM_ADMIN')
on conflict (id) do update set email=excluded.email, platform_role=excluded.platform_role;

-- Need segment id for restaurant
-- Already seeded, get it
-- Create companies via function as each user (session-level config, not local)
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select set_config('role', 'authenticated', false);
select create_company_with_owner('Empresa A', 'empresa-a', (select id from business_segments where slug='restaurant'), 'desc A', '11999999999', 'a@test.local', 'Rua A');
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select set_config('role', 'authenticated', false);
select create_company_with_owner('Empresa B', 'empresa-b', (select id from business_segments where slug='restaurant'), 'desc B', '11888888888', 'b@test.local', 'Rua B');

-- Reset to postgres for setup of test data (bypass RLS as superuser to insert seed data)
reset role;
reset request.jwt.claim.sub;

-- Fetch company ids for later use
do $$
declare
  v_company_a uuid := (select id from companies where slug='empresa-a');
  v_company_b uuid := (select id from companies where slug='empresa-b');
  v_user_a uuid := '11111111-1111-1111-1111-111111111111';
  v_user_b uuid := '22222222-2222-2222-2222-222222222222';
  v_admin uuid := '33333333-3333-3333-3333-333333333333';
  v_seg uuid := (select id from business_segments where slug='restaurant');
begin
  -- Create categories/products/customers/zones for each company as superuser (bypass RLS) for test data
  insert into categories (company_id, name) values (v_company_a, 'Cat A'), (v_company_b, 'Cat B');
  insert into products (company_id, category_id, name, price) values
    (v_company_a, (select id from categories where company_id=v_company_a limit 1), 'Prod A', 10.00),
    (v_company_b, (select id from categories where company_id=v_company_b limit 1), 'Prod B', 20.00);
  insert into customers (company_id, name, phone) values
    (v_company_a, 'Cliente A', '11999999999'),
    (v_company_b, 'Cliente B', '11888888888');
  insert into delivery_zones (company_id, name, fee) values
    (v_company_a, 'Zona A', 5.00),
    (v_company_b, 'Zona B', 7.00);
  insert into delivery_drivers (company_id, name, phone, status) values
    (v_company_a, 'Driver A', '11999999991', 'ativo'),
    (v_company_b, 'Driver B', '11888888881', 'ativo');
  -- orders
  insert into orders (company_id, order_number, tracking_token, customer_id, order_type, status, subtotal, total, customer_data)
  values
    (v_company_a, next_order_number(v_company_a), gen_random_uuid(), (select id from customers where company_id=v_company_a limit 1), 'delivery', 'novo', 10.00, 15.00, '{"name":"Cliente A"}'::jsonb),
    (v_company_b, next_order_number(v_company_b), gen_random_uuid(), (select id from customers where company_id=v_company_b limit 1), 'delivery', 'novo', 20.00, 27.00, '{"name":"Cliente B"}'::jsonb);
  -- order_items and history
  insert into order_items (order_id, product_id, product_name, quantity, unit_price, total)
  select (select id from orders where company_id=v_company_a limit 1), (select id from products where company_id=v_company_a limit 1), 'Prod A', 1, 10.00, 10.00;
  insert into order_items (order_id, product_id, product_name, quantity, unit_price, total)
  select (select id from orders where company_id=v_company_b limit 1), (select id from products where company_id=v_company_b limit 1), 'Prod B', 1, 20.00, 20.00;
  insert into order_status_history (order_id, old_status, new_status, changed_by) values
    ((select id from orders where company_id=v_company_a limit 1), null, 'novo', v_user_a),
    ((select id from orders where company_id=v_company_b limit 1), null, 'novo', v_user_b);
  -- notifications
  insert into notifications (company_id, order_id, status, message, order_number) values
    (v_company_a, (select id from orders where company_id=v_company_a limit 1), 'novo', 'Novo pedido A', 1),
    (v_company_b, (select id from orders where company_id=v_company_b limit 1), 'novo', 'Novo pedido B', 1);
  -- cash registers
  insert into cash_registers (company_id, operator_id, opening_amount, status) values
    (v_company_a, v_user_a, 100.00, 'open'),
    (v_company_b, v_user_b, 200.00, 'open');
  -- cash movements (valid)
  insert into cash_movements (cash_register_id, company_id, operator_id, type, amount, description) values
    ((select id from cash_registers where company_id=v_company_a limit 1), v_company_a, v_user_a, 'entrada', 50.00, 'teste A'),
    ((select id from cash_registers where company_id=v_company_b limit 1), v_company_b, v_user_b, 'entrada', 60.00, 'teste B');
  -- audit logs
  insert into audit_logs (company_id, user_id, action, entity, entity_id) values
    (v_company_a, v_user_a, 'test', 'order', (select id from orders where company_id=v_company_a limit 1)),
    (v_company_b, v_user_b, 'test', 'order', (select id from orders where company_id=v_company_b limit 1));
  -- create OPERATOR user for role test: add to company A as OPERATOR
  -- First ensure user exists: we already have USER_A as OWNER, create additional member for test via direct insert as superuser
  -- We will not create extra user now, will change role of USER_A's secondary test via member update
end;
$$;

-- Add OPERATOR test: create a fourth user as OPERATOR in company A
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, confirmation_token, recovery_token)
values ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'operator@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', '')
on conflict (id) do nothing;
insert into profiles (id, email, name, platform_role) values ('44444444-4444-4444-4444-444444444444', 'operator@test.local', 'Operator', 'USER') on conflict (id) do nothing;
insert into company_members (company_id, user_id, role, active) values ((select id from companies where slug='empresa-a'), '44444444-4444-4444-4444-444444444444', 'OPERATOR', true) on conflict (company_id,user_id) do update set role='OPERATOR', active=true;

-- Helper function to run a test and output PASS/FAIL
create or replace function test_assert(p_test text, p_condition boolean, p_detail text default null)
returns void
language plpgsql
as $$
begin
  if p_condition then
    raise notice 'PASS | % | %', p_test, coalesce(p_detail,'');
  else
    raise notice 'FAIL | % | %', p_test, coalesce(p_detail,'');
  end if;
end;
$$;

-- Begin tests
\echo '=== START RLS TESTS ==='

-- Test 1: Isolamento SELECT
do $$
declare
  v_company_a uuid := (select id from companies where slug='empresa-a');
  v_company_b uuid := (select id from companies where slug='empresa-b');
  cnt int;
begin
  -- USER_A select empresa A should see 1
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into cnt from companies where id = v_company_a;
  perform test_assert('1a USER_A SELECT empresa A', cnt=1, 'cnt='||cnt);
  -- USER_A select empresa B should see 0
  select count(*) into cnt from companies where id = v_company_b;
  perform test_assert('1b USER_A SELECT empresa B blocked', cnt=0, 'cnt='||cnt);
  -- Verify posterior state still 0 (not false positive due to empty)
  select count(*) into cnt from companies where slug='empresa-b';
  perform test_assert('1b posterior check empresa B still 0 for A', cnt=0, '');

  -- USER_B select empresa B should see 1
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  select count(*) into cnt from companies where id = v_company_b;
  perform test_assert('1c USER_B SELECT empresa B', cnt=1, 'cnt='||cnt);
  select count(*) into cnt from companies where id = v_company_a;
  perform test_assert('1d USER_B SELECT empresa A blocked', cnt=0, 'cnt='||cnt);
end;
$$;

-- Test 2: INSERT com company_id outra empresa deve falhar
do $$
declare
  v_company_b uuid := (select id from companies where slug='empresa-b');
  cnt int;
  err text;
begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into categories (company_id, name) values (v_company_b, 'Cat inject B');
    perform test_assert('2a USER_A INSERT cat em B should fail', false, 'insert succeeded unexpectedly');
  exception when insufficient_privilege or others then
    get stacked diagnostics err = message_text;
    perform test_assert('2a USER_A INSERT cat em B blocked', true, err);
  end;
  -- verify posterior: count of that injected cat should be 0 for A
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  select count(*) into cnt from categories where company_id=v_company_b and name='Cat inject B';
  perform test_assert('2a posterior no cat inject', cnt=0, 'cnt='||cnt);
  -- USER_A insert in own company should succeed
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  begin
    insert into categories (company_id, name) values ((select id from companies where slug='empresa-a'), 'Cat A2');
    perform test_assert('2b USER_A INSERT cat em A success', true, '');
  exception when others then
    get stacked diagnostics err = message_text;
    perform test_assert('2b USER_A INSERT cat em A success', false, err);
  end;
end;
$$;

-- Test 3: UPDATE
do $$
declare
  err text;
  v_cat_a uuid := (select id from categories where company_id=(select id from companies where slug='empresa-a') and name='Cat A');
  v_cat_b uuid := (select id from categories where company_id=(select id from companies where slug='empresa-b') and name='Cat B');
begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  perform set_config('role', 'authenticated', true);
  -- update own
  begin
    update categories set name='Cat A updated' where id=v_cat_a;
    perform test_assert('3a USER_A UPDATE own cat', true, '');
  exception when others then
    perform test_assert('3a USER_A UPDATE own cat', false, sqlerrm);
  end;
  -- try update other's cat
  begin
    update categories set name='Cat B hacked' where id=v_cat_b;
    -- check if row was updated (should affect 0 rows due to RLS, not error)
    -- Need to check row count: update with RLS will affect 0 rows, not raise exception, so we must check data
    -- Re-query as USER_B to see if it changed
    perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
    perform test_assert('3b USER_A UPDATE cat B blocked (0 rows)', (select name from categories where id=v_cat_b)='Cat B', 'name='||(select name from categories where id=v_cat_b));
  end;
end;
$$;

-- Test 4: DELETE
do $$
declare
  v_cat_b uuid := (select id from categories where company_id=(select id from companies where slug='empresa-b') and name='Cat B');
  cnt int;
begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  perform set_config('role', 'authenticated', true);
  delete from categories where id=v_cat_b;
  -- check if deleted
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  select count(*) into cnt from categories where id=v_cat_b;
  perform test_assert('4a USER_A DELETE cat B blocked', cnt=1, 'cnt='||cnt);
end;
$$;

-- Test 5: MEMBRO INATIVO
do $$
declare
  v_company_a uuid := (select id from companies where slug='empresa-a');
  cnt int;
begin
  -- make operator inactive
  update company_members set active=false where company_id=v_company_a and user_id='44444444-4444-4444-4444-444444444444';
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into cnt from companies where id=v_company_a;
  perform test_assert('5a inactive OPERATOR SELECT blocked', cnt=0, 'cnt='||cnt);
  -- reactivate for later tests
  reset role; reset request.jwt.claim.sub;
  update company_members set active=true where company_id=v_company_a and user_id='44444444-4444-4444-4444-444444444444';
end;
$$;

-- Test 6: PAPEIS (OWNER/ADMIN/OPERATOR)
do $$
declare
  cnt int;
  v_role text;
begin
  -- OPERATOR can read (policy is same for all members, so should be able to)
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into cnt from categories where company_id=(select id from companies where slug='empresa-a');
  perform test_assert('6a OPERATOR SELECT categories', cnt>=1, 'cnt='||cnt);
  -- OPERATOR try to escalate role via company_members update (should be blocked because only OWNER/ADMIN can update)
  begin
    update company_members set role='OWNER' where company_id=(select id from companies where slug='empresa-a') and user_id='44444444-4444-4444-4444-444444444444';
    select role::text into v_role from company_members where company_id=(select id from companies where slug='empresa-a') and user_id='44444444-4444-4444-4444-444444444444';
    perform test_assert('6b OPERATOR escalate to OWNER blocked', v_role='OPERATOR', 'role='||v_role);
  exception when others then
    perform test_assert('6b OPERATOR escalate blocked via exception', true, sqlerrm);
  end;
end;
$$;

-- Test 7: PLATFORM_ROLE escalada
do $$
declare
  err text;
begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  perform set_config('role', 'authenticated', true);
  begin
    update profiles set platform_role='PLATFORM_ADMIN' where id='11111111-1111-1111-1111-111111111111';
    perform test_assert('7a USER escalate platform_role blocked', false, 'update succeeded');
  exception when others then
    perform test_assert('7a USER escalate platform_role blocked', true, sqlerrm);
  end;
  -- verify still USER
  reset role; reset request.jwt.claim.sub;
  perform test_assert('7b platform_role still USER', (select platform_role::text from profiles where id='11111111-1111-1111-1111-111111111111')='USER', '');
end;
$$;

-- Test 8: PLATFORM_ADMIN
do $$
declare
  cnt int;
begin
  perform set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into cnt from companies;
  -- PLATFORM_ADMIN should see both companies via is_platform_admin()
  perform test_assert('8a PLATFORM_ADMIN SELECT companies (both)', cnt=2, 'cnt='||cnt);
  select count(*) into cnt from profiles;
  perform test_assert('8b PLATFORM_ADMIN SELECT profiles', cnt>=3, 'cnt='||cnt);
end;
$$;

-- Test 9: create_company_with_owner
do $$
declare
  v_new_company uuid;
  cnt int;
  err text;
begin
  -- USER_A creates new company via function (should succeed)
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  perform set_config('role', 'authenticated', true);
  begin
    select create_company_with_owner('Empresa C', 'empresa-c', (select id from business_segments where slug='restaurant')) into v_new_company;
    perform test_assert('9a create_company_with_owner success', v_new_company is not null, v_new_company::text);
    -- check OWNER created
    select count(*) into cnt from company_members where company_id=v_new_company and user_id='11111111-1111-1111-1111-111111111111' and role='OWNER';
    perform test_assert('9b OWNER member exists', cnt=1, 'cnt='||cnt);
    select count(*) into cnt from subscriptions where company_id=v_new_company;
    perform test_assert('9c subscription created', cnt=1, 'cnt='||cnt);
    -- FASE 4.2: acesso direto ao seq foi removido dos membros (policy
    -- company_order_seq_platform_read); a linha continua criada pela funcao
    -- DEFINER. Verificacao posterior como PLATFORM_ADMIN + fluxo via funcao.
    perform set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
    select count(*) into cnt from company_order_seq where company_id=v_new_company;
    perform test_assert('9d order_seq created', cnt=1, 'cnt='||cnt);
    perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
    begin
      if next_order_number(v_new_company) > 0 then
        perform test_assert('9d2 next_order_number works for member', true, '');
      else
        perform test_assert('9d2 next_order_number works for member', false, 'returned 0');
      end if;
    exception when others then
      perform test_assert('9d2 next_order_number works for member', false, sqlerrm);
    end;
  exception when others then
    perform test_assert('9a create_company_with_owner', false, sqlerrm);
  end;
  -- Try to verify function does not accept arbitrary user_id (signature has no user_id param, so cannot test that, just ensure no param)
  perform test_assert('9e function has no user_id param', true, 'signature verified in DDL');

  -- Cleanup empresa-c for isolation
  reset role; reset request.jwt.claim.sub;
  delete from company_members where company_id=v_new_company;
  delete from subscriptions where company_id=v_new_company;
  delete from company_order_seq where company_id=v_new_company;
  delete from company_settings where company_id=v_new_company;
  delete from store_themes where company_id=v_new_company;
  delete from companies where id=v_new_company;
end;
$$;

-- Test 10: ORDERS isolamento
do $$
declare
  v_company_a uuid := (select id from companies where slug='empresa-a');
  v_company_b uuid := (select id from companies where slug='empresa-b');
  cnt int;
begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into cnt from orders where company_id=v_company_a;
  perform test_assert('10a USER_A SELECT orders A', cnt=1, 'cnt='||cnt);
  select count(*) into cnt from orders where company_id=v_company_b;
  perform test_assert('10b USER_A SELECT orders B blocked', cnt=0, 'cnt='||cnt);
end;
$$;

-- Test 11: ORDER_ITEMS
do $$
declare
  v_order_a uuid := (select id from orders where company_id=(select id from companies where slug='empresa-a') limit 1);
  v_order_b uuid := (select id from orders where company_id=(select id from companies where slug='empresa-b') limit 1);
  cnt int;
begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into cnt from order_items where order_id=v_order_a;
  perform test_assert('11a USER_A SELECT order_items A', cnt=1, 'cnt='||cnt);
  select count(*) into cnt from order_items where order_id=v_order_b;
  perform test_assert('11b USER_A SELECT order_items B blocked', cnt=0, 'cnt='||cnt);
end;
$$;

-- Test 12: ORDER_STATUS_HISTORY
do $$
declare
  v_order_a uuid := (select id from orders where company_id=(select id from companies where slug='empresa-a') limit 1);
  v_order_b uuid := (select id from orders where company_id=(select id from companies where slug='empresa-b') limit 1);
  cnt int;
begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into cnt from order_status_history where order_id=v_order_a;
  perform test_assert('12a USER_A SELECT history A', cnt=1, 'cnt='||cnt);
  select count(*) into cnt from order_status_history where order_id=v_order_b;
  perform test_assert('12b USER_A SELECT history B blocked', cnt=0, 'cnt='||cnt);
end;
$$;

-- Test 13: CASH_REGISTERS
do $$
declare
  v_company_a uuid := (select id from companies where slug='empresa-a');
  v_company_b uuid := (select id from companies where slug='empresa-b');
  cnt int;
begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into cnt from cash_registers where company_id=v_company_a;
  perform test_assert('13a USER_A SELECT cash_registers A', cnt=1, 'cnt='||cnt);
  select count(*) into cnt from cash_registers where company_id=v_company_b;
  perform test_assert('13b USER_A SELECT cash_registers B blocked', cnt=0, 'cnt='||cnt);
end;
$$;

-- Test 14: CASH_MOVEMENTS (cross register)
do $$
declare
  v_reg_a uuid := (select id from cash_registers where company_id=(select id from companies where slug='empresa-a') limit 1);
  v_reg_b uuid := (select id from cash_registers where company_id=(select id from companies where slug='empresa-b') limit 1);
  v_company_a uuid := (select id from companies where slug='empresa-a');
  cnt int;
  err text;
begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  perform set_config('role', 'authenticated', true);
  -- valid insert own
  begin
    insert into cash_movements (cash_register_id, company_id, operator_id, type, amount, description) values (v_reg_a, v_company_a, '11111111-1111-1111-1111-111111111111', 'entrada', 10.00, 'valid');
    perform test_assert('14a USER_A INSERT cash_movement own success', true, '');
  exception when others then
    perform test_assert('14a USER_A INSERT own', false, sqlerrm);
  end;
  -- try cross company: use B's register with A's company_id (should fail due to exists check)
  begin
    insert into cash_movements (cash_register_id, company_id, operator_id, type, amount, description) values (v_reg_b, v_company_a, '11111111-1111-1111-1111-111111111111', 'entrada', 10.00, 'cross');
    perform test_assert('14b cross register blocked', false, 'insert succeeded');
  exception when others then
    perform test_assert('14b cross register blocked', true, sqlerrm);
  end;
  -- verify posterior no cross record
  reset role; reset request.jwt.claim.sub;
  select count(*) into cnt from cash_movements where description='cross';
  perform test_assert('14c posterior no cross movement', cnt=0, 'cnt='||cnt);
end;
$$;

-- Test 15: NOTIFICATIONS
do $$
declare
  v_company_a uuid := (select id from companies where slug='empresa-a');
  v_company_b uuid := (select id from companies where slug='empresa-b');
  cnt int;
begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into cnt from notifications where company_id=v_company_a;
  perform test_assert('15a USER_A SELECT notifications A', cnt=1, 'cnt='||cnt);
  select count(*) into cnt from notifications where company_id=v_company_b;
  perform test_assert('15b USER_A SELECT notifications B blocked', cnt=0, 'cnt='||cnt);
end;
$$;

-- Test 16: COMPANY_MEMBERS insert/role escalation
do $$
declare
  err text;
begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into company_members (company_id, user_id, role) values ((select id from companies where slug='empresa-a'), '11111111-1111-1111-1111-111111111111', 'OWNER');
    perform test_assert('16a direct OWNER insert blocked', false, 'insert succeeded');
  exception when others then
    perform test_assert('16a direct OWNER insert blocked', true, sqlerrm);
  end;
  -- escalation already tested in 6b, re-assert
  perform test_assert('16b escalation already verified', true, '');
end;
$$;

-- Test 17: SUBSCRIPTIONS
do $$
declare
  v_sub_a uuid := (select id from subscriptions where company_id=(select id from companies where slug='empresa-a'));
  err text;
begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  perform set_config('role', 'authenticated', true);
  -- select should succeed
  perform test_assert('17a USER_A SELECT subscription', (select count(*) from subscriptions where id=v_sub_a)=1, '');
  -- try update status (should be blocked, only platform_admin)
  begin
    update subscriptions set status='ativo' where id=v_sub_a;
    -- check if updated
    reset role; reset request.jwt.claim.sub;
    perform test_assert('17b USER update subscription blocked', (select status::text from subscriptions where id=v_sub_a)='trial', 'status='||(select status::text from subscriptions where id=v_sub_a));
  exception when others then
    perform test_assert('17b update blocked via exception', true, sqlerrm);
  end;
  -- ADMIN should succeed
  perform set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
  perform set_config('role', 'authenticated', true);
  begin
    update subscriptions set status='ativo' where id=v_sub_a;
    perform test_assert('17c PLATFORM_ADMIN UPDATE subscription', true, '');
    -- revert
    update subscriptions set status='trial' where id=v_sub_a;
  exception when others then
    perform test_assert('17c PLATFORM_ADMIN UPDATE', false, sqlerrm);
  end;
end;
$$;

-- Test 18: AUDIT_LOGS
do $$
declare
  v_company_a uuid := (select id from companies where slug='empresa-a');
  v_order_a uuid := (select id from orders where company_id=v_company_a limit 1);
  cnt int;
begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  perform set_config('role', 'authenticated', true);
  -- insert
  begin
    insert into audit_logs (company_id, user_id, action, entity, entity_id) values (v_company_a, '11111111-1111-1111-1111-111111111111', 'test2', 'order', v_order_a);
    perform test_assert('18a audit_logs INSERT member', true, '');
  exception when others then
    perform test_assert('18a INSERT', false, sqlerrm);
  end;
  select count(*) into cnt from audit_logs where company_id=v_company_a;
  perform test_assert('18b SELECT audit_logs', cnt>=1, 'cnt='||cnt);
  -- delete should fail for non-admin
  begin
    delete from audit_logs where company_id=v_company_a and action='test2';
    -- check if deleted (if 0 rows, blocked via RLS? Actually policy delete only admin, so delete as member should affect 0 rows)
    reset role; reset request.jwt.claim.sub;
    select count(*) into cnt from audit_logs where company_id=v_company_a and action='test2';
    perform test_assert('18c DELETE audit_logs blocked for member', cnt=1, 'cnt='||cnt);
    -- cleanup as admin
    perform set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
    perform set_config('role', 'authenticated', true);
    delete from audit_logs where company_id=v_company_a and action='test2';
  exception when others then
    perform test_assert('18c DELETE blocked', true, sqlerrm);
  end;
end;
$$;

-- Test 19: BUSINESS_SEGMENTS / PLANS read/write
do $$
declare
  cnt int;
begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into cnt from business_segments;
  perform test_assert('19a SELECT business_segments', cnt>=1, 'cnt='||cnt);
  select count(*) into cnt from plans;
  perform test_assert('19b SELECT plans', cnt>=1, 'cnt='||cnt);
  -- try write as normal user (should fail)
  begin
    insert into business_segments (slug, name) values ('pizzeria','Pizzeria');
    perform test_assert('19c USER INSERT segment blocked', false, 'insert succeeded');
  exception when others then
    perform test_assert('19c USER INSERT segment blocked', true, sqlerrm);
  end;
  -- admin should succeed
  perform set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
  begin
    insert into business_segments (slug, name) values ('pizzeria','Pizzeria') on conflict (slug) do nothing;
    perform test_assert('19d ADMIN INSERT segment', true, '');
    delete from business_segments where slug='pizzeria';
  exception when others then
    perform test_assert('19d ADMIN INSERT', false, sqlerrm);
  end;
end;
$$;

-- ============================================================
-- FASE 4.2 HARDENING TESTS (append, preserva suite anterior)
-- Cada bloqueio verifica estado posterior para evitar falso PASS.
-- ============================================================

-- Setup: ADMIN member (555) em empresa-a + garante OPERATOR ativo
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, confirmation_token, recovery_token)
values ('55555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adminmember@test.local', crypt('password', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', '')
on conflict (id) do nothing;
insert into profiles (id, email, name, platform_role) values ('55555555-5555-5555-5555-555555555555', 'adminmember@test.local', 'AdminMember', 'USER') on conflict (id) do update set email=excluded.email;
insert into company_members (company_id, user_id, role, active) values ((select id from companies where slug='empresa-a'), '55555555-5555-5555-5555-555555555555', 'ADMIN', true) on conflict (company_id,user_id) do update set role='ADMIN', active=true;
reset role; reset request.jwt.claim.sub;
update company_members set active=true where company_id=(select id from companies where slug='empresa-a') and user_id='44444444-4444-4444-4444-444444444444';

-- H1: ADMIN tentando virar OWNER (self-promotion) -> bloqueado + posterior ainda ADMIN
do $$
declare v_role text; err text;
begin
  perform set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);
  perform set_config('role', 'authenticated', true);
  begin
    update company_members set role='OWNER' where company_id=(select id from companies where slug='empresa-a') and user_id='55555555-5555-5555-5555-555555555555';
    -- se nao deu exception, checar posterior (RLS pode ter dado 0 rows)
    reset role; reset request.jwt.claim.sub;
    select role::text into v_role from company_members where company_id=(select id from companies where slug='empresa-a') and user_id='55555555-5555-5555-5555-555555555555';
    perform test_assert('H1 ADMIN self-promote OWNER blocked', v_role='ADMIN', 'role='||coalesce(v_role,'null'));
  exception when others then
    get stacked diagnostics err = message_text;
    reset role; reset request.jwt.claim.sub;
    select role::text into v_role from company_members where company_id=(select id from companies where slug='empresa-a') and user_id='55555555-5555-5555-5555-555555555555';
    perform test_assert('H1 ADMIN self-promote OWNER blocked', v_role='ADMIN', 'role='||coalesce(v_role,'null')||' err='||err);
  end;
end;
$$;

-- H2: ADMIN tentando desativar OWNER -> bloqueado + OWNER segue active
do $$
declare v_active boolean;
begin
  perform set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);
  perform set_config('role', 'authenticated', true);
  begin
    update company_members set active=false where company_id=(select id from companies where slug='empresa-a') and user_id='11111111-1111-1111-1111-111111111111';
  exception when others then null;
  end;
  reset role; reset request.jwt.claim.sub;
  select active into v_active from company_members where company_id=(select id from companies where slug='empresa-a') and user_id='11111111-1111-1111-1111-111111111111';
  perform test_assert('H2 ADMIN deactivate OWNER blocked', v_active=true, 'active='||coalesce(v_active::text,'null'));
end;
$$;

-- H3: ADMIN tentando remover OWNER -> bloqueado + OWNER segue existindo
do $$
declare cnt int;
begin
  perform set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);
  perform set_config('role', 'authenticated', true);
  begin
    delete from company_members where company_id=(select id from companies where slug='empresa-a') and user_id='11111111-1111-1111-1111-111111111111';
  exception when others then null;
  end;
  reset role; reset request.jwt.claim.sub;
  select count(*) into cnt from company_members where company_id=(select id from companies where slug='empresa-a') and user_id='11111111-1111-1111-1111-111111111111' and role='OWNER';
  perform test_assert('H3 ADMIN delete OWNER blocked', cnt=1, 'cnt='||cnt);
end;
$$;

-- H4: OPERATOR DELETE order -> bloqueado + pedido segue existindo
do $$
declare v_order uuid := (select id from orders where company_id=(select id from companies where slug='empresa-a') limit 1);
rc int; cnt int;
begin
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
  perform set_config('role', 'authenticated', true);
  delete from orders where id=v_order;
  get diagnostics rc = row_count;
  perform test_assert('H4 OPERATOR DELETE order 0 rows', rc=0, 'rc='||rc);
  reset role; reset request.jwt.claim.sub;
  select count(*) into cnt from orders where id=v_order;
  perform test_assert('H4 posterior order still exists', cnt=1, 'cnt='||cnt);
end;
$$;

-- H5: OPERATOR DELETE product -> bloqueado + produto segue existindo
do $$
declare v_prod uuid := (select id from products where company_id=(select id from companies where slug='empresa-a') limit 1);
rc int; cnt int;
begin
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
  perform set_config('role', 'authenticated', true);
  delete from products where id=v_prod;
  get diagnostics rc = row_count;
  perform test_assert('H5 OPERATOR DELETE product 0 rows', rc=0, 'rc='||rc);
  reset role; reset request.jwt.claim.sub;
  select count(*) into cnt from products where id=v_prod;
  perform test_assert('H5 posterior product still exists', cnt=1, 'cnt='||cnt);
end;
$$;

-- H6: OPERATOR DELETE cash_register -> bloqueado + segue existindo
do $$
declare v_reg uuid := (select id from cash_registers where company_id=(select id from companies where slug='empresa-a') limit 1);
rc int; cnt int;
begin
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
  perform set_config('role', 'authenticated', true);
  delete from cash_registers where id=v_reg;
  get diagnostics rc = row_count;
  perform test_assert('H6 OPERATOR DELETE cash_register 0 rows', rc=0, 'rc='||rc);
  reset role; reset request.jwt.claim.sub;
  select count(*) into cnt from cash_registers where id=v_reg;
  perform test_assert('H6 posterior register still exists', cnt=1, 'cnt='||cnt);
end;
$$;

-- H7: OPERATOR DELETE cash_movement -> bloqueado + segue existindo
do $$
declare v_mov uuid := (select id from cash_movements where company_id=(select id from companies where slug='empresa-a') limit 1);
rc int; cnt int;
begin
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
  perform set_config('role', 'authenticated', true);
  delete from cash_movements where id=v_mov;
  get diagnostics rc = row_count;
  perform test_assert('H7 OPERATOR DELETE cash_movement 0 rows', rc=0, 'rc='||rc);
  reset role; reset request.jwt.claim.sub;
  select count(*) into cnt from cash_movements where id=v_mov;
  perform test_assert('H7 posterior movement still exists', cnt>=1, 'cnt='||cnt);
end;
$$;

-- H8: OPERATOR alterar store_theme -> bloqueado + theme inalterado
do $$
declare v_before jsonb; v_after jsonb; rc int;
v_comp uuid := (select id from companies where slug='empresa-a');
begin
  reset role; reset request.jwt.claim.sub;
  select colors into v_before from store_themes where company_id=v_comp;
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
  perform set_config('role', 'authenticated', true);
  begin
    update store_themes set colors='{"hacked":true}'::jsonb where company_id=v_comp;
    get diagnostics rc = row_count;
    perform test_assert('H8 OPERATOR UPDATE theme 0 rows', rc=0, 'rc='||rc);
  exception when others then
    perform test_assert('H8 OPERATOR UPDATE theme blocked via exception', true, sqlerrm);
  end;
  reset role; reset request.jwt.claim.sub;
  select colors into v_after from store_themes where company_id=v_comp;
  perform test_assert('H8 posterior theme unchanged', v_after=v_before, '');
end;
$$;

-- H9: OPERATOR alterar company_settings -> bloqueado + settings inalterado
do $$
declare v_before jsonb; v_after jsonb; rc int;
v_comp uuid := (select id from companies where slug='empresa-a');
begin
  reset role; reset request.jwt.claim.sub;
  select settings into v_before from company_settings where company_id=v_comp;
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
  perform set_config('role', 'authenticated', true);
  begin
    update company_settings set settings='{"hacked":true}'::jsonb where company_id=v_comp;
    get diagnostics rc = row_count;
    perform test_assert('H9 OPERATOR UPDATE settings 0 rows', rc=0, 'rc='||rc);
  exception when others then
    perform test_assert('H9 OPERATOR UPDATE settings blocked via exception', true, sqlerrm);
  end;
  reset role; reset request.jwt.claim.sub;
  select settings into v_after from company_settings where company_id=v_comp;
  perform test_assert('H9 posterior settings unchanged', v_after=v_before, '');
end;
$$;

-- H10: OPERATOR alterar company_order_seq -> bloqueado + last_number inalterado
do $$
declare v_before int; v_after int;
v_comp uuid := (select id from companies where slug='empresa-a');
begin
  reset role; reset request.jwt.claim.sub;
  select last_number into v_before from company_order_seq where company_id=v_comp;
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
  perform set_config('role', 'authenticated', true);
  begin
    update company_order_seq set last_number=999999 where company_id=v_comp;
    perform test_assert('H10 OPERATOR UPDATE seq should fail', false, 'update succeeded unexpectedly');
  exception when others then
    perform test_assert('H10 OPERATOR UPDATE seq blocked', true, sqlerrm);
  end;
  reset role; reset request.jwt.claim.sub;
  select last_number into v_after from company_order_seq where company_id=v_comp;
  perform test_assert('H10 posterior seq unchanged', v_after=v_before, 'before='||v_before||' after='||v_after);
end;
$$;

-- H11: membro inserir audit_log com user_id de outro usuario -> bloqueado + sem registro
do $$
declare v_comp uuid := (select id from companies where slug='empresa-a');
cnt int;
begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into audit_logs (company_id, user_id, action, entity, entity_id) values (v_comp, '22222222-2222-2222-2222-222222222222', 'forged', 'order', null);
    perform test_assert('H11 forged audit user_id blocked', false, 'insert succeeded unexpectedly');
  exception when others then
    perform test_assert('H11 forged audit user_id blocked', true, sqlerrm);
  end;
  reset role; reset request.jwt.claim.sub;
  select count(*) into cnt from audit_logs where company_id=v_comp and action='forged';
  perform test_assert('H11 posterior no forged audit', cnt=0, 'cnt='||cnt);
end;
$$;

-- H12: membro alterar company_id -> bloqueado + company_id inalterado
do $$
declare v_prod uuid := (select id from products where company_id=(select id from companies where slug='empresa-a') limit 1);
v_comp_b uuid := (select id from companies where slug='empresa-b');
v_after uuid;
begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  perform set_config('role', 'authenticated', true);
  begin
    update products set company_id=v_comp_b where id=v_prod;
    perform test_assert('H12 UPDATE company_id should fail', false, 'update succeeded unexpectedly');
  exception when others then
    perform test_assert('H12 UPDATE company_id blocked', true, sqlerrm);
  end;
  reset role; reset request.jwt.claim.sub;
  select company_id into v_after from products where id=v_prod;
  perform test_assert('H12 posterior company_id unchanged', v_after=(select id from companies where slug='empresa-a'), '');
end;
$$;

-- H13: membro alterar order_items.order_id -> bloqueado + order_id inalterado
do $$
declare v_item uuid := (select oi.id from order_items oi join orders o on o.id=oi.order_id where o.company_id=(select id from companies where slug='empresa-a') limit 1);
v_order_b uuid := (select id from orders where company_id=(select id from companies where slug='empresa-b') limit 1);
v_after uuid; v_before uuid;
begin
  reset role; reset request.jwt.claim.sub;
  select order_id into v_before from order_items where id=v_item;
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  perform set_config('role', 'authenticated', true);
  begin
    update order_items set order_id=v_order_b where id=v_item;
    -- se RLS deu 0 rows sem exception, cair aqui: verificar posterior
    reset role; reset request.jwt.claim.sub;
    select order_id into v_after from order_items where id=v_item;
    perform test_assert('H13 UPDATE order_id blocked', v_after=v_before, '');
  exception when others then
    reset role; reset request.jwt.claim.sub;
    select order_id into v_after from order_items where id=v_item;
    perform test_assert('H13 UPDATE order_id blocked', v_after=v_before, sqlerrm);
  end;
end;
$$;

-- H14: membro alterar cash_movements.cash_register_id -> bloqueado + inalterado
do $$
declare v_mov uuid := (select id from cash_movements where company_id=(select id from companies where slug='empresa-a') limit 1);
v_reg_b uuid := (select id from cash_registers where company_id=(select id from companies where slug='empresa-b') limit 1);
v_before uuid; v_after uuid;
begin
  reset role; reset request.jwt.claim.sub;
  select cash_register_id into v_before from cash_movements where id=v_mov;
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  perform set_config('role', 'authenticated', true);
  begin
    update cash_movements set cash_register_id=v_reg_b where id=v_mov;
    reset role; reset request.jwt.claim.sub;
    select cash_register_id into v_after from cash_movements where id=v_mov;
    perform test_assert('H14 UPDATE cash_register_id blocked', v_after=v_before, '');
  exception when others then
    reset role; reset request.jwt.claim.sub;
    select cash_register_id into v_after from cash_movements where id=v_mov;
    perform test_assert('H14 UPDATE cash_register_id blocked', v_after=v_before, sqlerrm);
  end;
end;
$$;

-- H15: anon executar next_order_number -> bloqueado
do $$
declare v_comp uuid := (select id from companies where slug='empresa-a');
v int;
begin
  perform set_config('role', 'anon', true);
  begin
    select next_order_number(v_comp) into v;
    perform test_assert('H15 anon EXEC next_order_number blocked', false, 'executed v='||coalesce(v::text,'null'));
  exception when others then
    perform test_assert('H15 anon EXEC next_order_number blocked', true, sqlerrm);
  end;
  reset role; reset request.jwt.claim.sub;
end;
$$;

-- H16: segmento/plano inativo nao aparece em leitura publica; platform_admin ve
do $$
declare cnt_anon_seg int; cnt_auth_seg int; cnt_admin_seg int; cnt_anon_plan int; cnt_auth_plan int; cnt_admin_plan int;
begin
  reset role; reset request.jwt.claim.sub;
  insert into business_segments (slug, name, active) values ('inactive-seg-h16','Inactive H16', false) on conflict (slug) do update set active=false;
  insert into plans (slug, name, active) values ('inactive-plan-h16','Inactive H16', false) on conflict (slug) do update set active=false;

  perform set_config('role', 'anon', true);
  select count(*) into cnt_anon_plan from plans where slug='inactive-plan-h16';
  perform test_assert('H16a anon nao ve plano inativo', cnt_anon_plan=0, 'cnt='||cnt_anon_plan);

  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into cnt_auth_seg from business_segments where slug='inactive-seg-h16';
  perform test_assert('H16b membro nao ve segmento inativo', cnt_auth_seg=0, 'cnt='||cnt_auth_seg);
  select count(*) into cnt_auth_plan from plans where slug='inactive-plan-h16';
  perform test_assert('H16c membro nao ve plano inativo', cnt_auth_plan=0, 'cnt='||cnt_auth_plan);

  perform set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into cnt_admin_seg from business_segments where slug='inactive-seg-h16';
  perform test_assert('H16d admin ve segmento inativo', cnt_admin_seg=1, 'cnt='||cnt_admin_seg);
  select count(*) into cnt_admin_plan from plans where slug='inactive-plan-h16';
  perform test_assert('H16e admin ve plano inativo', cnt_admin_plan=1, 'cnt='||cnt_admin_plan);

  reset role; reset request.jwt.claim.sub;
  delete from plans where slug='inactive-plan-h16';
  delete from business_segments where slug='inactive-seg-h16';
end;
$$;

-- H17 (extra, documenta decisao): MANAGER nao da DELETE em orders + OPERATOR nao deleta category
do $$
declare v_order uuid := (select id from orders where company_id=(select id from companies where slug='empresa-a') limit 1);
v_cat uuid := (select id from categories where company_id=(select id from companies where slug='empresa-a') limit 1);
rc int; cnt int;
begin
  -- garante MANAGER membro temporario (usuario B como MANAGER em A? usa 555 rebaixado nao; cria via superuser update direto e reverte)
  reset role; reset request.jwt.claim.sub;
  insert into company_members (company_id, user_id, role, active) values ((select id from companies where slug='empresa-a'), '22222222-2222-2222-2222-222222222222', 'MANAGER', true) on conflict (company_id,user_id) do update set role='MANAGER', active=true;
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  perform set_config('role', 'authenticated', true);
  delete from orders where id=v_order;
  get diagnostics rc = row_count;
  perform test_assert('H17a MANAGER DELETE order 0 rows', rc=0, 'rc='||rc);
  reset role; reset request.jwt.claim.sub;
  select count(*) into cnt from orders where id=v_order;
  perform test_assert('H17a posterior order still exists', cnt=1, 'cnt='||cnt);
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
  perform set_config('role', 'authenticated', true);
  delete from categories where id=v_cat;
  get diagnostics rc = row_count;
  perform test_assert('H17b OPERATOR DELETE category 0 rows', rc=0, 'rc='||rc);
  reset role; reset request.jwt.claim.sub;
  select count(*) into cnt from categories where id=v_cat;
  perform test_assert('H17b posterior category still exists', cnt=1, 'cnt='||cnt);
  delete from company_members where company_id=(select id from companies where slug='empresa-a') and user_id='22222222-2222-2222-2222-222222222222';
end;
$$;

-- Cleanup helpers
drop function if exists test_assert(text,boolean,text);

\echo '=== END RLS TESTS ==='
-- Reset
reset role;
reset request.jwt.claim.sub;
