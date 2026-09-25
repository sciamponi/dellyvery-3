# DELLVERY 3 — MASTER_LOG

Log de decisões da FASE 1 (chronológico). Próximas fases adicionam entradas no topo ou seção nova.

## 2026-09-23 — FASE 1: Fundação a partir do ZIP

**Decisão:** Usar `C:\Users\samue\Downloads\dellyvery.zip` como fonte funcional canônica, sem versionar ZIP no Git, registrando apenas hash SHA-256 em `PROJECT_STATE.md:1`.
**Motivo:** Preservar funcionalidade existente e rastreabilidade sem poluir repositório.

**Decisão:** Trabalhar exclusivamente em `dellyvery-3` (`https://github.com/sciamponi/dellyvery-3.git`), branch `chore/init-from-zip`, sem tocar em DELLYVERY NOVO / 2.0.
**Motivo:** Repositório novo independente exigido; `git remote -v` confirmou `dellyvery-3.git` correto.

**Decisão:** Antes de remover TanStack, verificar `git status` clean e criar branch; evitar `force push` mesmo com divergência Lovable auto-commits (2ff1e31, 7e66ea9). Resolver com fix commit `741600e` em vez de `git push --force`.
**Motivo:** Regra `AGENTS.md: NÃO fazer force push`; Lovable sync cria commits automáticos na branch atual.

**Decisão:** Substituir boilerplate TanStack por ZIP via `robocopy /XD .git node_modules`, preservando `.git` e `.lovable/project.json`, removendo `vite.config.ts/tsconfig.json/bun.lock` e `src/routes/.tanstack`.
**Motivo:** ZIP é Vite+React Router, TanStack Start conflita (vite 8.1.5 vs 6.1.0, plugin @lovable.dev/vite-tanstack-config).

**Decisão:** `.gitignore` do ZIP prevalece (inclui `base44/.app.jsonc`, `.vite`), mantendo `public/` do workspace.
**Motivo:** ZIP já filtra corretamente; TanStack `.gitignore` tinha entradas irrelevantes (`.vinxi`, `.tanstack/**`, `bun.lock`).

**Decisão:** `npm install` limpo após remover `node_modules` stale; `package-lock.json` do ZIP (366k, vite 6.1.0) é a verdade. Build `vite 6.4.3` com warning de chunk 838kB não é bloqueante; 11 erros `unused-imports` não são corrigidos nesta fase.
**Motivo:** Só corrigir erros que impedem build, preservar regras de negócio.

**Decisão:** Identidade produto = **DELLVERY 3**, diretório `dellyvery-3` inalterado (`package.json:name dellyvery` mantido por compatibilidade, docs usam DELLVERY 3).
**Motivo:** Ajuste obrigatório FASE 1 item 1.

**Decisão:** Arquitetura FASE 2: escrita única no **Supabase Postgres (BANCO A principal)**, **Postgres VPS (BANCO B)** como cópia/redundância com `pg_dump` diário + WAL + retenção S3, sem replicação bidirecional. Lovable permanece só como editor frontend, GitHub fonte oficial.
**Motivo:** Evitar divergência de escrita simultânea; runbook de failover definido em `ARCHITECTURE.md`.

## 2026-09-24 — FASE 2: RLS validado localmente

**Decisão:** Criar `20260924000001_dellyvery3_rls.sql` com 4 helpers `SECURITY DEFINER SET search_path=public` (`is_company_member`, `member_role`, `is_platform_admin`, `create_company_with_owner`) + 80 policies, sem bypass genérico PLATFORM_ADMIN. `company_members` INSERT direto bloqueado (`WITH CHECK false`), primeiro OWNER só via função que usa `auth.uid()` (sem param user_id). `cash_movements` valida `company_id` + `exists (cash_registers.company_id = company_id)`. `order_items/history` via `orders.company_id`, `profiles` bloqueia `platform_role` escalada.
**Motivo:** Isolamento por `company_members.user_id=auth.uid()` + `company_id`, onboarding seguro, corrigir concorrência order_number via `company_order_seq`.

**Decisão:** Validar via `supabase/tests/rls_dellyvery3.sql` com 2 usuários (A/B) + PLATFORM_ADMIN + OPERATOR, 19 cenários / 42 asserts, todos PASS como `authenticated` (posterior state verificado). Docker Desktop parado inicialmente, mas `npx supabase migration up` aplicou 4 migrations; `db reset` com timeout devido a porta 54325/analytics, mas `migration up` confirmou. Supabase local `54325` com `supabase local development setup is running`.
**Motivo:** Não usar superuser para RLS, confirmar isolamento, inactive, papéis, platform_role, onboarding, cash_movements cross-register, subscriptions/admin, audit_logs, segments/plans.

**Decisão:** Manter `supabase/tests/rls_dellyvery3.sql` como suíte permanente (não remover), preservar `supabase/config.toml` diff (porta 54325, analytics desativado) localmente sem commit automático.
**Motivo:** FASE 5 — limpeza preserva teste útil; FASE 6 documentação atualizada mas sem push remoto (remote ainda 0 migrations).

## 2026-09-25 — FASE 5.1: Supabase Auth + contexto da empresa (sem commit)

**Decisão:** Nova camada `src/api/supabaseClient.js` (anon key) + `src/api/supabaseAuth.js` (auth, profile, memberships, segmento `restaurant`, RPC `create_company_with_owner`, `signUpRestaurant`) + `src/lib/SupabaseAuthContext.jsx` (user/session/loading/profile/memberships/currentCompany/currentRole) coexistindo com Base44: provider adicionado por fora no `App.jsx`, `ProtectedRoute` aceita qualquer das sessões, `Login`/`AppLayout`/`CreateRestaurant` usam Supabase só quando `VITE_SUPABASE_*` existe, senão fluxo Base44 byte-idêntico.
**Motivo:** Login Supabase funcional sem quebrar nenhum módulo; sem env, app comporta-se como antes; empresa sempre via DEFINER (sem INSERT direto); seleção multi-empresa só quando >1 membership.

**Decisão:** Testes `node:test` sem rede (client mockado) em `supabaseAuth.test.js` + `frontendAuth.test.js`: 22/22 PASS. Build OK; lint mantém só os 11 `unused-imports` da FASE 1.
**Motivo:** Cobrir guard, sessão, profile, role, sem-empresa, RPC e slugify semInfra extra; sem `db push`/push.

## 2026-09-25 — FASE 5.2: Categorias + Produtos no Supabase (sem commit)

**Decisão:** Após ETAPA A aprovar o mapa, migration incremental só-ADD (`20260925000001`, aplicada só local) + trigger mesma-empresa para `category_id` (FK atual não garantia); adapter `catalog.js` com mapeamentos e updates parciais; 3 telas com branch Supabase/Base44 por `sbActive`; upload mantido no Base44; Menu/OrderModal/Dashboard/Assinatura preservados.
**Motivo:** Fidelidade funcional sem perda de campos; RLS+trigger no banco, adapter como defesa em profundidade; validação 34/34 unit + 16/16 E2E + RBAC, tudo local.

## 2026-09-25 — FASE 5.3: Clientes + Delivery Zones no Supabase (sem commit)

**Decisão:** Migration incremental (`20260925000002`, só local): colunas customers + triggers mesma-empresa em orders (customer/zone/driver) e whatsapp_messages (connection/customer); adapters com endereço jsonb↔planos e dedupe preservada; 3 pontos de tela com branch Supabase/Base44; Checkout/zones-anon e drivers fora do escopo.
**Motivo:** Cobrir CRUD/filtros/favoritos/bloqueados/tags/importação sem quebrar Pedidos; validação 44/44 unit + 20/20 E2E + 5/5 RBAC, tudo local.

## Pendências para FASE 2 restante

- Adapter `supabaseClient` espelhando `base44.entities` + Realtime.
- Migração de functions para VPS (`createOrder` público server-side price, `manageOrder` etc.).
- Módulos novos (entregadores, funcionários, caixa/PDV, preview/QR, WhatsApp provider, Master, Marketing em breve) — só arquitetura nesta fase.
- `npx supabase db push` remoto somente após autorização (gate final).
