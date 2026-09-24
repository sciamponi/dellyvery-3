# DELLVERY 3 — ARCHITECTURE (FASE 1: proposta)

> **Status:** Proposta documentada, **não implementada** nesta fase. Nenhum banco, migration, Supabase ou VPS foi criado.

## 1. Visão geral

```
Lovable (editor frontend, opcional)
        ↓ git push
GitHub (fonte oficial) — dellyvery-3.git — branch chore/init-from-zip → main
        ↓ deploy
VPS: Nginx → Frontend (Vite build dist) + Backend (Node Fastify/Nest)
        ↓
BANCO A (principal, escrita): Supabase Postgres + Auth + Storage + Realtime
        ↓  backup lógico + WAL
BANCO B (cópia, restauração): Postgres no VPS (mesmo schema, sem escrita app)
        ↓
Redis no VPS (cache/filas quando necessário)
```

Supabase é **fonte de escrita** da app. VPS Postgres é **redundância recuperável**, não réplica bidirecional.

## 2. Frontend

- **Atual (ZIP):** Vite 6.1.0, React 18.2, react-router-dom 6.26, Tailwind 3.4.17, Radix UI, @tanstack/react-query 5.84, @base44/sdk 0.8.50 + @base44/vite-plugin 1.0.42. Build `838kB` validado.
- **Migração gradual:** Remover `@base44/sdk`/`base44.auth/entities/functions` por etapas, via adapter `lib/supabaseClient` que replica `filter/get/create/update/bulkCreate + subscribe` com `supabase.from().select()` + `realtime channel`.
- **Roteamento permanece** `src/App.jsx:1` com `CartProvider` envolvendo `/cardapio/:slug` e `/checkout/:slug`.

## 3. Backend VPS (proposta)

- Node 20, Postgres 16, Redis 7, Nginx, PM2 ou Docker.
- API: `POST /api/create-restaurant` (auth), `POST /api/create-order` (público, server-side price), `POST /api/manage-order` (auth, status/cancel/edit), `POST /api/get-order-by-token` (público), `POST /api/manage-plan|subscription` (admin).
- Validações server-side preservadas: preço de `promotional_price` ou `price`, `complements` contra `product.complements`, `delivery_fee` por zona, `minimum_order`, `tracking_token` UUID, `order_number` sequencial por `company_id` (com retry).

## 4. Modelo multissegmento

Não espalhar `if restaurant`. Configuração por segmento:

```sql
business_segments(id, slug, label, icon, config_schema JSONB)
  -- ex: restaurant, pizzeria, cafe, market, store, petshop, services, outro
companies(id, ..., segment_id FK, slug unique, theme JSONB, settings JSONB)
company_settings(company_id PK, opening_hours JSONB, delivery_info JSONB, payment_methods JSONB, social JSONB)
store_themes(company_id PK, primary_color, accent_color, secondary_color, logo_url, cover_url, banners JSONB)
segment_config(segment_id, key, value JSONB)
```

Primeiro segmento implementado: **RESTAURANTE**. Produtos/categorias/pedidos já genéricos (`complements` com `max_select`, `options.price`). Novos segmentos adicionam entradas em `segment_config` sem `if` espalhado.

## 5. Personalização por estabelecimento (company_id)

Cada `/loja/{slug}` ou `/cardapio/{slug}` consome `company_id` + `store_themes` + `company_settings` (cores, tema light/dark, banners, descrição, horários, contato, endereço, redes, entrega, pagamento, textos). Isolamento por `company_id` via RLS. Preview no painel com desktop/mobile, QR Code (`qrcode`), copiar link, `navigator.share`, botão Abrir loja.

## 6. Schema novo (Supabase Postgres, proposta FASE 2)

```sql
profiles(id uuid PK = auth.uid(), email, full_name)
companies(id uuid PK, slug text unique, name text, segment_id, theme jsonb, settings jsonb, is_open bool, trial_ends_at timestamptz, ...)
company_members(company_id, user_id, role enum['OWNER','ADMIN','MANAGER','OPERATOR','CASHIER','ATTENDANT'], PK(company_id,user_id))
business_segments, company_settings, store_themes (ver §4)
plans(id, slug, price, billing_cycle, limits jsonb, features text[], ...)
subscriptions(company_id FK, plan_id, status enum[trial,ativo...], gateway, ...)
categories(id, company_id FK, name, order, active)
products(id, company_id, category_id, name, price, promotional_price, complements jsonb, ...)
product_options (se necessário por segmento)
customers(id, company_id, whatsapp unique per company, total_spent, orders_count, ...)
delivery_zones(id, company_id, name, fee, estimated_time)
delivery_drivers(id, company_id, name, phone, document, email, status enum[ativo,inativo], vehicle, plate, photo_url)
orders(id, company_id, order_number int, tracking_token uuid unique, order_type enum[delivery,retirada,mesa], driver_id nullable FK, status enum[novo...finalizado,cancelado], items jsonb, subtotal, delivery_fee, discount, total, payment_method, notes, delivery_zone, source enum[online,whatsapp,balcao], status_history jsonb, created_date)
order_items, order_status_history (ou jsonb em orders)
notifications(id, company_id, order_id, status, title, message, read bool, tracking_token, link)
cash_registers(id, company_id, operator_id, opened_at, closed_at, initial_amount, final_amount, status)
cash_movements(id, cash_register_id, company_id, operator_id, type enum[sale,entrada,saida], amount, description)
whatsapp_connections(id, company_id, number, status, qr_code, provider enum[evolution,cloud])
whatsapp_messages(id, connection_id, direction, template, body, order_id)
marketing_campaigns, advertisements (status hidden, EM BREVE)
audit_logs(company_id, user_id, action, entity_type, entity_id, details)
```

Todo dado de negócio com `company_id`. Índices: `orders(company_id, created_date desc)`, `orders(company_id, order_number)`, `notifications(company_id, read)`.

## 7. Segurança / RLS

- `company_members` é a ponte: `auth.uid() → company_members → company_id`.
- Políticas: `USING (company_id = (select company_id from company_members where user_id = auth.uid()))` para read/create/update/delete. `User` só lê sua `company_id`.
- `PLATFORM_ADMIN` (Master) via `auth.jwt() ->> 'role' = 'platform_admin'` ou tabela `platform_admins(user_id)`, bypass com policies separadas, nunca `service_role` no frontend.
- Storage (logos, banners, product images) com bucket por `company_id` prefix + RLS.

## 8. Redundância e backup (sem replicação bidirecional)

- **BANCO A (principal):** Supabase Postgres — escrita da app.
- **BANCO B (cópia):** Postgres VPS — mesma versão, sem escrita da app; recebe `pg_dump` lógico diário (full) + `WAL archiving` horário, retenção 30d local + 90d S3-compatível.
- **Frequência:** full diário 03:00 UTC, incremental/WAL horário, retenção 30/90d, validação mensal com `pg_restore --dry-run` + checagem `row count + hash`.
- **Divergência:** job diário compara `count(*)` e `md5` agregado por tabela entre A e B; alerta se drift > tolerância.
- **Restauração:** runbook em `BACKUP-RESTORE.md` (FASE 2): promover B → apontar `DATABASE_URL` → recriar Realtime channels → validar `tracking_token` uniqueness.

## 9. Módulos futuros (só arquitetura nesta fase)

- **Entregadores:** CRUD, `delivery_drivers.company_id`, `orders.driver_id`, atribuição futura, sem GPS nesta fase.
- **Funcionários:** `company_members` com permissões granulares (Dashboard, Pedidos, Produtos, Clientes, Financeiro, Caixa, Entregadores, Marketing, Configurações) por role.
- **Caixa/PDV:** `cash_registers` (abrir com valor inicial, operador, histórico, diferença de fechamento), `cash_movements` (vendas, entradas, saídas), `cash_sales` ligando `orders` presenciais.
- **Central Notificações:** filtros todas/não lidas/pedidos/financeiro/sistema, reutiliza `NotificationBell` + Realtime, preserva `alertPrefs`/`orderSound`.
- **WhatsApp:** `WhatsAppProvider` desacoplado (Evolution API / Cloud API), eventos `novo/confirmado/em_preparo/saiu_entrega/finalizado` → mensagem.
- **Marketing/Publicidade:** tabelas existem mas navegação oculta `[Em breve]` / `[Novas funções]`, gate por `plan.features`.
- **Master Panel:** `/master/*` só `PLATFORM_ADMIN`, dashboard geral, empresas, planos, assinaturas, métricas plataforma.

## 10. Menu/sidebar modular

Visibilidade por `role × segment × plan × feature_flag`:

```
Dashboard
VENDAS: Pedidos, Clientes, Produtos, Categorias
ENTREGAS: Entregadores, Zonas de entrega
FINANCEIRO: Financeiro, Caixa/PDV
COMUNICAÇÃO: Notificações, WhatsApp
MARKETING: Marketing [Em breve], Publicidade [Em breve]
LOJA: Minha loja, Preview, QR Code, Personalização
CONFIGURAÇÕES: Empresa, Funcionários, Assinatura
MASTER: Empresas, Planos, Assinaturas, Usuários (só PLATFORM_ADMIN)
```

## 11. VPS e Lovable

- VPS: `Node 20 + Postgres 16 + Redis 7 + Nginx (reverse proxy /api + /) + PM2/Docker`, sem expor Postgres à internet.
- Lovable: permanece editor do frontend via GitHub sync; nenhum `lovable` reconnect nesta fase; `vite.config.js:1` com `@base44/vite-plugin` mantido até migração final.

## 12. Ordem de implementação FASE 2 (commits separados)

1. Supabase projeto + schema + RLS + Storage + Realtime
2. Backend VPS + API + adapter Supabase
3. Auth migrada
4. Pedidos/Financeiro/Notificações migrados
5. Entregadores → Funcionários → Caixa/PDV → Preview/QR → WhatsApp → Master → Marketing
6. Remoção final `@base44/sdk`
