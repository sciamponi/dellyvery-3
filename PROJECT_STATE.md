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

## 10. Próximos passos bloqueados (aguardando autorização)

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
