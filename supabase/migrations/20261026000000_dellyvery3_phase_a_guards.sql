-- DELLVERY 3 — Fase A: guards de segurança (base oficial PROJ).
-- NÃO aplicada em produção/ staging nesta execução (proposta local).
-- NÃO copia migrations de outro clone; mira o estado vigente desta base:
--   manage_order em 20261022000000_category_templates.sql:923 (preservado,
--   sem reaplicação), create_order vigente em 20261025000000 (14 args,
--   intocado nesta fase).
--
-- 1. trg_orders_direct_write_guard: bloqueia UPDATE direto de colunas
--    financeiras/de status quando o autor é o role `authenticated`.
--    Função SECURITY INVOKER de propósito: em DEFINER, current_user seria
--    o owner e o teste nunca dispararia (lição validada em PG isolado).
--    Fluxos legítimos preservados:
--      - manage_order/create_order (SECURITY DEFINER: UPDATEs internos
--        executam como owner → trigger libera);
--      - assignDriver/linkOrderCustomer/linkOrderTable (driver_id, table_id,
--        customer_id, notes, delivery_address continuam atualizáveis).
-- 2. trg_orders_terminal_status: `finalizado` é terminal para TODOS os
--    caminhos (inclusive via RPC) — sem reabertura por status.
--    `cancelado` já era terminal na RPC; direto já cai no guard (1).
-- 3. next_order_number: exige membro da empresa (ou platform admin) quando
--    há usuário autenticado; anon preservado (checkout público via
--    create_order, que valida a empresa pelo slug).

-- =========================
-- 1. Guard de escrita direta em orders
-- =========================
create or replace function guard_orders_direct_write()
returns trigger
language plpgsql
-- INVOKER de propósito (ver cabeçalho).
set search_path = public
as $$
begin
  if current_user = 'authenticated' then
    if (old.company_id is distinct from new.company_id
      or old.order_number is distinct from new.order_number
      or old.tracking_token is distinct from new.tracking_token
      or old.status is distinct from new.status
      or old.payment_status is distinct from new.payment_status
      or old.subtotal is distinct from new.subtotal
      or old.delivery_fee is distinct from new.delivery_fee
      or old.discount is distinct from new.discount
      or old.total is distinct from new.total
      or old.change_for is distinct from new.change_for
      or old.payment_method is distinct from new.payment_method
      or old.cancel_reason is distinct from new.cancel_reason) then
      raise exception 'Use as ações do painel (manage_order) para alterar este pedido';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function guard_orders_direct_write() from public, anon, authenticated;

drop trigger if exists trg_orders_direct_write_guard on public.orders;
create trigger trg_orders_direct_write_guard
  before update on public.orders
  for each row execute function guard_orders_direct_write();

-- =========================
-- 2. Estado terminal não reverte (todos os caminhos)
-- =========================
create or replace function enforce_terminal_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'finalizado' and new.status is distinct from old.status then
    raise exception 'Pedido finalizado não pode ser alterado';
  end if;
  return new;
end;
$$;

revoke all on function enforce_terminal_status() from public, anon, authenticated;

drop trigger if exists trg_orders_terminal_status on public.orders;
create trigger trg_orders_terminal_status
  before update of status on public.orders
  for each row execute function enforce_terminal_status();

-- =========================
-- 3. next_order_number com autorização
-- =========================
create or replace function next_order_number(p_company_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v int;
begin
  -- Checkout anônimo legítimo não tem auth.uid(); membros precisam pertencer
  -- à empresa (ou ser platform admin).
  if auth.uid() is not null
    and not (public.is_company_member(p_company_id) or public.is_platform_admin()) then
    raise exception 'Sem permissão para esta empresa';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_company_id::text));
  insert into public.company_order_seq(company_id, last_number)
    values (p_company_id, 1)
    on conflict (company_id) do update set last_number = public.company_order_seq.last_number + 1, updated_at = now()
    returning last_number into v;
  if v is null then
    select last_number into v from public.company_order_seq where company_id = p_company_id;
  end if;
  return v;
end;
$$;

revoke all on function next_order_number(uuid) from public, anon;
grant execute on function next_order_number(uuid) to authenticated;
