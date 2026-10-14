-- DELLVERY 3 — Fechamento de taxas dos entregadores (local only)
--
-- Nenhum modelo de pagamento existia (só driver_notifications, que é log
-- de avisos): tabelas novas, sem tocar em pedidos.
-- driver_payouts: um fechamento por entregador/período, com totais
--   congelados (snapshot) + quem/quando pagou. Histórico nunca apagado
--   pelo fluxo (sem delete no adapter).
-- driver_payout_items: uma linha por entrega com a taxa registrada
--   (snapshot de orders.delivery_fee). UNIQUE(order_id) torna o
--   pagamento duplo impossível no próprio banco.
-- trigger validate_payout_item: elegibilidade no servidor (pedido existe,
--   mesma empresa, mesmo entregador, status finalizado — cancelados e
--   não concluídos nunca entram), independente da interface.
-- RLS: leitura para membros da empresa; escrita para OWNER/ADMIN/MANAGER
--   (mesmo padrão das demais tabelas operacionais).
-- Sem aplicação remota (fora desta etapa).

-- =========================
-- 1. Tabelas
-- =========================
create table if not exists public.driver_payouts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  driver_id uuid not null references public.delivery_drivers(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  status text not null default 'pago',
  total_orders int not null default 0,
  total_fee numeric(10,2) not null default 0,
  paid_amount numeric(10,2) not null default 0,
  created_by uuid,
  paid_by uuid,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint chk_payout_period check (period_start <= period_end),
  constraint chk_payout_totals check (total_orders >= 0 and total_fee >= 0 and paid_amount >= 0),
  constraint chk_payout_status check (status in ('pago'))
);

create index if not exists idx_payouts_company_driver
  on public.driver_payouts (company_id, driver_id);
create index if not exists idx_payouts_company_created
  on public.driver_payouts (company_id, created_at desc);

create table if not exists public.driver_payout_items (
  payout_id uuid not null references public.driver_payouts(id) on delete cascade,
  order_id uuid not null,
  fee numeric(10,2) not null default 0,
  created_at timestamptz not null default now(),
  constraint chk_payout_item_fee check (fee >= 0),
  constraint uq_payout_item_order unique (order_id)
);

create index if not exists idx_payout_items_payout
  on public.driver_payout_items (payout_id);

-- =========================
-- 2. Elegibilidade no servidor
-- =========================
create or replace function public.validate_payout_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_pay record;
  v_ord record;
begin
  select * into v_pay from public.driver_payouts where id = new.payout_id;
  if not found then
    raise exception 'Fechamento não encontrado';
  end if;
  select * into v_ord from public.orders where id = new.order_id;
  if not found then
    raise exception 'Pedido não encontrado';
  end if;
  if v_ord.company_id is distinct from v_pay.company_id then
    raise exception 'Entrega de outra empresa';
  end if;
  if v_ord.driver_id is null or v_ord.driver_id is distinct from v_pay.driver_id then
    raise exception 'Entrega de outro entregador';
  end if;
  if v_ord.status is distinct from 'finalizado' then
    raise exception 'Somente entregas concluídas entram no fechamento';
  end if;
  -- Congela a taxa registrada no pedido (nunca do cliente).
  new.fee := coalesce(v_ord.delivery_fee, 0);
  return new;
end;
$func$;

revoke all on function public.validate_payout_item() from public, anon, authenticated;

drop trigger if exists trg_payout_items_validate on public.driver_payout_items;
create trigger trg_payout_items_validate
  before insert on public.driver_payout_items
  for each row execute function public.validate_payout_item();

-- =========================
-- 3. RLS
-- =========================
alter table public.driver_payouts enable row level security;
alter table public.driver_payout_items enable row level security;

drop policy if exists payouts_select_member on public.driver_payouts;
create policy payouts_select_member on public.driver_payouts
  for select to authenticated
  using (is_company_member(company_id) or is_platform_admin());

drop policy if exists payouts_write_mgr on public.driver_payouts;
create policy payouts_write_mgr on public.driver_payouts
  for all to authenticated
  using (
    (is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER'))
    or is_platform_admin()
  )
  with check (
    (is_company_member(company_id) and member_role(company_id) in ('OWNER','ADMIN','MANAGER'))
    or is_platform_admin()
  );

drop policy if exists payout_items_select_member on public.driver_payout_items;
create policy payout_items_select_member on public.driver_payout_items
  for select to authenticated
  using (
    exists (
      select 1 from public.driver_payouts p
      where p.id = payout_id
        and (is_company_member(p.company_id) or is_platform_admin())
    )
  );

drop policy if exists payout_items_write_mgr on public.driver_payout_items;
create policy payout_items_write_mgr on public.driver_payout_items
  for all to authenticated
  using (
    exists (
      select 1 from public.driver_payouts p
      where p.id = payout_id
        and ((is_company_member(p.company_id) and member_role(p.company_id) in ('OWNER','ADMIN','MANAGER'))
             or is_platform_admin())
    )
  )
  with check (
    exists (
      select 1 from public.driver_payouts p
      where p.id = payout_id
        and ((is_company_member(p.company_id) and member_role(p.company_id) in ('OWNER','ADMIN','MANAGER'))
             or is_platform_admin())
    )
  );
