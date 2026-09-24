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

## Pendências para FASE 2 (não iniciar sem autorização)

- Schema Supabase + RLS por `company_id` + `PLATFORM_ADMIN`.
- Adapter `supabaseClient` espelhando `base44.entities` + Realtime.
- Migração de functions para VPS (`createOrder` público server-side price, `manageOrder` etc.).
- Módulos novos (entregadores, funcionários, caixa/PDV, preview/QR, WhatsApp provider, Master, Marketing em breve) — só arquitetura nesta fase.
