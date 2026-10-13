-- DELLVERY 3 — Adesões comerciais (contratos) — PLATFORM_ADMIN only.
--
-- Registro de contratação comercial (adesão): vínculo com a lead de origem
-- (sem duplicar a cliente), plano contratado, taxa de adesão (única),
-- mensalidade recorrente, condições, vigência e snapshot do contrato.
-- Aditiva e segura: tabela nova, sem tocar em dados existentes. Sem trigger
-- em outras tabelas; sem RPC nova (CRUD direto com RLS restrita).
-- Histórico: events JSONB (append-only pelo app). Contrato: snapshot JSONB
-- congelado na emissão + contract_issued_at.

create table if not exists public.commercial_adhesions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  -- Contratante (snapshot; preenchido da lead ou manual — nunca inventado).
  full_name text not null default '',
  trade_name text not null default '',
  person_type text not null default 'pf' check (person_type in ('pf', 'pj')),
  document text not null default '',
  phone text not null default '',
  email text not null default '',
  address jsonb not null default '{}',
  -- Condições comerciais.
  plan_id uuid references public.plans(id) on delete restrict,
  plan_name text not null default '',
  adhesion_fee numeric(10,2) not null default 0 check (adhesion_fee >= 0),
  monthly_fee numeric(10,2) not null default 0 check (monthly_fee >= 0),
  discount_text text not null default '',
  start_date date,
  due_day int check (due_day is null or (due_day >= 1 and due_day <= 28)),
  payment_method text not null default ''
    check (payment_method in ('', 'Pix', 'Cartão', 'Dinheiro', 'Boleto', 'Transferência')),
  status text not null default 'rascunho'
    check (status in ('rascunho', 'ativa', 'suspensa', 'cancelada')),
  -- Fornecedora (editável por contrato; sem tabela própria no projeto).
  provider jsonb not null default '{}',
  -- Contrato emitido (congelado) + histórico de eventos (append-only).
  contract_snapshot jsonb,
  contract_issued_at timestamptz,
  events jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_commercial_adhesions_updated_at on public.commercial_adhesions;
create trigger trg_commercial_adhesions_updated_at before update on public.commercial_adhesions
  for each row execute function public.set_updated_at();

alter table public.commercial_adhesions enable row level security;

drop policy if exists commercial_adhesions_admin on public.commercial_adhesions;
create policy commercial_adhesions_admin on public.commercial_adhesions
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());
