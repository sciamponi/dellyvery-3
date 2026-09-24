# DELLVERY 3 — AUDIT (FASE 1)

> Mapeamento completo do ZIP funcional importado. Gerado 2026-09-23/24.

## 1. Inventário de páginas e rotas (`src/App.jsx:1`)

```
Públicas (sem ProtectedRoute):
  /                     → Landing.jsx
  /login                → Login.jsx
  /register             → Register.jsx
  /forgot-password      → ForgotPassword.jsx
  /reset-password       → ResetPassword.jsx
  /criar-restaurante    → CreateRestaurant.jsx (auth requerida, sem company_id)
  /cardapio/:slug       → Menu.jsx         (CartProvider)
  /checkout/:slug       → Checkout.jsx     (CartProvider)
  /acompanhar/:token    → OrderTracking.jsx
  /oauth-consent        → OAuthConsent.jsx (não listado em App.jsx mas existe)

Protegidas (ProtectedRoute + AppLayout):
  /dashboard            → Dashboard.jsx
  /gestao-produtos      → GestaoProdutos.jsx
  /pedidos              → Pedidos.jsx
  /configuracoes        → Configuracoes.jsx
  /clientes             → Clientes.jsx
  /perfil               → Perfil.jsx
  /assinatura           → Assinatura.jsx
  /financeiro           → Financeiro.jsx
  /master/planos        → MasterPlanos.jsx (gate role admin)
  *                     → PageNotFound.jsx
```

## 2. Autenticação

- `src/api/base44Client.js:1` `createClient({appId, token, functionsVersion, appBaseUrl, requiresAuth:false})`; `app-params.js:1` lê `app_id`/`access_token` de `?app_id=&access_token=` → `localStorage base44_*`.
- `AuthContext.jsx:1` `checkUserAuth` só em `ProtectedRoute`, não em mount público; `base44.auth.me()` + `logout`; erro `user_not_registered` (403).
- `useCompany.js:1` redirect `/criar-restaurante` se `!user.company_id`; `AppLayout.jsx:1` carrega `Company.get(user.company_id)` para `NotificationBell` e link cardápio.

## 3. Entidades — campos e RLS (resumo)

Ver `MODULES.md` para tabela completa. Destaques:

- **Company:** 25 campos, `plan` enum solo/equipe/multi_unidade (precisa evoluir para limites multissegmento), `theme` light/dark, `plan_status` trial/active/suspended, `trial_ends_at` + Subscription trial 7d.
- **Product:** 22 campos + `complements` aninhado com `max_select`; `read:{}` público proposital para cardápio.
- **Order:** 30+ campos, `tracking_token` UUID, `status_history[]`, `source` online/whatsapp/balcao, `order_number` sequencial por empresa.
- **Customer:** chave `whatsapp` para upsert em `createOrder`.
- **Plan:** `limits_*` (-1 = ilimitado) + `features[]`, `is_popular`.
- **Notification:** 12 campos, `read` bool, `title/message`, `link` para `/acompanhar/:token`.

## 4. Funções — inputs/outputs/side effects

| # | Arquivo | Auth | Input | Output | Efeitos |
|---|---------|------|-------|--------|---------|
| 1 | `createRestaurant/entry.ts:1` | user | `form{name*}` + `zones[]` | `company_id, slug` | slugify NFD, Company, Subscription trial, auth.updateMe, DeliveryZone.bulkCreate |
| 2 | `createOrder/entry.ts:1` | público | `company_slug*, items{product_id,quantity,complements}[], customer{name*,phone*}, order_type, delivery_zone_id` | `order_id, order_number, tracking_token` | Valida is_open, product available, complements, delivery_fee, minimum_order, Customer upsert, Notification `novo` idempotente |
| 3 | `manageOrder/entry.ts:1` | user company | `action,status,cancel_reason,items,discount` | `order` | Verifica company_id, `status` valid, `cancel_reason` required, `edit` recalcula subtotal/total server-side, `AuditLog`, `Notification` por status idempotente |
| 4 | `getOrderByToken/entry.ts:1` | público | `tracking_token*` | `order{order_number,items,total,status,...}` safe | — |
| 5 | `managePlan/entry.ts` | admin |  |  | CRUD Plan |
| 6 | `manageSubscription/entry.ts` | admin |  |  | CRUD Subscription |

## 5. Componentes preserváveis

- `AppLayout`, `ProtectedRoute`, `ScrollToTop`, `AuthLayout`, `PageHeader`, `ConfirmDialog`, `NotificationBell` (30 linhas Realtime), `NewOrderAlert` (modal), `NewOrdersQueue` (fila com `changeOrderStatus`), `OrderModal` (510 linhas, `getAvailableActions` + `getNextStatus`), `CancelOrderDialog`, `ProductFormDialog`, `CategoryFormDialog`, `CartDrawer`, `ProductModal`, `CustomerImportDialog`, `GoogleIcon`, `UserNotRegisteredError`.

## 6. Dependências

- **Runtime:** `@base44/sdk 0.8.50`, `@base44/vite-plugin 1.0.42`, `@hello-pangea/dnd 17`, `@stripe/*`, `framer-motion 11.16`, `react-leaflet 4.2`, `react-quill 2`, `html2canvas 1.4`, `jspdf 4.2`, `three 0.171`, `recharts 2.15`, `sonner 2.0`, Radix UI 20+ pkgs, `date-fns 3.6`, `lucide-react 0.475`, `zod 3.24`, `react-hook-form 7.54`, `canvas-confetti 1.9`.
- **Dev:** `vite 6.1.0` (instalado 6.4.3), `@vitejs/plugin-react 4.3.4`, `tailwindcss 3.4.17`, `typescript 5.8`.

## 7. Base44 — inventário quantificado (FASE 1)

- `base44` (qualquer): **137 ocorrências** em 12 arquivos `src`.
- `@base44/sdk`: `src/api/base44Client.js:1`, `vite.config.js:1`, `package.json:14`, + 6 functions `npm:@base44/sdk@0.8.40`.
- `base44.auth`: **27** (`AuthContext`, `AppLayout`, `useCompany`, `CreateRestaurant`, `Login`, `Register` etc.).
- `base44.entities`: **54** (Company, Product, Category, Order, Customer, Notification, DeliveryZone, Plan, Subscription, AuditLog).
- `base44.functions.invoke`: **12** (`createRestaurant` 1, `createOrder` 1, `manageOrder` 4+ (`status`, `cancel`, `edit`), `getOrderByToken` 1, `managePlan|Subscription` 2).
- `subscribe`: **3** — `NotificationBell.jsx:30 Notification.subscribe`, `Dashboard.jsx:68 Order.subscribe`, `Pedidos.jsx:116 Order.subscribe`.
- `Notification`: **34** ocorrências; `Order.subscribe`: **2**.
- `base44/config.jsonc:1` com `site.serveCommand npm run dev`.

## 8. Fluxos críticos

- **Pedidos:** `Menu` → `CartContext` → `Checkout` → `createOrder` (server price) → `Notification novo` → `Pedidos` Kanban (7 colunas, `cols: novo,confirmado,em_preparo,aguardando_retirada,saiu_entrega,finalizado,cancelado`) → `OrderModal` (Aceitar → `confirmado`, Avançar respeita `order_type` delivery vs mesa) → `manageOrder` status/history/AuditLog/Notification → Realtime atualiza `Dashboard` + `Pedidos`.
- **Financeiro:** `finance.js:1` `summarizeOrders` — receita = `status finalizado` apenas, `byStatus/byType/byPayment`, `getPeriodRange` (hoje/ontem/7/30/mes/custom).
- **Notificações:** `NotificationBell` lista 30 mais recentes, `read` toggle, `subscribe` Realtime; `NewOrderAlert` + `NewOrdersQueue` consomem `alertPrefs` (`localStorage dellyvery:alerts:<companyId>:<userId> {sound,visual}`) e `orderSound` (wav 57kB + WebAudio bipes, `audioUnlocked` por gesto, throttling 800ms).
- **Tracking:** `/acompanhar/:token` via `getOrderByToken` (safe fields), `buildTrackingLink`.
- **Planos/Assinatura:** `Plan` limits + `Subscription` trial 7d criado em `createRestaurant`; `MasterPlanos` CRUD só `role admin`.

## 9. Assets

- `src/assets/new-order-alert.wav:1` 57.37kB, `src/components/ui/*` 40 arquivos, `src/lib/orderSound.js:1` 104 linhas, `src/lib/alertPrefs.js:1` 34 linhas.

## 10. Novos módulos — só arquitetura nesta fase

Registrado que DELLVERY 3 **deverá** possuir (sem implementação FASE 1):

- **Segmentos:** `business_segments` + `segment_config`, primeiro `RESTAURANTE` completo, demais segmentos como opções preparadas (sem regras específicas ainda), sem `if restaurant` espalhado.
- **Loja personalizada:** `store_themes`/`company_settings` por `company_id` (logo, capa, cores, tema, banners, descrição, horários, redes, entrega, pagamento, textos).
- **Preview:** página interna `Preview da loja` com desktop/mobile, QR Code, Abrir loja, Copiar link, Compartilhar (`navigator.share`).
- **Entregadores:** `delivery_drivers(company_id, status ativo/inativo)` + `orders.driver_id` futuro.
- **Funcionários/Operadores:** `company_members` com `OWNER/ADMIN/MANAGER/OPERATOR/CASHIER/ATTENDANT` + permissões granulares por menu.
- **Caixa/PDV:** `cash_registers`/`cash_movements`/`cash_sales` (abrir, valor inicial, entradas/saídas, vendas, fechar, saldo, operador, histórico, diferença).
- **Central Notificações:** além do `NotificationBell`, filtros todas/não lidas/pedidos/financeiro/sistema, mesmo Realtime.
- **WhatsApp:** `WhatsAppProvider` desacoplado (Evolution API / Cloud API), eventos de status → mensagem.
- **Master Panel:** `PLATFORM_ADMIN` separado, dashboard geral, empresas, planos, assinaturas, métricas.
- **Marketing/Publicidade:** tabelas `marketing_campaigns`/`advertisements` mas **OCULTOS** como `[Em breve]` / `[Novas funções]` na navegação.

## 11. Riscos e observações

- `vite` instalado 6.4.3 vs `^6.1.0` ok (semver); chunk 838kB precisa code-splitting futuro.
- 11 `unused-imports` não bloqueiam build, mas devem ser limpos na FASE 2 com `eslint --fix`.
- `Order.order_number` sequencial com `max +1` sem transação — risco de colisão concorrente, precisa `sequence` ou `serial` por `company_id` no Postgres futuro.
- `is_open` booleano simples; futuro precisa `opening_hours` JSONB por dia.

## 12. Próximos passos (bloqueados)

Aguardar autorização para FASE 2: Supabase schema + RLS + Auth + Storage + Realtime + VPS API + migração functions + novos módulos, commits separados, documentação `DATABASE.md`, `AUTH.md`, `VPS.md`, `BACKUP-RESTORE.md`.
