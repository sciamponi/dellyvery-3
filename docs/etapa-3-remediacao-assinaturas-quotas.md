# Etapa 3 — Revisão crítica do plano de remediação de assinaturas e quotas

> **Status:** ANÁLISE E DOCUMENTAÇÃO. Nenhuma implementação.
> **Repositório:** `dellyvery-3` — branch `feat/supabase-foundation`
> **Commit de referência:** `3f1e026`
> **Data:** 2026-10-31
> **Regra desta etapa:** não alterar código, migrations, banco, configurações, dados ou ambiente.

## 0. Escopo, método e classificação

Este documento revisa o plano de assinatura/pagamentos existente em
`docs/fase-5a-assinatura.md` e o confronta com o código real do repositório.
Não foi encontrado nenhum documento anterior chamado “Etapa 3”; o artefato mais
próximo é a especificação da Fase 5A. Este texto substitui, para fins de revisão,
as premissas daquela especificação que não se confirmaram no código.

Toda afirmação abaixo usa uma das quatro classificações:

| Marca | Significado |
|---|---|
| **[EXISTENTE]** | Verificado diretamente em arquivo, migration, função, tabela, teste ou tela do repositório. |
| **[REGRA]** | Decisão de negócio confirmada pelo responsável do produto nesta etapa. |
| **[PROPOSTA]** | Desenho técnico sugerido, ainda não aprovado nem implementado. |
| **[PENDENTE]** | Ponto que exige decisão do responsável antes de implementação. |

Valores comerciais (preço, taxa, prazo de carência, limite de quota, validade de
trial) **não foram inventados**. Onde não há valor definido, o texto indica
“definido pelo Master” ou “a decidir”.

---

## 1. Resumo das decisões confirmadas

### D1 — Ciclo de assinatura

**[REGRA]** O período começa na data e hora da ativação. Exemplo: plano de 30
dias ativado hoje vence 30 dias depois da ativação; não é mês calendário. A
duração deve vir do período selecionado/configurado no plano, sem presumir 30
dias.

**O que o código mostra hoje [EXISTENTE]:**

- `plans` tem `billing_cycle` (`monthly|yearly`) como rótulo comercial e
  `access_days` (`integer`, nullable) como duração em dias
  (`supabase/migrations/20260924000000_dellyvery3_foundation.sql:163-178`,
  `supabase/migrations/20261109000000_dellyvery3_plan_access_days.sql:7-22`).
- O plano seed `solo` é `monthly`, preço `0`, sem `access_days`
  (`supabase/migrations/20260924000003_dellyvery3_seed_plans.sql:5-15`).
- `access_days` só é usado no fluxo de revenda; planos sem duração são recusados
  nesse fluxo (`supabase/migrations/20261109000001_dellyvery3_reseller_client_access.sql:695-707`).
- O onboarding direto ignora `access_days` e `trial_days`: cria trial de 7 dias
  fixos e plano `solo`
  (`supabase/migrations/20260924000001_dellyvery3_rls.sql:94-109` e
  `supabase/migrations/20261109000002_dellyvery3_company_access_gate.sql:136-148`).
- `manage_subscription('upgrade')` troca `plan_id` e, se o status era `trial`,
  passa para `ativo`, mas **não recalcula `started_at` nem `expires_at`**
  (`supabase/migrations/20261109000002_dellyvery3_company_access_gate.sql:228-245`).
- `manage_subscription('reactivate')` só volta o status para `ativo`; não cria
  novo ciclo (`supabase/migrations/20261109000002_dellyvery3_company_access_gate.sql:257-267`).

**Consequência [EXISTENTE]:** hoje um “plano pago” pode ser ativado sem
pagamento e com a data de expiração do trial. Isso conflita simultaneamente com
D1 e D5.

**[PROPOSTA]** Tornar `plans.access_days` a fonte canônica da duração de acesso
para ativações pagas (diretas e via revenda), mantendo `billing_cycle` apenas
como rótulo comercial. Ativação nova grava `started_at = now()` e
`expires_at = started_at + make_interval(days => access_days)`. Plano sem
`access_days` não pode ser ativado como pago; o Master precisa configurar.

**[PENDENTE]** Definir a base de renovação: estender a partir de
`max(now(), expires_at)` (padrão já usado na revenda) ou reiniciar em `now()`.
Definir também se `access_days` vale para planos gratuitos e como converter
`billing_cycle` em duração para planos legados.

### D3 — Carência configurável pelo Master

**[REGRA]** O prazo de carência para empresas diretas sem assinatura válida será
configurado no Painel Master por campo numérico. Não pode haver número fixo no
código ou no plano.

**O que o código mostra hoje [EXISTENTE]:**

- Não existe tabela global de configuração da plataforma. Existem
  `companies.settings` e `company_settings.settings` (por empresa), e campos
  comerciais em `plans`; nenhum é adequado para uma carência global
  (`supabase/migrations/20260924000000_dellyvery3_foundation.sql:104-148`).
- `company_has_active_access` retorna **verdadeiro para qualquer empresa que não
  esteja em `reseller_clients`**, mesmo sem assinatura, expirada ou inexistente
  (`supabase/migrations/20261109000002_dellyvery3_company_access_gate.sql:8-33`).
- Ou seja: hoje empresas diretas têm carência infinita na prática. O gate de
  assinatura só vale para clientes de revenda.

**[PROPOSTA]**

1. Criar configuração global (`platform_settings` ou `billing_settings`) com
   `grace_days integer not null default 0`, validação `>= 0`, alterável apenas
   por `PLATFORM_ADMIN`, com trilha em `audit_logs`.
2. Aplicar a carência a empresas **diretas** cuja assinatura esteja inválida
   (sem assinatura, `expirado`, `cancelado` após o fim, `pendente` sem
   confirmação, ou `trial` vencido), respeitando o estado de revenda já
   existente.
3. Para não afetar retroativamente empresas já atendidas, registrar a concessão
   em tabela própria com snapshot: `company_grace_grants(company_id,
   granted_at, grace_days, grace_until, reason, created_by)`. A alteração futura
   do campo global só vale para novas concessões.
4. Alternativa mais simples, porém menos auditável: `subscriptions.grace_until`
   + `grace_days_applied`. A tabela separada é preferível para histórico.

**[PENDENTE]** Valor da carência (não definir aqui), teto máximo, se conta a
partir do vencimento ou da concessão, se vale para trial vencido, se empresas
legadas recebem carência retroativa e a partir de quando.

### D5 — Compra de plano e pagamento Pix

**[REGRA]** Até existir cobrança automatizada: cliente escolhe plano → sistema
registra intenção/solicitação → apresenta chave Pix e QR Code configurados →
pagamento fica pendente → Master confirma manualmente com auditoria → somente
após confirmação válida o plano pago é ativado.

**O que o código mostra hoje [EXISTENTE]:**

- Não existe tabela, coluna, Edge Function, webhook ou configuração de Pix,
  Asaas ou Mercado Pago para assinatura.
- As únicas Edge Functions são `reseller-approve` e
  `reseller-invite-email-proof`
  (`supabase/functions/`).
- `@stripe/react-stripe-js` e `@stripe/stripe-js` estão em `package.json`, mas
  não há uso em `src/` — são dependências residuais, não integração.
- `src/api/payments.js` registra **recebimento de pedido** (declaração
  auditável), não pagamento de assinatura.
- O padrão manual mais próximo é a compra de créditos de revenda:
  `reseller_credit_orders` com `status` `pendente|creditado|cancelado`,
  `idempotency_key` única por revendedor, `payment_reference`, `confirmed_by`,
  `paid_at`, `credited_at` e `audit_logs`
  (`supabase/migrations/20261107000000_dellyvery3_reseller_credit_purchases.sql:35-65`).
  A confirmação é exclusiva de `is_platform_admin()`, usa `FOR UPDATE`,
  é idempotente e grava auditoria
  (`...:324-429`).
- A tela `Assinatura.jsx` hoje chama `manage_subscription('upgrade')` no botão
  “Assinar”, **sem solicitação de compra e sem pagamento**
  (`src/pages/Assinatura.jsx:113-122,235-246`).

**[PROPOSTA]**

1. Tabela `subscription_orders` (nome a confirmar) com snapshot do plano
   (`plan_id`, `plan_name`, `price`, `access_days`), `company_id`,
   `status` (`pendente|confirmado|cancelado|expirado`), `idempotency_key`,
   `payment_reference`, `confirmed_by`, `paid_at`, `activated_at`,
   `created_by`, timestamps.
2. Índice único parcial para impedir mais de uma solicitação pendente por
   empresa (a decidir se por empresa ou por empresa+plano).
3. RPC de criação da solicitação: valida OWNER/ADMIN, plano ativo com
   `access_days`, congela preço/duração, retorna instruções de pagamento.
4. RPC de confirmação manual: exclusiva de `PLATFORM_ADMIN`, `FOR UPDATE`,
   idempotente por `order_id`, exige `payment_reference`, grava `audit_logs`,
   ativa a assinatura na **mesma transação** e só então calcula
   `started_at/expires_at` com D1.
5. Configuração de Pix/QR: não embutir em código nem no bundle do cliente.
   Opções: (a) `platform_settings` com RLS restrita e leitura por RPC autenticada
   do dono da solicitação; (b) Edge secret + Edge Function que devolve as
   instruções. A chave Pix em si não é segredo forte, mas o QR e os dados do
   recebedor não devem ficar públicos. **[PENDENTE]** escolher entre QR estático
   configurado pelo Master e QR gerado por solicitação.
6. Preparação para Asaas sem afirmar integração: manter `provider` nullable,
   `external_customer_id`/`external_payment_id` nullable e uma tabela
   `payment_events(provider, external_event_id unique, payload, processed_at)`
   para idempotência futura de webhook. Nenhuma credencial, taxa ou contrato
   Asaas deve ser inventado.

**Anti-fraude/duplicidade [PROPOSTA]:** confirmação só no servidor; nunca aceitar
“pago” do frontend; `FOR UPDATE` na solicitação; idempotência por chave e por
`order_id`; uma única ativação por confirmação; auditoria com ator, valor,
referência e estado anterior; bloqueio de confirmação por quem não é Master.
**[PENDENTE]** se a confirmação manual exigirá dupla conferência ou anexo de
comprovante, e se haverá expiração automática da solicitação pendente.

### D7 — Uma empresa por CPF

**[REGRA]** Um CPF pode estar associado a somente uma empresa.

**O que o código mostra hoje [EXISTENTE]:**

- Não há CPF em `companies`, `profiles` ou `company_members`.
- `leads.cpf` e `leads.cnpj` existem apenas na captação pública
  (`supabase/migrations/20261009000000_dellyvery3_leads.sql:20-23`), com
  validação de dígitos em `is_valid_cpf`/`is_valid_cnpj`
  (`supabase/migrations/20261010000000_dellyvery3_leads_commercial.sql:15-74`).
- `reseller_clients.document` é texto livre, sem unicidade
  (`supabase/migrations/20261106000000_dellyvery3_reseller_modules.sql:1-18`).
- `customers.document` e `delivery_drivers.document` são documentos operacionais
  por empresa, não identificam o responsável legal.
- O onboarding (`CreateRestaurant.jsx`, `supabaseAuth.js`) **não coleta CPF**;
  coleta nome do restaurante, responsável, WhatsApp, e-mail e senha
  (`src/pages/CreateRestaurant.jsx:30-33,174-213`).
- `create_company_with_owner` não verifica se o usuário já possui outra empresa;
  só bloqueia cliente de revenda
  (`supabase/migrations/20261109000002_dellyvery3_company_access_gate.sql:87-161`).
- `company_members` permite o mesmo usuário em várias empresas
  (`unique(company_id,user_id)` apenas,
  `supabase/migrations/20260924000000_dellyvery3_foundation.sql:126-139`).
- `manage_subscription` recusa operar quando o usuário tem mais de uma empresa
  como OWNER/ADMIN
  (`supabase/migrations/20261109000002_dellyvery3_company_access_gate.sql:213-218`).
- O convite de revenda já bloqueia conta com qualquer membership ativo e conta
  já vinculada a outro cliente de revenda
  (`supabase/migrations/20261109000001_dellyvery3_reseller_client_access.sql:460-476`).

**Consequência [EXISTENTE]:** a regra “um CPF → uma empresa” não pode ser
aplicada hoje: não há CPF do responsável, não há unicidade e o modelo permite
múltiplas empresas por usuário.

**[PROPOSTA]**

1. Definir que a regra vale para o **CPF do responsável/OWNER**, não para todo
   membro da equipe. Caso contrário, um funcionário com CPF cadastrado em duas
   empresas seria bloqueado, o que conflita com `company_members`.
2. Criar entidade separada de identidade do responsável, por exemplo
   `company_owner_identities(company_id PK, user_id, cpf_digits, cpf_hash,
   created_at)`, com:
   - `cpf_digits` normalizado (somente dígitos) e validado por `is_valid_cpf`;
   - índice único em `cpf_digits` (e/ou `cpf_hash`) para garantir concorrência;
   - RLS restrita a OWNER/ADMIN da empresa e `PLATFORM_ADMIN`, sem expor em
     `companies` (que é lida por membros e pelo storefront);
   - `REVOKE` de `anon` e de `public`.
3. Escrita somente por RPC `SECURITY DEFINER`; capturar `unique_violation` e
   devolver mensagem genérica (“CPF já vinculado a outra empresa”), sem ecoar o
   CPF.
4. Não logar CPF em `audit_logs`, mensagens de erro, URLs ou telemetria; mascarar
   na UI (`***.***.***-**`).
5. Migração em duas fases: primeiro coluna/entidade nullable + índice único
   parcial; depois coleta/backfill; só então `NOT NULL` se todos os legados
   estiverem resolvidos.

**[PENDENTE]** Se a regra é CPF do OWNER ou de qualquer pessoa vinculada; se CPF
será obrigatório no onboarding imediatamente ou após campanha de coleta; se
CNPJ também terá regra; como tratar empresas legadas sem CPF e CPFs duplicados;
se haverá hash/criptografia em repouso além do índice único.

### D8 — Trial de 0 dias

**[REGRA]** Com `trial_days = 0`, o usuário ainda entra no fluxo como teste.

**O que o código mostra hoje [EXISTENTE]:**

- `plans.trial_days` existe com default `7` e check `>= 0`, mas é **informativo**:
  o onboarding continua criando trial de 7 dias fixos
  (`supabase/migrations/20261008000005_dellyvery3_plans_commercial.sql:6-18`;
  `supabase/migrations/20260924000001_dellyvery3_rls.sql:103-108`).
- O status é `trial`; não há distinção persistida entre “trial recém-iniciado” e
  “trial expirado” — a distinção é derivada de `expires_at`.
- `useSubscription` calcula `hasAccess = isActive || (isTrial &&
  trialDaysLeft > 0)`; com `expires_at` nulo ou no passado, trial não tem acesso
  (`src/hooks/useSubscription.js:46-54`).
- O backend `company_has_active_access` ignora assinatura para empresas diretas,
  então o frontend e o backend discordam sobre trial vencido de empresa direta.
- Não existe campo de origem (`trial`, `pago`, `gratuito`, `manual`) nem
  `canceled_at`/`trial_ends_at` em `subscriptions`
  (`supabase/migrations/20260924000000_dellyvery3_foundation.sql:180-194`).

**[PROPOSTA]** Manter o enum atual e adicionar, de forma incremental:

- `subscriptions.origin text` (`trial|paid|free|manual`) ou equivalente;
- `trial_started_at`/`trial_ends_at` (ou usar `started_at/expires_at` com
  `origin='trial'`);
- função de estado derivado (`access_state`) retornando algo como
  `trial_active`, `trial_expired`, `free_active`, `payment_pending`,
  `paid_active`, `grace`, `canceled_until_end`, `suspended`, `blocked`.

**Diferenciação proposta [PROPOSTA]:**

| Situação | Representação | Acesso operacional |
|---|---|---|
| Trial recém-iniciado | `status='trial'`, `origin='trial'`, `started_at <= now() < expires_at` | Sim, enquanto vigente |
| Trial expirado | `status='trial'`, `origin='trial'`, `expires_at <= now()` | Não (ou fluxo de teste limitado, a decidir) |
| Plano gratuito | `status='ativo'`, `origin='free'`, plano com preço `0` | Sim, conforme regra do plano |
| Plano pago pendente | `status='pendente'`, `origin='paid'`, sem ativação | Não |
| Assinatura paga ativa | `status='ativo'`, `origin='paid'`, `expires_at > now()` | Sim |
| Carência | `status` original + `grace_until > now()` | Sim, até `grace_until` |

**[PENDENTE]** Com `trial_days=0`, o produto quer (a) criar registro `trial` com
`expires_at = started_at` e acesso zero, exibindo “teste iniciado/expirado”, ou
(b) conceder algum acesso mínimo de teste? Também falta definir o que é “plano
gratuito” (o seed `solo` tem preço `0` e hoje é usado como plano do trial) e se
trial pode se converter automaticamente em gratuito.

---

## 2. Diagnóstico do modelo atual

### 2.1. Tabelas e tipos relevantes [EXISTENTE]

| Objeto | Estado verificado |
|---|---|
| `plans` | `id, name, slug unique, price, billing_cycle, features, limits, active, sort_order` + `description, annual_price, setup_fee, trial_days, sales_text, benefits` + `access_days` nullable. |
| `subscriptions` | `id, company_id unique, plan_id, status enum, started_at, expires_at, created_at, updated_at`. Sem histórico, sem `canceled_at`, sem `origin`, sem `grace_until`. |
| `subscription_status` | `trial, ativo, pendente, cancelado, suspenso, expirado`. |
| `companies` | Dados cadastrais/operacionais; não há CPF/CNPJ do responsável. |
| `company_members` | `company_id, user_id, role, active`; `unique(company_id,user_id)`; permite múltiplas empresas por usuário. |
| `audit_logs` | `company_id, user_id, action, entity, entity_id, metadata, created_at`; usado por revenda/créditos, não por assinatura. |
| `reseller_clients` | `document` texto livre, `user_id`, `company_id`, `access_expires_at`; sem unicidade de documento. |
| `reseller_activations` | `starts_on date`, `expires_on date` (perde hora), `access_days`, `previous_expires_at`, `new_expires_at`, `idempotency_key`. |
| `reseller_credit_orders` | Padrão de compra manual: status, snapshot, idempotência, `confirmed_by`, auditoria. |
| `leads` | `cpf`, `cnpj` na captação pública; não é identidade da empresa. |
| `order_payments` | **Não existe**; `src/api/payments.js` usa declaração de recebimento de pedido, não assinatura. |

### 2.2. Funções e fluxos [EXISTENTE]

| Função | Comportamento verificado | Problema para a Etapa 3 |
|---|---|---|
| `create_company_with_owner` | Cria empresa, OWNER, subscription `trial` de 7 dias no plano `solo`, settings/tema. | Ignora `plans.trial_days` e `plans.access_days`; não coleta/valida CPF; não impede múltiplas empresas. |
| `manage_subscription(action, plan_id)` | `upgrade|cancel|reactivate`; deriva empresa de `auth.uid()` + OWNER/ADMIN; recusa cliente de revenda; sem auditoria/idempotência. | `upgrade` ativa plano sem pagamento e sem recalcular datas; `reactivate` não cria novo ciclo; múltiplas empresas geram erro. |
| `activate_reseller_client_v2` | Ativa/renova cliente de revenda com 1 crédito; exige `access_days > 0`; usa `FOR UPDATE` no revendedor/cliente/plano; idempotência por `idempotency_key`; grava `audit_logs`. | Bom precedente de duração/idempotência, mas é só revenda; histórico em `date` perde hora. |
| `confirm_reseller_credit_order` | Confirmação manual exclusiva do Master, `FOR UPDATE`, idempotente, auditoria. | Bom precedente para D5; não ativa assinatura. |
| `company_has_active_access` | `true` para qualquer empresa fora de `reseller_clients`; para revenda exige `expires_at > now()` e status não cancelado/suspenso/expirado. | Empresa direta nunca é bloqueada; não há carência configurável. |
| `is_company_member` | `is_company_member_raw AND (platform_admin OR company_has_active_access)`. | Gate só efetivo para revenda. |
| `get_storefront_by_slug` / `trg_orders_active_company` | Bloqueiam loja/pedido quando `company_has_active_access` é falso. | Mesmo problema: empresa direta sempre liberada. |
| `get_my_reseller_client_access` | Deriva `pending|expired|active` para cliente de revenda. | Não cobre trial/pendente/gratuito de empresa direta. |

### 2.3. Frontend [EXISTENTE]

- `src/hooks/useSubscription.js:46-54`: `hasAccess` considera apenas `ativo` ou
  `trial` com dias restantes; não considera `cancelado` até o fim do período,
  `pendente`, `suspenso`, carência nem plano gratuito.
- `src/pages/Assinatura.jsx:113-122,235-246`: botão “Assinar” chama
  `manage_subscription('upgrade')` diretamente; não há checkout Pix.
- `src/pages/Assinatura.jsx:252-258`: “Histórico de pagamentos” é placeholder
  fixo (“Nenhum pagamento registrado”).
- `src/pages/MasterPlanos.jsx:216-217`: Master já edita `trial_days` e
  `access_days`; porém `trial_days` não é aplicado no onboarding.
- `src/pages/MasterDashboard.jsx` e `src/api/masterCompanies.js:4-6`: visão Master
  de empresas é somente leitura; não há confirmação de pagamento de assinatura.
- `src/pages/CreateRestaurant.jsx:15-20,69-72,96-121`: promete “7 dias grátis”
  fixos e não coleta CPF.
- `src/api/plans.js:44-75,111-136`: mapeia/valida `trial_days` e `access_days`,
  mas a validação de `access_days` exige `> 0`; `trial_days` aceita `0`.

### 2.4. Pagamentos e Asaas [EXISTENTE]

- Nenhuma tabela de cobrança de assinatura, nenhum campo Pix, nenhum webhook.
- Nenhuma Edge Function de billing.
- `@stripe/*` declarado em `package.json:46-47`, sem uso em `src/`.
- `src/api/payments.js` é recebimento de pedido, não assinatura.
- `docs/fase-5a-assinatura.md` descreve Asaas + Mercado Pago como **proposta**;
  nada disso existe no código.

### 2.5. Segurança e RLS [EXISTENTE]

- `subscriptions`: SELECT para membro/`PLATFORM_ADMIN`; escrita direta apenas
  `PLATFORM_ADMIN` (`supabase/migrations/20260924000001_dellyvery3_rls.sql:313-321`).
  `manage_subscription` é `SECURITY DEFINER` e escreve contornando a RLS, com
  validação própria de membership.
- `plans`: leitura pública/autenticada apenas `active=true`; `PLATFORM_ADMIN` vê
  tudo e escreve (`...:501-519`).
- `trg_immutable_company` impede troca de `company_id` em `subscriptions`
  (`supabase/migrations/20260925000000_dellyvery3_rls_hardening.sql:441-442`).
- Endurecimento recente: `search_path` determinístico em funções
  `SECURITY DEFINER`, `REVOKE` de `PUBLIC`/`anon`, default privileges
  restritivos e event trigger que revoga ACL de funções novas
  (`supabase/migrations/20261114000000_dellyvery3_helper_search_path.sql:14-32`;
  `supabase/migrations/20261115000000_dellyvery3_security_definer_hardening.sql:546-676`).
- Consequência para novas funções **[PROPOSTA]**: toda RPC nova precisa de
  `SET search_path = pg_catalog, public, pg_temp`, `REVOKE` explícito e `GRANT`
  posterior; o event trigger não deixa herdar `EXECUTE` de `PUBLIC`.
- `manage_subscription` e `company_has_active_access` têm grants históricos
  preservados para `authenticated` e `service_role`
  (`supabase/migrations/20261113000000_dellyvery3_reseller_security_hardening_acl.sql:123,148`).

### 2.6. Quotas [EXISTENTE]

- `plans.limits` é JSONB (`users`, `products`, `orders`, `customers`,
  `storage_mb`, `whatsapp`, `ia`), mas **nenhuma função/trigger/policy aplica
  quota**.
- `Assinatura.jsx:145-215` apenas exibe barras de uso; não bloqueia criação.
- Não há contadores atômicos, reservas ou tratamento de concorrência para
  limites. Qualquer enforcement novo precisa de desenho próprio.

### 2.7. Incoerências críticas encontradas

| # | Incoerência | Evidência | Impacto |
|---|---|---|---|
| 1 | Empresa direta nunca é bloqueada por assinatura | `company_has_active_access` (`20261109000002...:15-22`) | Carência/expiração não existem na prática para empresas diretas. |
| 2 | “Assinar” ativa plano sem pagamento | `Assinatura.jsx:113-122` + `manage_subscription` upgrade | Viola D5; risco de receita e de ativação indevida. |
| 3 | Upgrade não recalcula datas | `manage_subscription` upgrade | Viola D1; plano pago herda vencimento do trial. |
| 4 | `trial_days` não é aplicado | onboarding hardcoded 7 dias | Viola D8; `trial_days=0` não funciona. |
| 5 | `access_days` só existe para revenda | `activate_reseller_client_v2` | Não há duração canônica para planos diretos. |
| 6 | Cancelado não tem acesso até o fim no frontend | `useSubscription` | Divergência com a regra “acesso até `expires_at`”. |
| 7 | Revenda bloqueia cancelado imediatamente | `company_has_active_access` exclui `cancelado` | Divergência com D1/cancelamento no fim do período. |
| 8 | Histórico de ativação perde hora | `reseller_activations.starts_on/expires_on date` | Viola D1 (data e hora). |
| 9 | Múltiplas empresas por usuário | `company_members` + `create_company_with_owner` | Conflita com D7 e com `manage_subscription`. |
| 10 | Sem CPF do responsável | onboarding/`companies`/`profiles` | D7 não aplicável sem modelo novo. |
| 11 | Sem tabela/config de Pix/Asaas | busca no repo | D5 não implementável sem modelo novo. |
| 12 | Quotas só visuais | `plans.limits` + `Assinatura.jsx` | Limites não são garantidos. |
| 13 | Sem auditoria de assinatura | `manage_subscription` não grava `audit_logs` | Sem trilha para Master/contestação. |
| 14 | Status `suspenso`/`expirado` nunca são gravados | busca por `update subscriptions` | Estados existem no enum, mas não há transição que os produza. |

---

## 3. Plano de remediação revisado, por ondas

As ondas abaixo são **propostas** e dependem de aprovação. Nenhuma deve ser
implementada nesta etapa.

### Onda 0 — Decisões e inventário (somente leitura)

- Fechar as decisões pendentes da seção 8.
- Rodar consultas de diagnóstico **sem escrita**: assinaturas ausentes/inválidas,
  `access_days` nulo, `trial_days=0`, empresas diretas vencidas, múltiplos
  OWNER/ADMIN por usuário, CPFs/documentos duplicados, datas de revenda.
- Definir janela de backfill e comunicação.

**Saída:** relatório de dados + decisões assinadas. **Dependência:** nenhuma.

### Onda 1 — Modelo e configuração (migrations incrementais)

- Duração canônica de plano e semântica de trial.
- Configuração global de carência + snapshot de concessão.
- Solicitação de compra de assinatura + eventos de pagamento.
- Identidade CPF do responsável (nullable + unicidade parcial).
- Campos de estado/origem em `subscriptions`.

**Dependência:** Onda 0. **Não editar migrations históricas.**

### Onda 2 — Autoridade no servidor

- Nova `company_has_active_access` com estados de trial, gratuito, pago,
  pendente, carência, cancelado até o fim e suspenso.
- Nova `manage_subscription` (ou RPCs separadas) sem ativação sem pagamento;
  cálculo de datas por `access_days`; auditoria; idempotência; tratamento de
  múltiplas empresas.
- RPCs de solicitar/confirmar compra de assinatura (manual Master).
- RPC de cadastro/validação de CPF do responsável com unicidade.
- Enforcement de quotas (se aprovado), com concorrência atômica.

**Dependência:** Onda 1.

### Onda 3 — Backfill e legados

- Concessão de carência para empresas existentes com snapshot.
- Preenchimento de `access_days` somente com valor aprovado pelo Master.
- Coleta/resolução de CPF legado; não aplicar `NOT NULL` antes de zerar
  pendências.
- Reconciliação de datas de revenda (`date` → `timestamptz` quando aplicável).
- Dry-run, relatório de divergências e rollback documentado.

**Dependência:** Ondas 1 e 2.

### Onda 4 — Frontend e Painel Master

- Onboarding: trial conforme `plans.trial_days`, inclusive `0`; coleta de CPF se
  aprovada.
- `Assinatura.jsx`: fluxo “solicitar compra → instruções Pix → pendente →
  confirmado”; remover ativação direta por “Assinar”.
- Estados visuais distintos: trial ativo/expirado, gratuito, pendente, pago,
  carência, cancelado até o fim.
- Painel Master: campo numérico de carência, lista de solicitações pendentes,
  confirmação com referência/auditoria, configuração de Pix/QR.
- Remover promessa fixa de “7 dias” onde não for verdade.

**Dependência:** Ondas 2 e 3.

### Onda 5 — Preparação Asaas (futuro, não agora)

- Abstração `PaymentProvider` apenas quando aprovada.
- Webhook idempotente por `provider + external_event_id`.
- Nenhuma credencial em código; segredos somente em Edge secrets.
- Não afirmar que a integração existe até haver código e teste.

**Dependência:** Onda 4 e decisão comercial sobre Asaas.

### Onda 6 — Testes, observabilidade e rollout

- Suítes de segurança/RLS/concorrência/regressão (seção 6).
- Métricas: trials vencidos, carências ativas, solicitações pendentes,
  confirmações, ativações, falhas de unicidade de CPF.
- Rollout por feature flag/ambiente; rollback por migration reversível ou
  desligamento de gate.

**Dependência:** todas as anteriores.

---

## 4. Proposta de migrations incrementais (somente nomes e objetivos)

Não criar agora. Nomes são sugestões; timestamps devem seguir a ordem real de
aprovação. Todas devem ser aditivas, com `IF NOT EXISTS` quando possível, sem
editar migrations históricas.

| Nome proposto | Objetivo |
|---|---|
| `2026..._dellyvery3_subscription_state_semantics.sql` | Adicionar `origin`, `trial_started_at`/`trial_ends_at` (ou equivalentes), `canceled_at` e índices; sem alterar dados existentes. |
| `2026..._dellyvery3_platform_settings.sql` | Criar configuração global (ex.: `grace_days`), RLS restrita a `PLATFORM_ADMIN`, auditoria. |
| `2026..._dellyvery3_company_grace_grants.sql` | Criar concessões de carência com snapshot (`grace_days`, `grace_until`, motivo, autor). |
| `2026..._dellyvery3_subscription_orders.sql` | Criar solicitações de compra de plano, snapshot, idempotência, status e índices únicos parciais. |
| `2026..._dellyvery3_payment_events.sql` | Criar log idempotente de eventos de provedor para preparação futura (Asaas), sem integração. |
| `2026..._dellyvery3_company_owner_identities.sql` | Criar identidade CPF do responsável, normalização, unicidade parcial e RLS restrita. |
| `2026..._dellyvery3_subscription_access_state.sql` | Criar função de estado derivado e nova `company_has_active_access` com carência/trial/gratuito/pendente. |
| `2026..._dellyvery3_manage_subscription_v2.sql` | Substituir a RPC de assinatura: sem ativação sem pagamento, datas por `access_days`, auditoria, idempotência. |
| `2026..._dellyvery3_subscription_purchase_rpcs.sql` | RPCs de solicitar compra, obter instruções Pix e confirmar manualmente (Master). |
| `2026..._dellyvery3_quota_enforcement.sql` | (Se aprovado) funções/triggers de quota com reserva atômica e mensagens claras. |
| `2026..._dellyvery3_subscription_backfill.sql` | Backfill controlado de carência, `access_days` e reconciliação; com dry-run e relatório. |
| `2026..._dellyvery3_owner_cpf_backfill.sql` | Coleta/normalização de CPF legado e resolução de duplicidades; sem `NOT NULL` prematuro. |

**Ordem de dependência:** estado/configuração → carência/identidade/ordens →
funções de acesso/RPCs → backfill → frontend. Nenhuma migration de backfill deve
rodar antes das funções que validam o novo estado.

---

## 5. Plano de backfill e tratamento de dados legados

Nada nesta seção deve ser executado nesta etapa. Todas as consultas de
diagnóstico devem ser somente leitura.

### 5.1. Inventário mínimo (read-only)

1. Empresas sem linha em `subscriptions`.
2. Empresas diretas com `subscriptions.status` inválido ou `expires_at <= now()`.
3. Empresas com `status='ativo'` e `expires_at` nulo/vencido.
4. Planos ativos com `access_days` nulo.
5. Planos com `trial_days=0` e empresas criadas com trial de 7 dias.
6. Usuários com mais de uma empresa como OWNER/ADMIN.
7. `reseller_clients.document` vazio, inválido ou duplicado.
8. `reseller_activations` com `starts_on/expires_on` divergentes de
   `previous_expires_at/new_expires_at`.
9. Empresas com múltiplos OWNER (a regra de CPF precisa saber qual é o
   responsável).
10. Assinaturas `cancelado` com `expires_at` no futuro (acesso até o fim).
11. Assinaturas `pendente` antigas sem solicitação de compra correspondente.

### 5.2. Estratégia por dado

- **Carência:** conceder a empresas diretas existentes com assinatura inválida,
  no momento do backfill, usando o valor configurado naquele momento e gravando
  snapshot. Quem já recebeu não muda se o Master alterar o campo depois.
- **`access_days`:** não presumir 30 dias. Para cada plano ativo sem duração,
  exigir configuração explícita do Master antes de permitir ativação paga.
  Planos legados podem permanecer `NULL` e ser recusados na ativação, como já
  ocorre na revenda.
- **Trial:** empresas criadas com 7 dias fixos não devem ser retroativamente
  alteradas sem decisão; registrar a divergência e, se aprovado, ajustar apenas
  o estado derivado, não reescrever histórico.
- **CPF:** normalizar para dígitos; validar com `is_valid_cpf`; detectar
  duplicidades; não aplicar unicidade global enquanto houver duplicados ou
  ausentes. Empresas sem CPF ficam em estado “pendente de regularização” com
  prazo definido pelo produto. Duplicidades exigem decisão manual (qual empresa
  permanece) e registro em auditoria sem expor CPF.
- **Múltiplas empresas:** a regra D7 deve mirar o CPF do OWNER. Funcionários com
  membership em várias empresas continuam permitidos; se o produto quiser
  restringir pessoas físicas, isso é uma decisão separada e mais invasiva.
- **Revenda:** manter o gate atual como base; apenas alinhar a semântica de
  `cancelado` (acesso até `expires_at`) e converter histórico `date` para
  `timestamptz` quando a hora for necessária. Não reescrever ativações
  históricas sem aprovação.

### 5.3. Critérios de aceite do backfill

- Nenhuma empresa direta ativa perde acesso no dia da virada sem carência
  registrada.
- Nenhuma ativação paga é criada sem `access_days` válido.
- Nenhum CPF duplicado permanece sem registro de decisão.
- Relatório final com contagens antes/depois e lista de exceções.
- Rollback possível por remoção de concessões/ordens criadas na janela.

---

## 6. Testes de segurança, RLS, concorrência e regressão

### 6.1. Segurança e RLS

- `anon` não lê `subscriptions`, `subscription_orders`, `platform_settings`,
  `company_owner_identities` nem funções internas.
- Membro de empresa A não lê assinatura/CPF/ordens da empresa B.
- `PLATFORM_ADMIN` lê e escreve configuração/carência, mas não vê CPF em texto
  claro em telas indevidas.
- Escrita direta em `subscriptions` por OWNER/ADMIN continua bloqueada pela RLS;
  toda escrita passa por RPC.
- Novas funções `SECURITY DEFINER`: `search_path = pg_catalog, public, pg_temp`,
  `REVOKE` de `PUBLIC`/`anon`, `GRANT` explícito, sem herança de ACL.
- `manage_subscription` não permite empresa de terceiro, cliente de revenda,
  múltiplas empresas ambíguas, nem ativação sem pagamento.
- Confirmação de compra só por `PLATFORM_ADMIN`; replay não duplica ativação.
- CPF nunca aparece em `audit_logs`, mensagens de erro, URLs ou logs.

### 6.2. Concorrência

- Duas confirmações simultâneas da mesma solicitação → uma ativação, a segunda
  retorna o resultado existente.
- Duas solicitações simultâneas com a mesma `idempotency_key` → uma linha.
- Duas solicitações pendentes concorrentes para a mesma empresa → regra única
  decide (uma vence ou ambas são rejeitadas, conforme decisão).
- Duas renovações simultâneas → `FOR UPDATE` serializa e não perde/duplica dias.
- Dois cadastros simultâneos com o mesmo CPF → um vence, o outro recebe erro
  genérico de vínculo.
- Duas concessões de carência simultâneas → uma concessão ativa por empresa.
- Quotas: duas criações simultâneas no limite → nenhuma ultrapassa o limite.

### 6.3. Regressão

- Suítes SQL existentes: `supabase/tests/rls_dellyvery3.sql`,
  `rls_reseller_client_access.sql`, `rls_reseller_credit_purchases.sql`,
  `rls_security_definer_hardening.sql`, `rls_public_default_acl_hardening.sql`,
  `rls_master_reseller_self_access.sql`, entre outras.
- Suítes JS: `npm run test:supabase`, `npm run lint`, `npm run typecheck`,
  `npm run build`.
- Fluxos manuais: onboarding, trial 7/0, upgrade pago pendente, confirmação
  Master, cancelamento até o fim, reativação, carência, revenda, storefront de
  empresa vencida, pedidos bloqueados.
- Nenhum teste desta etapa pode gravar dados; testes de concorrência/backfill
  devem rodar em banco local/efêmero com transação revertida.

---

## 7. Riscos e medidas de mitigação

| Risco | Probabilidade | Impacto | Mitigação proposta |
|---|---|---|---|
| Bloquear empresas diretas existentes ao ativar o novo gate | Alta | Alto | Backfill de carência + feature flag + dry-run + rollback. |
| Ativação sem pagamento continuar possível | Alta | Alto | Remover `upgrade` direto; ativação só por RPC de confirmação; testes negativos. |
| Duplicidade de confirmação/ativação | Média | Alto | `FOR UPDATE`, idempotência única, uma ativação por solicitação, auditoria. |
| Fraude na confirmação manual | Média | Alto | Só Master, referência obrigatória, auditoria, dupla conferência (a decidir). |
| CPF duplicado/legado bloquear onboarding | Alta | Médio | Unicidade parcial, estado de regularização, resolução manual, sem `NOT NULL` precoce. |
| Exposição de CPF | Média | Alto | Tabela separada com RLS, mascaramento, mensagens genéricas, proibição em logs. |
| Plano sem `access_days` ativado por engano | Média | Médio | Recusar ativação paga; Master configura; validação no frontend e backend. |
| Divergência de fuso/data | Média | Médio | `timestamptz` em todo o ciclo; não usar `date` para regra de acesso; testes de virada. |
| Múltiplas empresas/OWNERs | Média | Médio | Regra D7 no OWNER; RPC explícita de empresa; não usar `limit 1`. |
| Quotas quebrarem operação existente | Média | Alto | Soft limit primeiro, relatório de excedentes, enforcement só após decisão. |
| Regressão de RLS/SECURITY DEFINER | Baixa/Média | Alto | Seguir padrão de hardening, testes dedicados, revisão de grants. |
| Assumir Asaas existente | Baixa | Médio | Deixar claro que é futuro; nenhuma credencial/valor inventado. |
| Configuração de carência alterar retroativamente | Média | Médio | Snapshot por concessão; campo global só afeta novas concessões. |

---

## 8. Decisões que ainda exigem aprovação do responsável

1. **D1 — duração/renovação:** `access_days` é a fonte canônica para planos
   diretos e de revenda? Renovação estende de `max(now(), expires_at)` ou
   reinicia em `now()`? O que fazer com planos legados sem `access_days`?
2. **D1 — plano gratuito:** o plano `solo` (preço `0`) é gratuito permanente ou
   apenas o plano usado no trial? Plano gratuito tem `expires_at` nulo ou data
   distante?
3. **D3 — carência:** qual valor (definido pelo Master), teto, início da contagem,
   abrangência (só empresas diretas? trial vencido? cancelado?) e se empresas
   legadas recebem carência retroativa.
4. **D5 — Pix/QR:** armazenar em `platform_settings` restrita ou Edge secret?
   QR estático do Master ou gerado por solicitação? Quem pode visualizar?
5. **D5 — confirmação manual:** exige comprovante/anexo? Dupla conferência?
   Prazo de expiração da solicitação pendente? Política de cancelamento/estorno?
6. **D5 — Asaas:** quando e se será integrado; qual escopo (assinatura apenas ou
   também pedidos); qual abstração mínima preparar agora sem implementar.
7. **D7 — escopo do CPF:** CPF do OWNER/responsável ou de qualquer pessoa
   vinculada? CNPJ também entra na regra? CPF obrigatório já no onboarding ou em
   campanha posterior?
8. **D7 — legado:** como resolver empresas sem CPF e CPFs duplicados? Qual prazo
   de regularização? Haverá bloqueio durante a pendência?
9. **D7 — privacidade:** CPF em texto, hash ou criptografia em repouso? Quem pode
   ver o CPF completo no Painel Master?
10. **D8 — trial 0:** acesso zero com registro de trial, ou acesso mínimo de
    teste? Como o usuário percebe “teste iniciado” sem confundir com plano
    gratuito?
11. **Quotas:** quais limites serão realmente aplicados, com que severidade
    (bloqueio ou aviso) e o que fazer com empresas já acima do limite.
12. **Master:** quem pode confirmar pagamento e alterar carência; exigência de
    auditoria e segregação de função.

---

## 9. Confirmação de estado e ausência de alterações

**Antes desta etapa:** `git status --porcelain` retornava exatamente **74**
alterações locais (23 arquivos modificados e 51 não rastreados), preservadas
integralmente. Branch `feat/supabase-foundation`, commit `3f1e026`.

**Durante esta etapa:**

- Nenhum código-fonte, migration, configuração, RLS, Edge Function ou banco foi
  alterado.
- Nenhuma migration, backfill, seed ou teste com escrita foi executado.
- Nenhum comando de commit, push, deploy ou acesso a produção foi executado.
- Nenhuma migration histórica foi editada.
- Nenhum valor comercial, credencial, taxa ou prazo foi inventado.

**Depois desta etapa:** a única divergência esperada é a criação deste documento
(`docs/etapa-3-remediacao-assinaturas-quotas.md`). As 74 alterações locais
originais permanecem intactas. O estado final do Git deve ser confirmado com
`git status --porcelain` antes de qualquer aprovação.

---

## 10. Conclusão para aprovação

O modelo atual **não sustenta** as decisões D1, D3, D5, D7 e D8 sem mudanças
incrementais. Os bloqueios mais críticos são: empresa direta sem gate de
assinatura, ativação de plano sem pagamento, ausência de duração canônica,
`trial_days` ignorado, ausência de CPF do responsável e ausência de qualquer
estrutura de cobrança Pix/Asaas.

A ordem segura é: decisões → modelo/configuração → funções de autoridade →
backfill → frontend → testes/rollout. Nenhuma implementação deve começar antes
da aprovação explícita das pendências da seção 8.

**AGUARDANDO REVISÃO E APROVAÇÃO. NENHUMA IMPLEMENTAÇÃO REALIZADA.**
