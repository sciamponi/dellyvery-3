# DELLVERY 3 — PROJECT_STATE (FASE 1)

> Produto: **DELLVERY 3** — Plataforma de vendas e gestão para estabelecimentos (primeiro segmento: RESTAURANTE, arquitetura multissegmento).
> Diretório técnico: `dellyvery-3` | Repositório: `https://github.com/sciamponi/dellyvery-3.git`
> Data FASE 1: 2026-09-23/24 (America/Sao_Paulo)

## 1. Fonte funcional canônica

- **Caminho:** `C:\Users\samue\Downloads\dellyvery.zip`
- **Tamanho:** 303.687 bytes
- **SHA-256:** `E8A71307C1FD130FD316E785E3DB8576F1E6B1B9A31610EDAF8EC3577978BAE7`
- **Conteúdo:** 140 entradas, app Vite 6.1.0 + React 18.2 + react-router-dom 6.26.0 + @base44/sdk 0.8.50, funcional. **Não versionado no Git**, não movido/apagado.

## 2. Branch e histórico

- **Branch FASE 1:** `chore/init-from-zip`
- **Base:** `af59e25 Add project README` (main)
- **Commit principal FASE 1:** `44ea9a5 chore: initialize dellyvery 3 from functional source` (154 files, +21208 -1744) — boilerplate TanStack removido, ZIP importado.
- **Histórico atual (origin/chore/init-from-zip):**
  - `741600e chore: initialize dellyvery 3 from functional source` (fix package-lock 198k→366k após npm install) — em cima de:
  - `7e66ea9 Atualização automática` + `2ff1e31 Atualização automática` (Lovable sync, preservados para evitar force-push)
  - `af59e25` / `07342b2 template: tanstack_start_ts_current-...`
- **main:** ainda em `af59e25` (não tocado). Novo repositório independente verificado: `origin` = `dellyvery-3.git`, não é DELLYVERY NOVO nem 2.0.

## 3. Importação

- Removidos conflitos TanStack: `src/router.tsx`, `src/routeTree.gen.ts`, `src/server.ts`, `src/start.ts`, `src/styles.css`, `vite.config.ts`, `tsconfig.json`, `bun.lock`, `bunfig.toml`, `.prettier*`, `src/routes/*`, `.tanstack/*`.
- Preservados: `.git`, `.lovable/project.json` (template tanstack_start_ts_current-78c8e5169cf8), `public/favicon.ico` + `robots.txt`.
- Copiado via `Expand-Archive` + `robocopy /XD .git node_modules` preservando `.git` e `.lovable`. `.gitignore` substituído pelo do ZIP (`#env`, `base44/.app.jsonc` etc.).
- `node_modules` reinstalado limpo a partir do `package-lock.json` do ZIP (366.114 bytes, `vite ^6.1.0`), após remover `node_modules` stale com `@lovable.dev/vite-tanstack-config`.

## 4. Build e Lint

- **npm install:** `added 628 packages, audited 629, 15 vulnerabilities (1 low 8 moderate 6 high)` em 51s. Sem `--force/--legacy-peer-deps`, lock do ZIP resolveu peer corretamente após limpar `node_modules`.
- **npm run build:** `vite v6.4.3 building for production` — `2242 modules transformed`, `dist/index.html 2.74kB`, `assets/index-CkE-q4l_.css 83.10kB`, `assets/index-DL7mR-C2.js 838.76kB (gzip 250.68kB)`, chunk >500kB warning (esperado, não bloqueante). `[base44] Warning: VITE_BASE44_APP_ID is not set` — ok fora do Base44 dev.
- **npm run lint -- --quiet:** 11 errors `unused-imports/no-unused-imports` (não bloqueantes, já existiam no ZIP):
  - `AppLayout.jsx:4 Button`, `ProductModal.jsx:2 DialogFooter`, `CreateRestaurant.jsx:10 Store/User/Phone/Mail/Lock`, `GestaoProdutos.jsx:14 PackageX`, `OrderTracking.jsx:5 ShoppingBag`, `Perfil.jsx:12 X/Clock`. **Não corrigidos nesta fase** (regra: só erros de build).

## 5. Git pós-build

- `git status` clean antes do push. `git log --oneline -10` e `git diff` verificados. Push `chore/init-from-zip` sem `--force` (merge com remote via fix commit `741600e` para evitar force-push, respeitando regra).
- Sem `force push`, sem apagar branches, sem `migrations` executadas, sem secrets no Git.

## 6. Auditoria

- `AUDIT.md` gerado com mapeamento completo de páginas, rotas, entidades, RLS, funções, componentes, assets, inventário Base44 (137 ocorrências `base44`, 27 `base44.auth`, 54 `base44.entities`, 12 `base44.functions`, 3 `subscribe`).
- `MODULES.md` e `ARCHITECTURE.md` com proposta FASE 2 (Supabase principal + VPS Postgres cópia, sem replicação bidirecional).

## 7. FASE 2 — Supabase Local (2026-09-24)

- **Branch:** `feat/supabase-foundation` (base `origin/chore/init-from-zip:d94c6b1`, HEAD `1656fde` RLS, atual `81769bd` foundation + seeds)
- **Supabase projeto:** `dellyvery-3` ref `kmpktvcjtxwenlgzjvog` região `sa-east-1` (São Paulo), API `https://kmpktvcjtxwenlgzjvog.supabase.co` — **nenhum db push remoto** (migration list remote vazio)
- **Supabase local:** `http://127.0.0.1:54321`, DB `54325` (alterada de 54322), Studio `54323`, storage/analytics ajustados (`analytics.enabled=false`, `storage.analytics.port=54328`, `pgdelta.enabled=false`), stack `samue` parado, `supabase local development setup is running`
- **Migrations locais (4, sem RLS antes):** `20260924000000_foundation.sql` 19.527b, `20260924000001_rls.sql` 27.034b (4 helpers + 80 policies), `20260924000002_seed_segments.sql` 716b (restaurant), `20260924000003_seed_plans.sql` 682b (Solo) — aplicadas via `npx supabase migration up` (db reset requer Docker, mas migration up funcionou)
- **Validação RLS:** `supabase/tests/rls_dellyvery3.sql` com 19 cenários / 42 asserts, todos **PASS** como `authenticated` (via `set_config('request.jwt.claim.sub',...)` + `role authenticated`, superuser bypass evitado, posterior state verificado). Detalhes em tabela abaixo. **Nenhum db push remoto**, remoto continua sem migrations.

## 8. FASE 5.1 — Supabase Auth + contexto da empresa (2026-09-25, sem commit)

- **Arquivos novos:** `src/api/supabaseClient.js` (singleton anon key; neutro sem env), `src/api/supabaseAuth.js` (signUp/signIn/signOut/getSession/onAuthStateChange, ensureProfile, fetchMemberships, fetchRestaurantSegment, createCompanyWithOwner RPC, signUpRestaurant, slugify), `src/lib/companySelection.js` (resolveCurrentCompany puro + storage por usuário), `src/lib/routeGuard.js` (shouldAllowProtected puro), `src/lib/SupabaseAuthContext.jsx` (user/session/loading/profile/memberships/currentCompany/currentRole/selectCompany), `src/api/supabaseAuth.test.js` + `src/lib/frontendAuth.test.js` (node:test, 22 asserts), `@supabase/supabase-js@2.117.2`, script `test:supabase`.
- **Arquivos adaptados (coexistência, Base44 intacto):** `src/App.jsx` (+SupabaseAuthProvider externo), `src/components/ProtectedRoute.jsx` (aceita sessão Supabase via shouldAllowProtected), `src/pages/Login.jsx` (Supabase quando configurado; Google/Base44 senão), `src/components/AppLayout.jsx` (prefere empresa Supabase; fallback Base44), `src/pages/CreateRestaurant.jsx` (onboarding Supabase via RPC quando configurado). Sem `VITE_SUPABASE_*`, comportamento idêntico ao anterior.
- **Arquitetura:** frontend usa só anon key; profile/memberships via RLS (`auth.uid()`); empresa criada SOMENTE via `create_company_with_owner()` DEFINER (company + OWNER + Solo + seq + settings + themes); segmento fixo `restaurant`; seleção de empresa só atua com >1 membership (localStorage `dellyvery:company:<userId>`).
- **Testes:** `npm run test:supabase` → 22/22 PASS (guard, sessão, profile, memberships/role, sem-empresa, RPC, slugify). RLS SQL 82/82 mantido (sem alteração nesta fase).
- **Build:** `npm run build` OK (14.8s; chunk >500kB pré-existente). `npm run lint` → mesmos 11 erros `unused-imports` pré-existentes (FASE 1), zero nos arquivos novos.
- **Não feito:** sem `db push`, sem push, sem remoção Base44, sem migração Pedidos/Produtos/Financeiro, sem alteração em migrations, prisma-studio ou DELLVERY 2.0.

## 9. FASE 5.2 — Categorias + Produtos no Supabase (2026-09-25, sem commit)

- **ETAPA A (auditoria, sem banco):** divergência Base44×Supabase mapeada campo a campo (icon/order/available/promotional_price/sku/internal_code/flags/estoque/preparo/ingredientes/nutricional/complements×options); FK `products.category_id` só referencia `categories(id)` — sem garantia mesma-empresa.
- **Migration nova (só local):** `supabase/migrations/20260925000001_dellyvery3_catalog_fields.sql` — ADD COLUMN (icon; promotional_price/sku/internal_code/flags/estoque/preparo/ingredientes/nutricional) + trigger `trg_products_category_company` (produto só referencia categoria da mesma empresa). Mapeamentos sem coluna: order↔sort_order, available↔active, complements↔options.
- **Adapter:** `src/api/catalog.js` (+`catalog.test.js`, 12 asserts) — company_id só do contexto; valida categoria mesma-empresa; updates parciais sem company_id.
- **Telas migradas (Supabase quando configurado; Base44 senão):** `GestaoProdutos.jsx`, `ProductFormDialog.jsx`, `CategoryFormDialog.jsx`. Upload segue `base44.integrations.Core.UploadFile` (sem Storage nesta fase). NÃO migrados: Menu (catálogo anon), OrderModal, Dashboard, Assinatura.
- **Validação local:** unit `npm run test:supabase` 34/34; E2E REST 16/16 (CRUD, todos os campos, isolamento, cross-company bloqueado por RLS+trigger com posterior, toggle, deletes OWNER); RBAC OPERATOR bloqueado/MANAGER permitido com posterior; dados de teste removidos (0 restantes).
- **Build** OK; **lint** só os 11 `unused-imports` pré-existentes. Sem db push/push/commit; prisma-studio e DELLVERY 2.0 intocados.

## 10. FASE 5.3 — Clientes + Delivery Zones no Supabase (2026-09-25, sem commit)

- **Migration nova (só local):** `supabase/migrations/20260925000002_dellyvery3_customers_delivery.sql` — `customers`: +`whatsapp`/`tags`/`is_favorite`/`is_blocked` + índice company+whatsapp; `orders_count/total_spent` fora (agregados de Pedidos); triggers mesma-empresa `trg_orders_company_refs` (customer/zone/driver) + `trg_whatsapp_messages_company` (connection/customer), dados pré-existentes verificados consistentes.
- **Adapters:** `src/api/customers.js` (+dedupe `isDuplicateCustomer`, endereço jsonb↔planos) e `src/api/deliveryZones.js` (+`customersZones.test.js`, 10 asserts).
- **Telas migradas (Supabase quando configurado):** `Clientes.jsx`, `CustomerImportDialog.jsx`, aba Delivery de `Configuracoes.jsx`. NÃO migrados: Checkout (zonas anon — sem policy anon), Menu, OrderModal, Pedidos, Tracking, Assinatura, Dashboard, Financeiro, Notificações; drivers sem UI (tabela pronta).
- **Validação local:** unit 44/44; E2E 20/20 (CRUD, address JSON, isolamento, cross bloqueado RLS+trigger com posterior, anon sem acesso, deletes OWNER); RBAC 5/5 (OPERATOR lista/atualiza cliente, DELETE cliente/zona bloqueado 0 linhas, posterior intacto); dados de teste removidos.
- **Build** OK; **lint** só os 11 pré-existentes. Sem db push/push/commit; prisma-studio e DELLVERY 2.0 intocados.

## 11. FASE 5.4 — Pedidos no Supabase ETAPA B (2026-09-25, sem commit)

- **B1 migration (só local):** `20260925000003_dellyvery3_orders_hardening` (+`table_number`/`cancel_reason`, CHECK source, índice zona, trigger `trg_order_items_product_company`); `20260925000005_dellyvery3_realtime_pub` (publication estava VAZIA; +replica FULL). Notification.title/customer_* derivados na RPC (sem duplicar).
- **B2 RPCs DEFINER:** `create_order` (anon+auth; valida slug/active/produtos/preços/complements/max_select/qty/cliente/endereço/mesa/taxa/mínimo; upsert customer por whatsapp; seq; tracking; items/history/notification idempotente; só retorna id/number/token), `manage_order` (só auth; status/cancel/edit + history/audit/notification; achados e corrigidos: cast order_type, grants anon revogados inclusive em `create_company_with_owner`, msg 'Status inválido', old_status correto), `get_order_by_token` (anon; só campos safe; items no formato Base44).
- **B3:** RLS intacta (sem anon em tabelas); grants mínimos verificados; RPCs validam membership/tenant internamente.
- **B4 adapter** `src/api/orders.js` (+`orders.test.js`, 8 asserts): mapeamentos created_date/customer_*/items/history, WithItems, notifications com title derivado, `subscribeCompanyTable` (corrigido `postgres`→`postgres_changes` v2).
- **B5:** unit 52/52; RPC reais ~40 checks (CRUD 3 tipos, preços, 9 validações, seq 1-2-3, fluxos 3 tipos, cancel, edit server-side, isolamento, tracking, notifications); RBAC OPERATOR avança mas não apaga; regressão unit 52/52 + RLS SQL 82/82 (1 FAIL inicial era poluição de dados de teste, limpo e verde).
- **B6 telas** (branch sbActive): Pedidos (kanban+merge+realtime), OrderModal (edit via adapter), CancelDialog, Dashboard, Financeiro (leitura). **B7:** Bell/Queue/Alert; realtime real validado (INSERT+UPDATE via postgres_changes). **B8:** tracking via RPC, polling 5s. **B9:** Checkout cria via RPC; empresa/zonas seguem Base44 (público).
- **Build** OK; **lint** só os 11 pré-existentes. Residuais: excluir empresa com audit_logs falha (trigger imutabilidade × SET NULL — pré-existente 4.2); realtime exige `postgres_changes` (v2). Sem db push/push/commit.

## 12. Correção onboarding autenticado + .env.local (2026-09-25, sem commit)

- **Causa:** `createCompanySupabase()` refazia signup com sessão existente → `User already registered`, sem empresa e sem redirect; workspace sem `.env.local` caía no fallback Base44 morto.
- **Correção (só `supabaseAuth.js`, `CreateRestaurant.jsx`, `supabaseClient.js`):** `provisionCompanyForCurrentUser()` — sessão existente reaproveitada (nunca re-signup); com empresa existente retorna `created:false` sem criar outra; `supabaseClient` aceita `VITE_SUPABASE_PUBLISHABLE_KEY` (ou ANON_KEY); `.env.local` recriado local (gitignored) com URL + publishable do Supabase local.
- **Testes:** unit 55/55 (+3 novos); E2E A novo/D retry/C existente/B login-sem-empresa — todos PASS com posterior (OWNER/Solo trial/settings/themes; seq só-admin por desenho); dados de teste removidos (0 restantes).
- **Build** OK; **lint** só os 11 pré-existentes. Segurança: sem service_role no front, sem migration/policy nova, remoto 0. Sem commit/push/db push.

## 13. QA realtime duplicado (2026-09-25, sem commit)

- **Causa raiz:** `supabase.channel(tópico)` devolve a MESMA instância; `subscribeCompanyTable` chamava `.on('postgres_changes')` a cada mount — AppLayout monta 2 NotificationBells + re-run do effect ao `sbActive` virar true → throw quebrava o Dashboard. (404 Base44 /analytics e 11 unused-imports NÃO tratados, fora do escopo.)
- **Correção (`src/api/orders.js` + `orders.test.js`):** registro idempotente por tópico com refcount e fan-out; `.on()` uma única vez; cleanup remove o channel só no último listener. Sem try/catch mascarando.
- **Validação:** unit 59/59 (+4 novos); real local: double-mount sem throw, INSERT/UPDATE nos 2 listeners, unmount parcial, remount; dados limpos. Build OK.
- Sem migration/RLS/RPC/schema novo; remoto 0; sem commit/push/db push.

## 14. FASE 5.4-C — Company + Storefront (2026-09-25, sem commit)

- **C1 migration (só local):** `20260925000006_dellyvery3_company_fields` (+slogan/cores/is_open/minimum/delivery_fee/estimativa/whatsapp/city/state/zip em `companies`; nada duplicado).
- **C2 RLS:** policies existentes já cobrem as colunas (row-level); OWNER/ADMIN validados, cross/anon bloqueados — sem alteração.
- **C3-C4:** `src/api/company.js` (company/settings/theme) + `useCompany.js` via identidade Supabase + adapter (sem null silencioso; redirect real).
- **C5:** `Configuracoes` salva via adapter (is_open=habilitar preservado); upload e Delivery como estavam.
- **C6-C8:** `20260925000007_dellyvery3_storefront` + `get_storefront_by_slug` (anon+auth, só display/ativos, sem tabelas abertas) + `src/api/storefront.js`; `Menu.jsx` e leitura do `Checkout.jsx` via RPC (createOrder já era RPC).
- **Testes:** unit 66/66 (+7); E2E real 17/17 storefront+RBAC (ativos, cross-tenant, anon sem SELECT, OWNER/ADMIN ok, is_open round-trip) + ADMIN extra; dados limpos.
- **Build** OK; **lint** só os 11 pré-existentes. Remoto 0; sem commit/push/db push.

## 15. FASE 5.4 UX Novo Pedido (2026-09-25, sem commit)

- **Novos:** `src/lib/deliveryRoute.js` (+7 testes: endereço/rota/auto-open/origem), `src/components/orders/RouteModal.jsx` (origem→destino, botão externo principal + iframe progressivo, sem key, sem ETA).
- **Alterados:** `OrderModal` (endereço delivery destacado/clicável, labels RETIRADA/MESA, prop company), `Pedidos` (linha 📍 no card delivery + company ao modal), `Dashboard` (company ao modal).
- **Preservados:** badge NOVO, som+fila/dedupe/throttle/janela, aceitar/cancelar, RPCs/migrations/RLS, realtime registry.
- **Validação:** unit 73/73; realtime E2E revalidado; build OK; lint só os 11 pré-existentes; dados limpos. Remoto 0; sem commit/push/db push.

## 16. FASE 5.5 ETAPA B1 — Equipe (2026-09-25, sem commit)

- **B1 migration (só função, local):** `20260925000009_dellyvery3_team_rpc` — `list_team(uuid default)` DEFINER, empresa derivada do auth.uid() (param opcional validado), só próprias empresas, anon revogado.
- **B2-B4:** item Equipe no menu + rota `/equipe`; `src/api/team.js` (members via RPC, drivers direto, labels novas, patches parciais); `src/pages/Equipe.jsx` (abas Funcionários/Entregadores, gating OWNER/ADMIN/leitura, sem delete de entregador na UI) + `DriverFormDialog.jsx` (sem upload).
- **B5:** unit 82/82 (+9); E2E real (RPC lista/isolamento/cross rejeitado/anon negado, drivers CRUD/isolamento/status) + ADMIN real (não desativa OWNER, não self-promove, posterior intacto); dados de teste removidos.
- **Regressão:** RLS SQL 81/82 — único FAIL é o 8a (`cnt=3`) por existir a empresa real `samuel` do usuário no banco (não é dado de teste; não removida); todo o resto verde.
- **Build** OK; **lint** só os 11 pré-existentes (5 meus removidos). Sem convite/upload/fornecedores/atribuição. Remoto 0; sem commit/push/db push.

## 17. FASE 5.5-B2 — Storage/Upload (2026-09-25, sem commit)

- **Migration (só local):** `20260925000010_dellyvery3_storage` — buckets públicos `avatars(user_id/)`, `logos/company_id/`, `catalog/company_id/`, limite 8 MB, MIME jpg/png/webp; 12 policies (SELECT público; escrita autenticada escopada: avatar=dono, demais=membro ativo).
- **Adapter** `src/api/storage.js` (+5 testes: 5 MB app, MIME, paths por dono, URL pública, erro).
- **Trocas:** logo (`Configuracoes`), avatar (`Perfil`, pasta do user), produto/categoria (bucket catalog); fallback Base44 sem sessão/empresa.
- **E2E real 9/9:** uploads, leitura pública, cross-company/avatar-alheio/anon/MIME/>8MB bloqueados; órfãos removidos (API + flag de cleanup local).
- **Build** OK; **lint** só os 11 pré-existentes. Remoto 0; sem commit/push/db push.

## 18. FASE 5.5-B3 — Atribuição Entregador→Pedido (2026-09-25, sem commit)

- **Adapter** `orders.assignDriver` (+4 testes): valida mesma empresa/ativo/não-terminal no adapter; trigger `trg_orders_company_refs` como segunda barreira (confirmada via SQL direto); history (old=new, oculto na timeline) + audit; sem notification.
- **UI:** `OrderModal` passo 🛵 (Select só ativos + Confirmar/Pular, só delivery→saiu_entrega); Kanban linha 🛵 com mapa de nomes.
- **E2E real 10/10:** atribuir/trocar/remover, cross e inativo e terminal bloqueados com posterior, history/audit, sem notification extra; dados limpos.
- **Unit 91/91; build OK; lint 11 pré-existentes.** Sem migration/RPC/RLS novas. Remoto 0; sem commit/push/db push.

## 19. UX Kanban + entregador no pedido (2026-09-25, sem commit)

- **Kanban:** setas ←/→ (desktop, scroll suave, drag intacto); **Voltar** explícito no `OrderModal` (=X).
- **Entregador no pedido:** seção delivery com nome atual + Alterar (reabre passo 🛵) + Remover; Kanban já mostrava 🛵.
- **Validação:** unit 91/91; E2E alterar/remover com posterior; build OK (1 erro JSX meu corrigido); lint 11 pré-existentes; dados limpos. Sem backend/Git/remoto tocados.

## 20. Correção fluxo entregador + setas Kanban (2026-09-25, sem commit)

- **OrderModal:** delivery com driver vinculado mostra confirmação (Manter/Alterar/Cancelar) antes de avançar; sem driver mantém o seletor; `resolveAdvanceFlow` puro + testes; Manter não reatribui; retirada/mesa/terminal intactos.
- **Kanban:** setas vão direto início/fim com `behavior:auto`; visual/drag intactos.
- **Validação:** unit 92/92; E2E manter/alterar com posterior; build OK; lint 11 pré-existentes; dados limpos. Sem backend/Git/remoto.

## 21. Cards fila/atraso → Dashboard (2026-09-25, sem commit)

- **Pedidos:** removidos os cards superiores (Kanban/colunas/drag/setas/modal intactos).
- **Regras centralizadas** em `src/lib/orderQueue.js` (+3 testes): fila = 5 status; atraso >30min — mesmos valores.
- **Dashboard:** 2 cards clicáveis (mesmo visual) + `OrdersListModal.jsx` (compacto, scroll, X/Voltar, click abre OrderModal existente); indicadores derivam de `orders` (realtime já atualiza).
- **Validação:** unit 95/95; realtime E2E revalidado; build OK; lint 11 pré-existentes; dados limpos. Sem backend/Git/remoto.

## 22. Dashboard compacto + finalizados por tipo (2026-09-25, sem commit)

- **Cards compactos** (p-4, 2 colunas): Pedidos hoje (só hoje), Em andamento, Finalizados, Cancelados, Na fila, Em atraso — todos clicáveis com modal.
- **Finalizados em 3 grupos:** Entregas/Retiradas/Mesas; filtro de entregador (Todos/Sem/cada) só no modal de Entregas.
- **Regras** em `orderQueue.js` (fonte única, +1 teste); modal com `headerExtra` p/ o Select; `driversById` carregado 1x.
- **Validação:** unit 96/96; build OK; lint 11 pré-existentes. Sem backend/Git/remoto.

## 23. Próximos passos bloqueados (aguardando autorização)

- NÃO criar banco/Supabase/VPS remoto adicional, NÃO migrar Auth/Base44 completamente, NÃO remover Base44, NÃO implementar novos módulos (entregadores, funcionários, caixa/PDV, preview, WhatsApp, Master, Marketing/Publicidade em breve). Conectar ao Lovable só após estabilizar `ZIP → DELLVERY 3 → GitHub`.

## 9. Comandos de verificação

```bash
Get-FileHash C:\Users\samue\Downloads\dellyvery.zip -Algorithm SHA256
git branch --show-current # feat/supabase-foundation
git log --oneline -5
npx supabase migration list # local 4 vs remote 0
psql -h 127.0.0.1 -p 54325 -U postgres -d postgres -f supabase/tests/rls_dellyvery3.sql
npm run build
npm run lint -- --quiet
```

## 24. Tracking com foto dos itens (2026-09-25, sem commit)

- **Migration local 20260925000011_dellyvery3_tracking_item_media.sql** (aplicada SOMENTE no Supabase local, versionada em schema_migrations): get_order_by_token recriado adicionando product_id + image_url (subquery mesma-empresa, null-safe) aos itens; demais campos e grants anon/authenticated intactos.
- **Frontend OrderTracking.jsx**: thumb h-12 w-12 rounded-lg object-cover via Image + fallback Package; polling/totais/checkout/tracking inalterados.
- **Validação:** RPC antes/depois via token real (#8/#9/#10); pedido misto (com/sem imagem); reload; token inválido segue 400; unit 98/98 (+teste contrato tracking); build OK; lint 0 erros nos arquivos do escopo. Sem RLS/policy nova, sem Storage, sem commit/push, sem db push.

## 26. FASE 1 — Kanban configurável por empresa (2026-10-08, branch feat/supabase-foundation)

- **Migration (só arquivo, sem db push — Docker indisponível no ambiente):** `supabase/migrations/20261008000000_dellyvery3_order_stages.sql` — tabela `restaurant_order_stages` (company_id, stage_key unique/company, maps_to order_status, name, color hex, sort_order, is_initial, is_final, active, timestamps) + triggers (updated_at, company_id/stage_key imutáveis, mapeamento legado travado, single initial/final) + seed das 7 etapas atuais p/ todas as companies + RLS (leitura membro, escrita OWNER/ADMIN/MANAGER) + realtime.
- **Compatibilidade:** `orders.status` continua fonte da verdade; `create/manage/get-by-token`, notifications `UNIQUE(order_id,status)`, finance, queue, checkout, tracking e PDV/Dashboard NÃO alterados. Stage custom mapeia p/ status legado (`maps_to`); delivery pula `aguardando_retirada` como no legado.
- **Frontend:** `src/api/orderStages.js` (+`orderStages.test.js`, 21 asserts) — CRUD com guardas (última etapa, coluna irmã + pedidos), reorder validado, fluxo puro 1-etapa (advance/regress, assertSingleStep, auto-close rule); `Pedidos.jsx` colunas dinâmicas + botão Etapas + drag 1-etapa + rollback; `StageManagerDialog.jsx` (criar/editar/cor/ordem/ativa/inicial/final/excluir); `OrderModal.jsx` botão VOLTAR explícito + auto-fecha após AVANÇAR (erro mantém aberto).
- **Validação:** `test:supabase` 196/196; `build` OK (chunk >500kB pré-existente); `lint` só os 7 `unused-imports` pré-existentes em outros arquivos.
- **Fora do escopo (worktree, não commitado aqui):** `Menu/Checkout/orderResume` (retomada de pedido, outro workstream).
- **Pendente:** aplicar migration no Supabase local/remoto (`db push`) e E2E com banco real; QA manual do modal/drag.

## 25. PDV + Ondas de independência Base44 (2026-09-28/29, branch feat/supabase-foundation)

- **PDV** (`1df9390`, `133da02`, `40c0404`): página `/pdv` (mesa/retirada/entrega), comandas por mesa derivadas de pedidos ativos (sem entidade Mesa), merge via edit+cancel, `OrderModal` reutilizado, painel fixo com scroll interno, Atualizações + anúncio visto-uma-vez.
- **Onda 1** (`6ef6d30`): removido fallback Base44 de 13 módulos com Supabase pronto (167/167, lint 0, build OK).
- **Fase 2 auth** (`e5ae5f2`): Login/Register/Forgot/Reset Supabase-only (link de confirmação, sem OTP/Google); wrappers `requestPasswordReset`/`updatePassword` + testes.
- **Onda 2B** (commit próprio): PageNotFound/useCompany/AppLayout/AuthContext/ProtectedRoute/CreateRestaurant Supabase-only; defaults do restaurante preservados via `updateCompany`.
- **Onda 3** (`16a6f26`): RPC `manage_subscription` (SECURITY DEFINER, OWNER/ADMIN, sem company_id do frontend) + adapter + Assinatura; SQL validado em Postgres real (15 casos).
- **Onda 4** (`6f59ed3`): removidos `@base44/sdk`, `@base44/vite-plugin`, `input-otp`, `base44Client.js`, `base44/config.jsonc`, 4 componentes órfãos; alias `@/` explícito no Vite (antes vinha do plugin); routeGuard sem param legado. Zero dependência técnica Base44 (restam só comentários/docs e `media.base44.com` em URLs antigas de imagem).
- **Publicação:** `LOCAL = GITHUB = VPS` via fluxo `push → git pull em ~/dellyvery-3-src → npm run build → cp dist/. ~/dellyvery-3/` (Nginx estático, sem PM2). Produção: `https://dellyvery.localapp.online`. Supabase projeto `dellyvery-3` (`kmpktvcjtxwenlgzjvog`).
- **Validação final:** suite 167-168/168, lint 0 erros novos, build OK, E2E 7 larguras + fluxos mesa/merge/desconto; QA criado nos testes foi cancelado (motivo registrado).


