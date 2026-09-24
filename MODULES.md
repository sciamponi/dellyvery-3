# DELLVERY 3 — MODULES (Inventário FASE 1)

## Páginas (19) — `src/pages/*.jsx`

| Página | Rota | Auth | Descrição |
|--------|------|------|-----------|
| Landing | `/` | pública | Marketing, CTA para login/criar restaurante |
| Login | `/login` | pública | Base44 `base44.auth` (Google + email) |
| Register | `/register` | pública | Criação conta |
| ForgotPassword | `/forgot-password` | pública | |
| ResetPassword | `/reset-password` | pública | |
| CreateRestaurant | `/criar-restaurante` | protegida* | Form + zonas, chama `base44.functions.invoke('createRestaurant')` |
| Dashboard | `/dashboard` | protegida | Stats hoje/em andamento/finalizados, últimos 8 pedidos, Realtime Order |
| Pedidos | `/pedidos` | protegida | Kanban 7 colunas (novo→cancelado), DnD @hello-pangea/dnd, NewOrderAlert/Queue, realtime, `alertPrefs`/`orderSound` |
| GestaoProdutos | `/gestao-produtos` | protegida | CRUD produtos + categorias, complements, promo price |
| Clientes | `/clientes` | protegida | CRUD + import, `whatsapp` como chave |
| Financeiro | `/financeiro` | protegida | `finance.js` summarize, filtros período, receita só `finalizado` |
| Configuracoes | `/configuracoes` | protegida | Empresa (cores, abertura, taxas), zonas |
| Perfil | `/perfil` | protegida | Usuário |
| Assinatura | `/assinatura` | protegida | Plan/subscription atual |
| MasterPlanos | `/master/planos` | protegida admin | CRUD Plan (só `user.role==='admin'`) |
| Menu | `/cardapio/:slug` | pública | Loja pública, `CartContext` + `CartDrawer` + `ProductModal` |
| Checkout | `/checkout/:slug` | pública | Carrinho → `createOrder` (server-side price) |
| OrderTracking | `/acompanhar/:token` | pública | `getOrderByToken` (safe fields) |
| OAuthConsent | `/oauth-consent` | pública | |

* CreateRestaurant exige auth mas sem `company_id`; `useCompany` redireciona se já tem empresa.

## Layout e componentes críticos

- `AppLayout.jsx:1` — sidebar desktop + drawer mobile, `NAV_ITEMS` (8) + `MASTER_ITEMS` (Planos) gate `user.role==='admin'`, `NotificationBell` + logout.
- `ProtectedRoute.jsx:1` — único gate auth, chama `checkUserAuth` sob demanda.
- `NotificationBell.jsx:1` — sino com `Notification.filter({company_id}, '-created_date',30)` + `subscribe` para create/update/delete, `read` flag.
- `NewOrderAlert.jsx:1` + `NewOrdersQueue.jsx:1` — alerta visual/sonoro de pedido `novo`, `isFresh <120s` + `inGraceWindow 10s`, `playNewOrderAlert`.
- `OrderModal.jsx:1` — aceitar/avançar/cancelar via `orderStatusFlow.changeOrderStatus` → `manageOrder`.
- `ProductFormDialog.jsx` / `CategoryFormDialog.jsx` — complements com `max_select`, `options.price`.

## Entidades Base44 (11)

Ver `base44/entities/*.jsonc`. Todas com `company_id` quando pertence a estabelecimento.

| Entidade | Campos chave | RLS |
|----------|--------------|-----|
| Company | name* , slug, slogan, logo_url, primary/accent/secondary_color, phone, whatsapp, address/city/state/zip, is_open, opening_hours, minimum_order, delivery_fee, estimated_delivery_time, theme [light/dark], plan [solo/equipe/multi_unidade], plan_status [trial/active/suspended], trial_ends_at | create: `created_by_id={{user.id}}`, update/delete: `created_by_id OR role admin`, read: null (público para cardápio) |
| Product | company_id*, category_id, name*, price*, promotional_price, sku, image_url, gallery[], available, is_made_to_order, out_of_stock, stock, preparation_time, sort_order, is_featured/bestseller, ingredients, complements[{name,required,max_select,options[{name,price}]}] | read:{} (público), create/update/delete: `data.company_id={{user.data.company_id}}` |
| Category | company_id*, name*, description, icon, image_url, order, active | idem Product |
| Order | company_id*, order_number, tracking_token, order_type[delivery/retirada/mesa], table_number, customer_id, customer_name/phone/email/address..., items[{product_id,name,unit_price,price,quantity,notes,complements}], subtotal, delivery_fee, discount, total, status[novo,confirmado,em_preparo,aguardando_retirada,saiu_entrega,finalizado,cancelado], status_history[], payment_method, notes, delivery_zone, source[online/whatsapp/balcao] | todas `data.company_id={{user.data.company_id}}` |
| Customer | company_id*, name*, whatsapp, phone, email, address..., tags[], is_favorite/blocked, total_spent, orders_count, last_order_date | idem Order |
| DeliveryZone | company_id*, name*, fee, estimated_time | idem |
| Plan | name*, price*, slug, billing_cycle[monthly/yearly], limits_users/orders/products/customers/whatsapp/ia/storage_mb, features[], is_popular, sort_order, active | read:{}, create/update/delete: `role admin` |
| Subscription | company_id*, plan_id*, plan_name, status[trial/ativo...], started_at, trial_ends_at, current_period_end, gateway[stripe/.../manual], amount | read: `company_id`, create/update/delete: `role admin` (criação via `asServiceRole` em createRestaurant) |
| Notification | company_id*, order_id*, status, order_number, customer..., title, message*, read, tracking_token, link | todas `company_id` |
| AuditLog | action*, company_id, user_id, user_name, entity_type, entity_id, details | read: `company_id`, create/update: `role admin`, delete: false |
| User (stub) | company_id, staff_role[admin/gerente/caixa/atendente/cozinha/entrega] | — |

## Funções Base44 (6) — `base44/functions/*/entry.ts`

| Função | Auth | Inputs | Outputs | Side effects |
|--------|------|--------|---------|--------------|
| createRestaurant | user | `{form:{name*,slogan,logo_url,colors,phone,email,address...}, zones[]}` | `{company_id, slug}` | Company.create, Subscription trial 7d via `asServiceRole` (plan slug solo), `auth.updateMe({company_id})`, DeliveryZone.bulkCreate |
| createOrder | público (asServiceRole) | `{company_slug*, order_type, table_number, items[], customer{name*,phone*,address...}, delivery_zone_id, payment_method, notes}` | `{order_id, order_number, tracking_token}` | Valida company.is_open, produtos available, complements, delivery_fee, minimum_order, upsert Customer por `whatsapp`, `Customer.update` stats, `Notification` idempotente `novo` |
| manageOrder | user (company_id) | `{action:(status|cancel|edit), order_id*, status, cancel_reason, items, discount, customer_*}` | `{order}` | Verifica `company_id`, `status_history` append, `AuditLog`, `Notification` idempotente por status, recalcula subtotal/total server-side em `edit` |
| getOrderByToken | público | `{tracking_token*}` | `{order:{safe fields}}` | — |
| managePlan | admin | — | — | CRUD Plan |
| manageSubscription | admin | — | — | CRUD Subscription |

## Libs e hooks

- `lib/AuthContext.jsx:1` — `checkUserAuth` lazy, `logout`, `user/isAuthenticated/isLoadingAuth/authChecked/authError`.
- `lib/CartContext.jsx:1` — carrinho para `/cardapio/:slug` → `/checkout/:slug`.
- `hooks/useCompany.js:1` + `useSubscription.js` — guard `company_id`.
- `lib/finance.js:1` — `PAID_STATUS='finalizado'`, `summarizeOrders`, `getPeriodRange`.
- `lib/orderStatusFlow.js:1` — `ORDER_STATUSES`, `getNextStatus` (delivery pula `aguardando_retirada`), `changeOrderStatus` via `manageOrder`.
- `lib/alertPrefs.js:1` — `localStorage dellyvery:alerts:{companyId}:{userId}` `{sound,visual}`.
- `lib/orderSound.js:1` — `new-order-alert.wav` + fallback WebAudio, `audioUnlocked` por gesto, `playNewOrderAlert` throttling 800ms.
- `lib/app-params.js:1` — `appId/token/functionsVersion/appBaseUrl` via `URLSearchParams` + `localStorage`.
- `lib/utils.js` — `cn` (clsx+tailwind-merge).

## Assets

- `src/assets/new-order-alert.wav:1` 57.37kB, `src/components/ui/*` 40+ shadcn, `html2canvas/jspdf/recharts` para Financeiro/exports, `three/canvas-confetti` usado em Landing, `react-leaflet` para mapa (não visível no MVP), `framer-motion`.

## Dependências Base44 (contagem FASE 1)

- `base44` string: 137 ocorrências em `src` (12 arquivos).
- `@base44/sdk`: 3 arquivos (`src/api/base44Client.js`, `vite.config.js`, `package.json` + 6 functions `npm:@base44/sdk@0.8.40`).
- `base44.auth`: 27 ocorrências (`AuthContext`, `AppLayout`, `useCompany`, functions).
- `base44.entities`: 54 ocorrências (Product/Category/Order/Customer/Notification/Company/DeliveryZone etc.).
- `base44.functions.invoke`: 12 ocorrências (`createRestaurant`, `createOrder`, `manageOrder`, `getOrderByToken`).
- `subscribe`: 3 locais — `NotificationBell.jsx:30 Notification.subscribe`, `Dashboard.jsx:68 Order.subscribe`, `Pedidos.jsx:116 Order.subscribe` (Realtime).
- `Notification`: 34 ocorrências; `Order.subscribe`: 2.
