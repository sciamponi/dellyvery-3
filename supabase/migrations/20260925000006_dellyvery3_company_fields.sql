-- DELLVERY 3 — Company storefront columns (FASE 5.4-C C1, local only)
-- Migration incremental: apenas ADD COLUMN em companies.
-- Verificado antes: nenhum dos campos abaixo existe em companies,
-- company_settings ou store_themes. Colunas tipadas em companies
-- (decisão aprovada); settings/theme jsonb existentes preservados.
alter table companies add column if not exists slogan text;
alter table companies add column if not exists primary_color text;
alter table companies add column if not exists accent_color text;
alter table companies add column if not exists is_open boolean not null default true;
alter table companies add column if not exists minimum_order numeric(10,2) not null default 0;
alter table companies add column if not exists delivery_fee numeric(10,2) not null default 0;
alter table companies add column if not exists estimated_delivery_time integer not null default 30;
alter table companies add column if not exists whatsapp text;
alter table companies add column if not exists city text;
alter table companies add column if not exists state text;
alter table companies add column if not exists zip_code text;
