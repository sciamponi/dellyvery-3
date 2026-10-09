-- DELLVERY 3 — Planos comerciais: campos de catálogo (FASE A, local only)
--
-- Aditiva e segura: só ADD COLUMN nullable/com default. Nenhum dado
-- existente é alterado (Solo intacto). Sem mudança em subscriptions,
-- manage_subscription, create_company_with_owner, RLS ou policies.
-- trial_days é informativo nesta fase (trial de 7 dias continua hardcoded
-- na RPC de onboarding); cobrança/gateway/renovação ficam para fase futura.

alter table plans add column if not exists description text;
alter table plans add column if not exists annual_price numeric(10,2);
alter table plans add column if not exists setup_fee numeric(10,2) not null default 0;
alter table plans add column if not exists trial_days int not null default 7;
alter table plans add column if not exists sales_text text;
alter table plans add column if not exists benefits jsonb not null default '[]';

alter table plans add constraint chk_plans_annual_nonneg check (annual_price is null or annual_price >= 0);
alter table plans add constraint chk_plans_setup_nonneg check (setup_fee >= 0);
alter table plans add constraint chk_plans_trial_nonneg check (trial_days >= 0);
