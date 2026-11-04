-- Hardening do módulo Revenda (local only).
-- Execução: Get-Content -Raw supabase/tests/reseller_hardening.sql | docker exec -i supabase_db_dellyvery-3 psql -U postgres -d postgres -v ON_ERROR_STOP=1
-- Cobre: índice único de telefone ativo, transições no banco e rate limit
-- das RPCs públicas. Não substitui rls_resellers.sql (18 asserts de RLS/RPC).

do $$
declare
  v_id uuid;
  v_token text;
  v_n int := 0;
begin
  delete from public.reseller_invites where phone = '5511990000061';
  delete from public.reseller_rpc_rate_limits where bucket = 'resolve:203.0.113.77';

  -- H1: segundo convite ativo para o mesmo telefone é bloqueado pelo índice.
  v_token := replace(gen_random_uuid()::text, '-', '');
  insert into public.reseller_invites (token, name, phone, status)
  values (v_token, 'Hardening H1', '5511990000061', 'criado')
  returning id into v_id;

  begin
    insert into public.reseller_invites (token, name, phone, status)
    values (replace(gen_random_uuid()::text, '-', ''), 'Hardening H1 duplicado', '5511990000061', 'criado');
    raise exception 'FAIL H1: telefone ativo duplicado aceito';
  exception when unique_violation then
    null;
  end;
  v_n := v_n + 1; raise notice 'PASS H1 (%/4)', v_n;

  -- H2: salto criado -> aprovado é bloqueado pelo trigger.
  begin
    update public.reseller_invites set status = 'aprovado' where id = v_id;
    raise exception 'FAIL H2: transição criado -> aprovado aceita';
  exception when others then
    if sqlerrm not ilike '%Transi%inv%lida%' then raise; end if;
  end;
  if (select status from public.reseller_invites where id = v_id) <> 'criado' then
    raise exception 'FAIL H2: status alterado após transição inválida';
  end if;
  v_n := v_n + 1; raise notice 'PASS H2 (%/4)', v_n;

  -- H3: transição válida criado -> enviado continua permitida.
  update public.reseller_invites set status = 'enviado' where id = v_id;
  if (select status from public.reseller_invites where id = v_id) <> 'enviado' then
    raise exception 'FAIL H3: transição válida bloqueada';
  end if;
  v_n := v_n + 1; raise notice 'PASS H3 (%/4)', v_n;

  -- H4: rate limit por IP/hora (a segunda chamada estoura o limite 1).
  perform set_config('request.headers', '{"x-forwarded-for":"203.0.113.77"}', false);
  perform public.consume_reseller_rpc_limit('resolve', 1);
  begin
    perform public.consume_reseller_rpc_limit('resolve', 1);
    raise exception 'FAIL H4: rate limit não bloqueou';
  exception when others then
    if sqlerrm not ilike '%Muitas tentativas%' then raise; end if;
  end;
  perform set_config('request.headers', '{}', false);
  v_n := v_n + 1; raise notice 'PASS H4 (%/4)', v_n;

  delete from public.reseller_invites where phone = '5511990000061';
  delete from public.reseller_rpc_rate_limits where bucket = 'resolve:203.0.113.77';
  raise notice 'ALL PASS (4/4)';
end;
$$;
