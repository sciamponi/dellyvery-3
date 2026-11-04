# Etapa 3 — Especificação de compra de plano com Pix e CPF do responsável

> **Status:** ESPECIFICAÇÃO. Nenhuma implementação foi realizada.
> **Data:** 2026-10-31.
> **Repositório:** `dellyvery-3` — branch `feat/supabase-foundation`, commit de referência `3f1e026`.
> **Fonte de decisões:** `docs/etapa-3-decisoes-pendentes.md`.
> **Regra desta etapa:** este documento não altera código, migrations, banco,
> configuração, testes ou documentos existentes. Não cria valores comerciais,
> não assume Asaas e não define política de preço, prazo, comprovante ou estorno
> sem aprovação do responsável.

## Legenda

- `[EXISTENTE]` — comportamento ou objeto já presente no repositório/banco.
- `[REGRA]` — decisão já aprovada pelo responsável.
- `[PROPOSTA]` — desenho técnico recomendado, ainda não implementado.
- `[PENDENTE]` — decisão comercial, jurídica ou operacional que depende do
  responsável antes da implementação correspondente.

---

## 0. Resumo executivo

Este documento especifica duas ondas independentes:

1. **Compra de plano com Pix e confirmação manual** (decisão 5).
2. **CPF do OWNER/responsável** (decisões 7 e 9).

As duas ondas podem ser implementadas separadamente. A sequência aprovada em
`docs/etapa-3-decisoes-pendentes.md` coloca o CPF antes da compra/Pix, mas a
compra não depende tecnicamente do CPF. A ordem final pode ser ajustada pelo
responsável sem alterar este desenho.

O ponto mais importante da compra é que **o fluxo atual de upgrade não cobra
nada**: `Assinatura.jsx` chama `manage_subscription('upgrade')`, que troca o
plano e ativa a assinatura diretamente. Esse caminho precisa ser fechado para
planos pagos antes de a compra com Pix entrar em produção, senão a nova tela de
compra pode ser ignorada.

O ponto mais importante do CPF é que ele **não pode ir para `companies` nem
para `profiles`**: essas tabelas são lidas por membros, storefront e telas
operacionais. O CPF deve ficar em estrutura restrita, com máscara para leitura,
hash para unicidade e acesso completo somente por RPC auditada.

---

## 1. Inventário verificado

| Item | Estado | Evidência |
|---|---|---|
| `plans` | `[EXISTENTE]` | `id`, `name`, `slug`, `price`, `billing_cycle`, `features`, `limits`, `active`, `sort_order`, `description`, `annual_price`, `setup_fee`, `trial_days`, `access_days`, `is_free`. |
| `subscriptions` | `[EXISTENTE]` | `company_id` único, `plan_id`, `status` (`trial`, `ativo`, `pendente`, `cancelado`, `suspenso`, `expirado`), `started_at`, `expires_at`, `canceled_at`. |
| `platform_settings` | `[EXISTENTE]` | Linha única (`id = true`), `subscription_grace_days`, `subscription_gate_enabled`, `updated_by`. RLS somente `PLATFORM_ADMIN`; leitura concedida a `authenticated`, escrita apenas por RPC. |
| `audit_logs` | `[EXISTENTE]` | `company_id`, `user_id`, `action`, `entity`, `entity_id`, `metadata`, `created_at`. Leitura/inserção por membro; exclusão somente Master. |
| `company_grace_grants` | `[EXISTENTE]` | Snapshot de carência por concessão; não será reutilizado para compra. |
| `manage_subscription` | `[EXISTENTE]` | Ações `upgrade`, `cancel`, `reactivate`; não recebe valor, não registra pagamento e não audita a troca. |
| `company_has_active_access` | `[EXISTENTE]` | Gate desligado por padrão; preserva comportamento legado enquanto `subscription_gate_enabled = false`. |
| `is_valid_cpf` / `is_valid_cnpj` | `[EXISTENTE]` | Funções no schema `public`, criadas em `20261010000000_dellyvery3_leads_commercial.sql`. |
| CPF em `leads` | `[EXISTENTE]` | CPF já é coletado no fluxo de lead PF, mas não existe CPF de empresa/responsável. |
| CPF em `companies` / `profiles` | `[AUSENTE]` | Não existe coluna de CPF nessas tabelas. |
| Compra de plano | `[AUSENTE]` | Não existe tabela, RPC ou tela de solicitação de compra de plano. |
| Configuração Pix/QR | `[AUSENTE]` | Não existe tabela ou RPC para chave Pix, QR ou instruções de pagamento. |
| Compra de créditos de revenda | `[EXISTENTE]` | `reseller_credit_packages` + `reseller_credit_orders` com snapshot, idempotência e confirmação manual. Serve como referência de padrão, não como base direta. |
| Frontend de assinatura | `[EXISTENTE]` | `src/pages/Assinatura.jsx` lista planos e chama upgrade direto. |
| Frontend Master de planos | `[EXISTENTE]` | `src/pages/MasterPlanos.jsx` já possui card de carência/gate e edição de planos. |
| Rotas Master | `[EXISTENTE]` | `/master`, `/master/empresas`, `/master/planos`, `/master/revenda/creditos`. |
| `pgcrypto` | `[EXISTENTE COM RESSALVA]` | A foundation tenta criar `pgcrypto`; migrations posteriores usam `extensions.digest` e `extensions.gen_random_bytes`. Há registro de indisponibilidade em um ambiente local. A disponibilidade de `pgp_sym_encrypt` e de Vault precisa ser validada antes da onda de CPF. |

### 1.1 Regras já aprovadas que impactam este documento

- `[REGRA]` O ciclo começa na ativação e usa `plans.access_days`.
- `[REGRA]` Renovação estende de `max(now(), expires_at)`.
- `[REGRA]` Plano gratuito é explícito (`plans.is_free`), não inferido por preço.
- `[REGRA]` Pix/QR com confirmação manual antes da ativação.
- `[REGRA]` Asaas fica para fase posterior; não assumir integração existente.
- `[REGRA]` Um CPF associado a somente uma empresa.
- `[REGRA]` CPF do OWNER/responsável; CNPJ é regra separada.
- `[REGRA]` Somente `PLATFORM_ADMIN` confirma pagamento e altera carência.
- `[REGRA]` Toda confirmação e alteração sensível precisa de auditoria.
- `[REGRA]` Legado sem CPF ou com CPF duplicado não pode ser bloqueado em massa.

---

# Parte A — Compra de plano com Pix e confirmação manual

## A.1 Objetivo

Permitir que uma empresa autenticada solicite a compra ou renovação de um plano
pago, receba instruções Pix, informe a referência do pagamento e aguarde a
confirmação de um `PLATFORM_ADMIN`. A assinatura só é ativada depois da
confirmação manual. Nenhum cliente pode confirmar o próprio pagamento.

## A.2 Lacuna atual

`[EXISTENTE]` O fluxo atual é:

1. `src/pages/Assinatura.jsx` chama `manageSubscription({ action: 'upgrade', planId })`.
2. `src/api/subscriptions.js` chama a RPC `manage_subscription`.
3. A RPC troca `subscriptions.plan_id` e, se o status for `trial`, muda para
   `ativo`, sem valor, sem referência, sem comprovante e sem auditoria.

`[PROPOSTA]` Para planos pagos, esse caminho deve ser substituído por uma
solicitação de compra. `manage_subscription` pode continuar existindo para
`cancel` e `reactivate`, e para ativação de plano gratuito, mas **não pode
ativar plano pago sem confirmação**.

`[PENDENTE]` Definir se o upgrade entre planos pagos no meio do ciclo gera
nova compra, proração ou apenas troca de plano. Este documento recomenda que a
primeira versão trate toda troca para plano pago como uma nova compra, sem
proração, mas isso é decisão comercial.

## A.3 Atores e permissões

| Ator | Pode solicitar | Pode confirmar | Pode rejeitar/cancelar | Observação |
|---|---|---|---|---|
| OWNER | Sim | Não | Sim, antes da confirmação | Responsável pela empresa. |
| ADMIN | Sim | Não | Sim, antes da confirmação | Mesmo nível operacional do OWNER para cobrança. |
| Outros membros | Não | Não | Não | Não veem dados de cobrança. |
| `PLATFORM_ADMIN` | Não pelo fluxo da empresa | Sim | Sim | Confirmação manual auditada. |
| Revendedor | Não | Não | Não | Empresa gerenciada por revendedor continua bloqueada para compra direta. |

`[PROPOSTA]` Criar um helper estável `can_manage_company_billing(p_company_id)`
que retorna verdadeiro apenas para membro ativo com papel `OWNER` ou `ADMIN`.
Não usar `is_company_member` puro, porque ele inclui qualquer membro.

## A.4 Modelo de dados proposto

### A.4.1 Configuração Pix

`[PROPOSTA]` Criar uma tabela singleton restrita, separada de `platform_settings`
para não misturar configuração de assinatura com segredo operacional e para
permitir evolução futura de provedor.

Tabela `platform_pix_settings`:

| Campo | Tipo sugerido | Finalidade |
|---|---|---|
| `id` | boolean, PK, default true, check `id` | Linha única. |
| `active` | boolean, default false | Habilita exibição de instruções. |
| `pix_key_type` | text | `cpf`, `cnpj`, `email`, `phone` ou `random`. |
| `pix_key` | text | Chave Pix. Nunca vai para tabela pública nem para o bundle. |
| `receiver_name` | text | Nome do recebedor exibido ao cliente. |
| `qr_image_url` | text | URL privada ou caminho de Storage; não usar bucket público. |
| `qr_payload` | text | Payload copia-e-cola, se o produto optar por ele. |
| `instructions` | text | Texto operacional para o cliente. |
| `version` | integer, default 1 | Versão da configuração para detectar troca durante solicitação pendente. |
| `updated_at` | timestamptz | Controle. |
| `updated_by` | uuid | Master que alterou. |

`[PENDENTE]` Definir se o QR será fixo do Master (recomendado para v1) ou
gerado por solicitação. O documento recomenda QR fixo na primeira versão.

`[PENDENTE]` Definir se a chave/QR pode ser vista por todos os OWNER/ADMIN da
empresa ou somente por quem abriu a solicitação. O documento recomenda que
qualquer OWNER/ADMIN da empresa possa ver as instruções da solicitação, porque
a cobrança é da empresa, não da pessoa.

### A.4.2 Solicitação de compra

Tabela `plan_purchase_requests`:

| Campo | Tipo sugerido | Finalidade |
|---|---|---|
| `id` | uuid, PK | Identificador público da solicitação. |
| `company_id` | uuid, FK `companies` | Empresa compradora. |
| `requested_by` | uuid, FK `profiles` | Quem abriu. |
| `plan_id` | uuid, FK `plans` | Plano escolhido. |
| `plan_name_snapshot` | text | Nome no momento da solicitação. |
| `plan_slug_snapshot` | text | Slug no momento da solicitação. |
| `price_snapshot` | numeric(10,2) | Preço no momento da solicitação. |
| `currency_snapshot` | text, default `BRL` | Moeda do snapshot. |
| `billing_cycle_snapshot` | text | Ciclo do plano no momento. |
| `access_days_snapshot` | integer | Duração do acesso no momento. |
| `is_free_snapshot` | boolean | Impede compra acidental de plano gratuito. |
| `status` | text | `pendente`, `confirmada`, `rejeitada`, `cancelada`, `expirada`; `estornada` se aprovado. |
| `payment_method` | text, default `pix` | Primeira versão somente Pix. |
| `payment_reference` | text | Referência informada pelo cliente. |
| `proof_url` | text | Anexo, se exigido. |
| `payer_name` | text | Nome de quem pagou, se necessário para conciliação. |
| `confirmed_amount` | numeric(10,2) | Valor conferido pelo Master. |
| `confirmed_currency` | text | Moeda conferida. |
| `confirmed_by` | uuid, FK `profiles` | Master que confirmou. |
| `confirmed_at` | timestamptz | Data da confirmação. |
| `rejected_by` | uuid, FK `profiles` | Master que rejeitou. |
| `rejected_at` | timestamptz | Data da rejeição. |
| `canceled_by` | uuid, FK `profiles` | Quem cancelou. |
| `canceled_at` | timestamptz | Data do cancelamento. |
| `expired_at` | timestamptz | Data de expiração. |
| `reason` | text | Motivo da rejeição/cancelamento/estorno. |
| `idempotency_key` | uuid | Chave de idempotência da criação. |
| `pending_expires_at` | timestamptz | Expiração configurável; nulo se não houver prazo. |
| `pix_settings_version` | integer | Versão das instruções exibidas. |
| `activated_at` | timestamptz | Marca que a assinatura foi ativada. |
| `provider` | text | Nulo na v1 manual; preparação para provedor futuro. |
| `provider_charge_id` | text | Nulo na v1. |
| `provider_status` | text | Nulo na v1. |
| `metadata` | jsonb, default `{}` | Dados não sensíveis. |
| `created_at` / `updated_at` | timestamptz | Controle. |

Restrições e índices recomendados:

- `unique (company_id, idempotency_key)`.
- Índice único parcial para impedir mais de uma solicitação `pendente` por
  empresa: `(company_id) where status = 'pendente'`.
- Índice `(status, created_at desc)` para a fila do Master.
- Índice `(company_id, created_at desc)` para o histórico da empresa.
- Check de coerência: `status = 'confirmada'` exige `confirmed_by`,
  `confirmed_at` e `activated_at`; `status = 'rejeitada'` exige
  `rejected_by`/`rejected_at`; `status = 'cancelada'` exige
  `canceled_by`/`canceled_at`; `status = 'expirada'` exige `expired_at`.
- Check de snapshot: `price_snapshot >= 0`, `access_days_snapshot > 0`,
  `currency_snapshot ~ '^[A-Z]{3}$'`.

`[PENDENTE]` Definir se o comprovante/anexo é obrigatório. O campo `proof_url`
fica opcional até a decisão.

`[PENDENTE]` Definir o prazo de expiração. O campo `pending_expires_at` fica
nulo enquanto não houver valor aprovado; a expiração automática não deve ser
inventada.

`[PENDENTE]` Definir a política de cancelamento/estorno. O status `estornada` é
uma possibilidade, não uma decisão tomada.

### A.4.3 Histórico de eventos

`[PROPOSTA]` Criar `plan_purchase_events` append-only para preservar o ciclo de
vida mesmo que a solicitação mude de estado. `audit_logs` continua sendo a
trilha global; a tabela de eventos é a trilha específica da compra.

| Campo | Finalidade |
|---|---|
| `id` uuid | Identificador. |
| `request_id` uuid, FK | Solicitação. |
| `event_type` text | `created`, `payment_submitted`, `confirmed`, `rejected`, `canceled`, `expired`, `refunded`. |
| `from_status` / `to_status` text | Transição. |
| `actor_id` uuid | Quem executou. |
| `reason` text | Motivo, quando houver. |
| `metadata` jsonb | Dados não sensíveis. |
| `created_at` timestamptz | Data. |

Não permitir `UPDATE`/`DELETE` nessa tabela pela aplicação. A correção de
histórico é feita por novo evento, nunca por apagar o anterior.

## A.5 Ciclo de vida

`[PROPOSTA]` Transições permitidas:

| De | Para | Quem | Condição |
|---|---|---|---|
| — | `pendente` | OWNER/ADMIN da empresa | Plano ativo, pago, com `access_days > 0`, sem outra pendência. |
| `pendente` | `pendente` | OWNER/ADMIN | Atualização de referência/comprovante, sem ativar. |
| `pendente` | `confirmada` | `PLATFORM_ADMIN` | Valor confere, referência obrigatória, solicitação não expirada. |
| `pendente` | `rejeitada` | `PLATFORM_ADMIN` | Motivo obrigatório. |
| `pendente` | `cancelada` | OWNER/ADMIN da empresa | Antes da confirmação. |
| `pendente` | `expirada` | Sistema/RPC | Somente se `pending_expires_at` estiver definido e vencido. |
| `confirmada` | `estornada` | `PLATFORM_ADMIN` | Somente se a política de estorno for aprovada; não desfaz automaticamente a assinatura sem regra. |

Estados terminais não voltam para `pendente`. Uma nova compra gera nova
solicitação com nova chave de idempotência.

`[PENDENTE]` Definir se uma solicitação `expirada` ainda pode ser confirmada
manualmente pelo Master. O documento recomenda que não, salvo decisão explícita
com motivo auditado.

## A.6 Fluxo operacional

### A.6.1 Empresa

1. OWNER/ADMIN abre `Assinatura`.
2. Escolhe um plano pago ativo.
3. A UI gera uma chave de idempotência e chama a RPC de criação.
4. O servidor grava o snapshot do plano e retorna a solicitação com instruções
   Pix seguras.
5. A empresa paga fora do sistema.
6. A empresa informa a referência do pagamento (e comprovante, se exigido).
7. A empresa acompanha o status: `pendente`, `confirmada`, `rejeitada`,
   `cancelada` ou `expirada`.
8. Quando confirmada, a assinatura é atualizada e a tela recarrega o estado.

### A.6.2 Master

1. Master acessa a fila de compras pendentes.
2. Confere empresa, plano, valor snapshot, referência e comprovante.
3. Confirma com valor conferido e referência, ou rejeita com motivo.
4. A confirmação ativa a assinatura na mesma transação.
5. O evento e o `audit_logs` são gravados.
6. A empresa vê o novo estado.

### A.6.3 Regras de bloqueio

- Empresa gerenciada por revendedor não usa compra direta.
- Plano gratuito não gera compra.
- Plano sem `access_days` não pode ser comprado.
- Plano inativo não pode gerar nova solicitação.
- Cliente não pode confirmar, rejeitar ou estornar.
- Master não pode confirmar solicitação de empresa sem vínculo com o plano
  solicitado? A solicitação já carrega o `company_id`; a validação é de
  existência da empresa e do plano, não de vínculo do Master.
- Nenhuma ativação ocorre por leitura de tela, webhook ou clique do cliente.

## A.7 Contratos de RPC propostos

Todas as funções devem ser `SECURITY DEFINER`, com
`search_path = pg_catalog, public, pg_temp`, validação de ator no backend,
`REVOKE ALL` de `public`/`anon` e `GRANT EXECUTE` somente para os papéis
necessários. Nenhuma delas deve aceitar `user_id` como autoridade.

### A.7.1 Empresa

- `create_plan_purchase_request(p_company_id uuid, p_plan_id uuid, p_idempotency_key uuid) returns jsonb`
  - Verifica `can_manage_company_billing(p_company_id)`.
  - Bloqueia empresa de revendedor.
  - Verifica plano ativo, não gratuito, com `access_days > 0`.
  - Faz snapshot e cria `pendente`.
  - Se a chave já existir, retorna a solicitação existente com `reused = true`.
  - Se já houver outra pendente, retorna erro claro ou a pendente existente
    (decisão de UX; recomenda-se retornar a existente se for o mesmo plano).
- `submit_plan_purchase_payment(p_request_id uuid, p_payment_reference text, p_proof_url text default null, p_payer_name text default null) returns jsonb`
  - Somente OWNER/ADMIN da empresa da solicitação.
  - Somente `pendente`.
  - Referência obrigatória.
  - Não ativa assinatura.
- `cancel_plan_purchase_request(p_request_id uuid, p_reason text default null) returns jsonb`
  - Somente OWNER/ADMIN da empresa.
  - Somente `pendente`.
- `get_my_plan_purchase_requests(p_company_id uuid) returns jsonb`
  - Somente OWNER/ADMIN da empresa.
  - Retorna histórico sem dados sensíveis.
- `get_plan_purchase_pix_instructions(p_request_id uuid) returns jsonb`
  - Somente OWNER/ADMIN da empresa da solicitação.
  - Retorna chave, recebedor, QR, payload, valor, identificador e instruções.
  - Não retorna a configuração inteira nem dados de outras solicitações.

### A.7.2 Master

- `list_plan_purchase_requests(p_status text default 'pendente') returns jsonb`
  - Somente `PLATFORM_ADMIN`.
  - Retorna fila com empresa, plano snapshot, valor, referência, comprovante e
    datas; não retorna CPF.
- `confirm_plan_purchase_request(p_request_id uuid, p_confirmed_amount numeric, p_payment_reference text, p_reason text default null) returns jsonb`
  - Somente `PLATFORM_ADMIN`.
  - Bloqueia solicitação expirada, rejeitada, cancelada ou já confirmada.
  - Exige valor e referência.
  - Compara valor com o snapshot; divergência bloqueia por padrão.
  - Ativa a assinatura na mesma transação.
  - Se já confirmada, retorna o resultado original com `reused = true`.
- `reject_plan_purchase_request(p_request_id uuid, p_reason text) returns jsonb`
  - Somente `PLATFORM_ADMIN`.
  - Motivo obrigatório.
- `refund_plan_purchase_request(p_request_id uuid, p_reason text) returns jsonb`
  - Somente se a política de estorno for aprovada.
  - Não apaga a solicitação; registra evento e status.
- `set_platform_pix_settings(...)` / `get_platform_pix_settings()`
  - Somente `PLATFORM_ADMIN`.
  - Auditoria sem gravar a chave no metadata.

### A.7.3 Expiração

`[PROPOSTA]` Não depender de `pg_cron` ou Edge Function na primeira versão.
A expiração pode ser aplicada de forma preguiçosa no início das RPCs de leitura
e confirmação: se `pending_expires_at` estiver definido e vencido, a solicitação
é marcada como `expirada` com evento/auditoria antes de continuar. Uma rotina
agendada pode ser adicionada depois, sem mudar o contrato.

## A.8 RLS e grants

`[PROPOSTA]`

| Objeto | `anon` | `authenticated` | `service_role` |
|---|---|---|---|
| `platform_pix_settings` | Nenhum | Nenhum select direto; somente RPC | Todos, para operação interna |
| `plan_purchase_requests` | Nenhum | `SELECT` somente da própria empresa via policy; sem INSERT/UPDATE/DELETE | Todos |
| `plan_purchase_events` | Nenhum | `SELECT` somente da própria empresa via policy; sem escrita | Todos |

Política de leitura da empresa:

- `company_id` da solicitação precisa ser de empresa em que `auth.uid()` é
  membro ativo `OWNER` ou `ADMIN`.
- `PLATFORM_ADMIN` lê todas.
- Nenhum membro comum lê cobrança.
- Escrita direta nunca é concedida; toda escrita passa por RPC.
- `platform_pix_settings` não tem policy para `authenticated`; a RPC de
  instruções é a única porta de saída.

`[PROPOSTA]` Revisar os default ACLs após criar as tabelas, seguindo o padrão de
`20261116000000_dellyvery3_public_default_acl_hardening.sql`. Toda função nova
precisa de `REVOKE`/`GRANT` explícitos, porque o hardening de default ACL não
concede execução automaticamente.

## A.9 Idempotência e concorrência

`[PROPOSTA]`

1. **Criação:** `unique (company_id, idempotency_key)`. Em conflito, retornar a
   solicitação existente. A UI deve reutilizar a mesma chave em retentativas.
2. **Uma pendência por empresa:** índice único parcial em `status = 'pendente'`.
   Evita duas solicitações concorrentes para o mesmo plano.
3. **Confirmação:** `SELECT ... FOR UPDATE` na solicitação e na assinatura da
   empresa. Verificar status dentro da transação. Atualizar assinatura, marcar
   `activated_at`, inserir evento e auditoria antes do commit.
4. **Ativação única:** `activated_at` nulo é pré-condição. Evento `confirmed`
   com `request_id` único reforça a proteção.
5. **Replay:** segunda chamada de confirmação retorna o resultado original com
   `reused = true`; não estende a assinatura de novo.
6. **Divergência de valor:** bloquear por padrão. Se o produto permitir
   override, exigir motivo e registrar em evento/auditoria.
7. **Expiração:** verificar no início da confirmação. Solicitação expirada não
   ativa sem decisão explícita.
8. **Relógio:** usar `now()` do banco, nunca data enviada pelo frontend.

## A.10 Snapshot, preço e ativação

`[PROPOSTA]`

- O snapshot congela nome, slug, preço, moeda, ciclo, `access_days` e
  `is_free` no momento da solicitação.
- A confirmação usa o snapshot, não o plano atual. Se o plano mudar de preço
  depois, a solicitação pendente mantém o valor combinado.
- Se o plano for desativado depois, novas solicitações são bloqueadas; a
  pendente pode ser confirmada ou rejeitada pelo Master, conforme decisão
  operacional.
- A ativação deve:
  - definir `plan_id` do snapshot;
  - definir `status = 'ativo'`;
  - definir `started_at = coalesce(started_at, now())` quando necessário;
  - calcular `expires_at = greatest(now(), coalesce(expires_at, now())) + make_interval(days => access_days_snapshot)`;
  - preservar `canceled_at` nulo ao reativar por compra;
  - gravar `activated_at` na solicitação.
- Plano gratuito não passa por compra. A troca para gratuito pode continuar em
  RPC separada, com auditoria.
- `[PENDENTE]` Upgrades entre planos pagos: proração, troca simples ou nova
  compra. Recomendação v1: nova compra, sem proração.
- `[PENDENTE]` Valor divergente: bloquear sempre ou permitir override do Master
  com motivo.

## A.11 Segurança do Pix e do QR

`[PROPOSTA]`

- A chave Pix e o QR nunca entram no bundle, no repositório, em `companies`,
  em `plans` ou em tabela pública.
- A configuração fica em tabela singleton restrita, com leitura direta apenas
  por `service_role` e escrita somente por RPC de `PLATFORM_ADMIN`.
- A empresa recebe somente as instruções da própria solicitação, por RPC
  autenticada.
- Se o QR for uma imagem no Storage, usar bucket privado e URL assinada de
  curta duração; não usar URL pública permanente.
- Se o QR for payload copia-e-cola, ele pode ser retornado pela RPC e desenhado
  no cliente, mas não deve ser persistido em local público.
- Troca de chave/QR incrementa `version`. Solicitações pendentes com versão
  antiga devem exibir aviso para reconferir as instruções antes de pagar.
- Não gravar chave Pix, payload completo ou QR em `audit_logs`, logs de
  aplicação, mensagens de erro ou URLs.
- O `metadata` da solicitação não deve conter dados sensíveis de pagamento.
- Preparação futura: campos `provider`, `provider_charge_id`,
  `provider_status` e uma tabela de eventos idempotentes de provedor. Nenhuma
  integração com Asaas é presumida ou implementada nesta etapa.

## A.12 Auditoria

`[PROPOSTA]` Ações mínimas em `audit_logs`:

- `plan_purchase_requested`
- `plan_purchase_payment_submitted`
- `plan_purchase_confirmed`
- `plan_purchase_rejected`
- `plan_purchase_canceled`
- `plan_purchase_expired`
- `plan_purchase_refunded`
- `platform_pix_settings_updated`

Metadados permitidos: `request_id`, `company_id`, `plan_id`, `price_snapshot`,
`currency_snapshot`, `access_days_snapshot`, `status_anterior`,
`status_novo`, `confirmed_amount`, `reason`, `pix_settings_version`.

Metadados proibidos: chave Pix, payload completo, QR binário, CPF, dados de
cartão, token de acesso e qualquer segredo.

## A.13 Critérios de aceite da Parte A

- [ ] Solicitação pendente não altera `subscriptions`.
- [ ] Confirmação ativa a assinatura exatamente uma vez.
- [ ] Replay de confirmação não estende o prazo de novo.
- [ ] Cliente não consegue confirmar, rejeitar ou estornar.
- [ ] Master sem `is_platform_admin()` não consegue confirmar.
- [ ] Empresa A não lê nem confirma solicitação da empresa B.
- [ ] Empresa de revendedor não cria compra direta.
- [ ] Plano gratuito não gera compra.
- [ ] Plano sem `access_days` não gera compra.
- [ ] Valor divergente bloqueia a confirmação por padrão.
- [ ] Solicitação expirada não ativa assinatura.
- [ ] Toda transição gera evento e auditoria.
- [ ] Chave Pix/QR não aparece em tabela pública, log, URL ou auditoria.
- [ ] Escrita direta nas tabelas de compra é negada.
- [ ] Upgrade pago antigo (`manage_subscription`) é bloqueado ou redirecionado
      para a compra.

## A.14 Pendências da Parte A

1. Comprovante/anexo é obrigatório ou opcional?
2. Qual o prazo de expiração da solicitação pendente?
3. Qual a política de cancelamento e estorno?
4. Valor divergente: bloquear sempre ou permitir override auditado?
5. Upgrade entre planos pagos: proração, troca simples ou nova compra?
6. Chave/QR visível para todos os OWNER/ADMIN ou somente para quem solicitou?
7. QR fixo do Master ou QR por solicitação? (Recomendação: fixo na v1.)
8. Uma pendência por empresa ou várias pendências simultâneas? (Recomendação:
   uma.)

---

# Parte B — CPF do OWNER/responsável

## B.1 Objetivo

Associar um CPF ao OWNER/responsável de cada empresa, garantir que um mesmo CPF
não esteja associado a mais de uma empresa e permitir regularização gradual do
legado, sem expor o CPF a membros, storefront, logs ou telas operacionais.

## B.2 Entidade e regra

`[REGRA]` O CPF representa o OWNER/responsável, não qualquer membro da equipe.
Funcionários e membros continuam podendo participar de várias empresas.

`[REGRA]` Um CPF só pode estar associado a uma empresa.

`[REGRA]` CNPJ é regra separada. Este documento não cria unicidade de CNPJ nem
altera o fluxo de leads.

`[PROPOSTA]` O CPF fica em tabela por empresa, não em `profiles` e não em
`companies`. Isso permite:

- unicidade global por CPF;
- liberar o CPF quando a empresa é excluída;
- trocar o responsável sem alterar o histórico da empresa;
- manter o dado fora das consultas amplas de empresa/perfil.

## B.3 Modelo de dados proposto

Tabela `company_responsible_cpf`:

| Campo | Tipo sugerido | Finalidade |
|---|---|---|
| `id` | uuid, PK | Identificador. |
| `company_id` | uuid, FK `companies`, unique | Uma linha por empresa. |
| `cpf_hash` | text | HMAC/digest determinístico para unicidade e busca. |
| `cpf_encrypted` | bytea | CPF cifrado para leitura autorizada. |
| `cpf_last4` | text | Exibição mascarada. |
| `cpf_masked` | text | Máscara pronta para UI. |
| `key_version` | integer | Versão da chave de criptografia. |
| `status` | text | `regular`, `pending_regularization`, `duplicate_pending`. |
| `is_uniqueness_enforced` | boolean, default true | Permite legado duplicado sem derrubar a migration. |
| `source` | text | `onboarding`, `backfill`, `manual`. |
| `created_by` | uuid, FK `profiles` | Autor. |
| `created_at` / `updated_at` | timestamptz | Controle. |
| `verified_at` | timestamptz | Conferência manual, se houver. |
| `metadata` | jsonb | Dados não sensíveis. |

Restrições e índices:

- `unique (company_id)`.
- Índice único parcial em `cpf_hash` somente quando
  `is_uniqueness_enforced = true` e `cpf_hash is not null`.
- Índice em `status` para campanha de regularização.
- Check de formato de `cpf_hash` e `cpf_last4`.
- Nenhum CPF em texto puro nessa tabela, salvo decisão explícita em contrário.

`[PENDENTE]` A estratégia de proteção (texto restrito, criptografia, hash ou
hash + criptografia) precisa ser aprovada. A recomendação técnica está na
Parte C.

## B.4 Fluxos

### B.4.1 Onboarding

`[PROPOSTA]`

- O onboarding coleta o CPF do responsável quando a coleta estiver habilitada.
- A escrita é feita por RPC, nunca por `INSERT` direto.
- Se o CPF for obrigatório e não vier, a criação da empresa falha antes de
  gravar a empresa.
- Se o CPF for opcional, a empresa é criada com status
  `pending_regularization` e sem bloqueio imediato.
- A criação da empresa e a gravação do CPF devem ocorrer na mesma transação
  lógica. Para isso, recomenda-se uma RPC nova
  `create_company_with_owner_v2(... p_cpf text default null)` ou um wrapper
  transacional que chame a criação e a gravação.
- Quando o CPF se tornar obrigatório, a RPC antiga `create_company_with_owner`
  não pode continuar disponível para `authenticated`, senão o cliente contorna
  a regra.

`[PENDENTE]` Definir quando o CPF passa a ser obrigatório no onboarding e qual
o tratamento para novos cadastros antes dessa data.

### B.4.2 Empresa existente

- OWNER/ADMIN pode informar ou corrigir o CPF do responsável por RPC.
- A atualização exige validação e unicidade.
- A atualização gera auditoria sem CPF.
- A tela de configurações da empresa pode exibir apenas a máscara e o status de
  regularização.
- O CPF completo não é retornado em listagens.

### B.4.3 Master

- Master pode ver a máscara e o status de regularização.
- Master pode revelar o CPF completo somente por RPC auditada, com motivo.
- Master pode corrigir/regularizar com motivo.
- A revelação não grava o CPF no `audit_logs`.

### B.4.4 Troca de responsável

`[PROPOSTA]`

- A troca de OWNER deve atualizar o CPF da empresa para o novo responsável na
  mesma operação.
- O CPF antigo é liberado somente depois da atualização bem-sucedida.
- Se o novo CPF já estiver em outra empresa, a troca falha.
- A operação é auditada sem CPF.
- Se a empresa for excluída, a linha de CPF é removida por cascade e o CPF fica
  disponível para outra empresa.

`[PENDENTE]` Definir se a troca de OWNER é permitida hoje, quem pode fazê-la e
qual o tratamento quando o novo responsável ainda não tem CPF.

### B.4.5 Legado

`[PROPOSTA]`

- Empresa sem linha de CPF fica em `pending_regularization`.
- Não bloquear automaticamente.
- Duplicidades são marcadas como `duplicate_pending` e
  `is_uniqueness_enforced = false` para não derrubar a criação do índice único.
- A regularização é manual, com auditoria e sem expor o CPF.
- O prazo e a eventual suspensão são decisão do produto.
- Backfill a partir de `leads` só deve ocorrer com consentimento e validação
  explícitos; não associar automaticamente por nome, telefone ou e-mail.

`[PENDENTE]` Definir prazo, comunicação, política de bloqueio e se o backfill
usará leads.

## B.5 Validação, normalização e unicidade

`[PROPOSTA]`

- Normalizar para dígitos apenas; rejeitar comprimento diferente de 11.
- Validar com `public.is_valid_cpf`; rejeitar sequências repetidas.
- Calcular `cpf_hash` de forma determinística no backend.
- Calcular `cpf_last4` e `cpf_masked` no backend.
- Nunca confiar no CPF enviado pelo frontend sem normalização/validação.
- Unicidade:
  - índice único parcial em `cpf_hash` para linhas com
    `is_uniqueness_enforced = true`;
  - verificação prévia na RPC para bloquear qualquer CPF existente, inclusive
    legado com `is_uniqueness_enforced = false`;
  - captura de `unique_violation` para retornar mensagem amigável em corrida.
- A mesma empresa pode reenviar o mesmo CPF de forma idempotente.
- CPF de outra empresa nunca pode ser vinculado.
- Mensagens de erro não devem repetir o CPF nem indicar qual empresa o possui.

## B.6 Privacidade e visibilidade

`[PROPOSTA]`

| Ator | Máscara | CPF completo | Escrita |
|---|---|---|---|
| OWNER/ADMIN da empresa | Sim | Não, salvo RPC específica se aprovada | Sim, por RPC |
| Outros membros | Não | Não | Não |
| `PLATFORM_ADMIN` | Sim | Somente por RPC auditada com motivo | Sim, por RPC |
| Storefront/público | Não | Não | Não |
| Logs/auditoria | Nunca | Nunca | — |

A tabela não deve ter `SELECT` direto para `authenticated`. A leitura acontece
por RPC que retorna apenas máscara/status. O CPF completo só sai por RPC
auditada e com finalidade declarada.

## B.7 Critérios de aceite da Parte B

- [ ] CPF não existe em `companies` nem em `profiles`.
- [ ] Um CPF só pode ser vinculado a uma empresa.
- [ ] Corrida de dois cadastros com o mesmo CPF resulta em um sucesso e um erro
      amigável.
- [ ] Empresa sem CPF não é bloqueada enquanto a obrigatoriedade não estiver
      ativa.
- [ ] CPF duplicado de legado não impede a migration.
- [ ] CPF não aparece em `audit_logs`, logs, URLs, mensagens de erro ou
      listagens.
- [ ] OWNER/ADMIN vê apenas máscara.
- [ ] Master vê máscara; CPF completo só por RPC auditada.
- [ ] Troca de responsável libera o CPF antigo somente após sucesso.
- [ ] Exclusão da empresa libera o CPF.
- [ ] Onboarding obrigatório não pode ser contornado pela RPC antiga.

## B.8 Pendências da Parte B

1. Quando o CPF passa a ser obrigatório?
2. Qual o tratamento para novos cadastros antes dessa data?
3. Estratégia de proteção: criptografia, hash, ambos ou texto restrito?
4. Quem pode ver o CPF completo e em quais situações?
5. Qual o prazo de retenção e a política de descarte?
6. Qual o prazo/estratégia de regularização do legado?
7. CNPJ também terá regra de unicidade?
8. Como tratar empresas criadas por revendedor?
9. Troca de OWNER: permitida? por quem? com qual exigência de CPF?

---

# Parte C — Privacidade, segurança e arquitetura do CPF

## C.1 Ameaças consideradas

- Vazamento por `SELECT *` em `companies`/`profiles`.
- Exposição em storefront, cardápio público, listagens Master ou exportações.
- Exposição em logs de aplicação, mensagens de erro, URLs e ferramentas de
  analytics.
- Corrida de cadastro permitindo o mesmo CPF em duas empresas.
- Acesso indevido de membro comum ou de Master sem finalidade.
- Backfill em massa bloqueando empresas legítimas.
- Perda da chave de criptografia inviabilizando a leitura.
- Retenção indefinida sem base legal.

## C.2 Comparação das estratégias

| Estratégia | Unicidade | Exibição completa | Recuperação | Impacto de vazamento | Complexidade | Avaliação |
|---|---|---|---|---|---|---|
| Texto em `companies` | Sim, com índice | Sim | Sim | Alto: qualquer leitura de empresa vaza | Baixa | Não recomendada. |
| Texto em tabela restrita | Sim | Sim | Sim | Médio/alto se a tabela for lida | Baixa | Aceitável apenas como paliativo, não como desenho final. |
| Hash determinístico apenas | Sim | Não | Não | Baixo | Baixa | Bom para privacidade, ruim para conferência e integração futura. |
| Hash + criptografia | Sim | Sim, via RPC | Sim, com chave | Médio se a chave vazar; baixo sem a chave | Média/alta | **Recomendada.** |
| Hash + texto em tabela separada | Sim | Sim | Sim | Médio | Média | Alternativa se criptografia não estiver disponível. |

## C.3 Arquitetura recomendada

`[PROPOSTA]`

1. **Tabela separada e restrita:** `company_responsible_cpf`, sem `SELECT`
   direto para `authenticated`.
2. **Hash para unicidade:** HMAC-SHA256 com pepper (ou digest com pepper) sobre
   o CPF normalizado. O hash não deve ser um SHA-256 puro sem segredo, porque
   CPF tem espaço pequeno e é enumerável.
3. **Criptografia para leitura:** `cpf_encrypted` com chave gerenciada fora da
   tabela. Preferir Supabase Vault ou segredo de Edge Function; nunca chave no
   frontend, no repositório ou em `platform_settings` legível.
4. **Máscara para UI:** `cpf_last4` e `cpf_masked` para exibição comum.
5. **RPC de revelação auditada:** somente `PLATFORM_ADMIN`, com motivo,
   retornando o CPF completo sem gravá-lo em auditoria.
6. **Versão de chave:** `key_version` para permitir rotação e recriptografia.
7. **Sem CPF em logs:** erros genéricos, sem eco do valor.
8. **Sem CPF em `audit_logs`:** usar `company_id`, `request_id` ou hash truncado
   apenas se necessário para correlação.

`[PENDENTE]` Validar no ambiente-alvo:

- disponibilidade de `extensions.digest`, `extensions.hmac` e
  `extensions.pgp_sym_encrypt`;
- disponibilidade de Vault;
- política de backup e rotação de chave;
- se o time prefere Edge Function para criptografia em vez de função no banco.

`[PROPOSTA]` Se a criptografia não estiver disponível na primeira migration,
não cair para texto em `companies`. Duas alternativas seguras:

- lançar a tabela apenas com hash + máscara e adicionar criptografia depois;
- lançar com texto restrito em tabela separada, explicitamente aprovado como
  paliativo, com prazo para migrar.

## C.4 Matriz de acesso recomendada

| Operação | OWNER/ADMIN | Master | Outros | Backend |
|---|---|---|---|---|
| Ver máscara/status | Sim, via RPC | Sim, via RPC | Não | Sim |
| Ver CPF completo | Não, salvo decisão | Sim, via RPC auditada | Não | Sim, com chave |
| Criar/atualizar | Sim, via RPC | Sim, via RPC | Não | Sim |
| Regularizar legado | Não | Sim, via RPC | Não | Sim |
| Excluir/anonimizar | Não | Sim, via RPC auditada | Não | Sim |

## C.5 Logs, erros e auditoria

`[PROPOSTA]`

- Nunca logar o CPF em `console`, Edge Function, servidor, analytics ou
  ferramenta de erro.
- Mensagens de erro: “CPF inválido”, “CPF já vinculado a outra empresa” ou
  “Não foi possível validar o CPF”; nunca repetir o número.
- `audit_logs.metadata` não contém CPF, nem completo, nem mascarado com poucos
  dígitos, se isso permitir identificação.
- A RPC de revelação registra `cpf_revealed` com `company_id`, `actor_id`,
  `reason` e timestamp, sem o valor.
- Exportações e relatórios não incluem CPF por padrão.

## C.6 Retenção, descarte e incidentes

`[PENDENTE]` Definir com o responsável/jurídico:

- prazo de retenção do CPF;
- base legal e finalidade;
- política de anonimização após exclusão da empresa;
- procedimento de resposta a incidente;
- quem revisa acessos Master;
- se o CPF pode ser usado em integração de pagamento futura.

`[PROPOSTA]` A exclusão da empresa deve remover a linha de CPF por cascade. Se
houver obrigação legal de retenção, criar tabela de retenção separada com acesso
ainda mais restrito, em vez de manter o CPF na tabela operacional.

---

# Parte D — Plano de implementação futuro

## D.1 Sequência recomendada

`[PROPOSTA]`

1. **Onda 2 — CPF** (após decisões 7 e 9).
2. **Onda 3 — Compra/Pix** (após decisão 5).

A compra não depende tecnicamente do CPF, então as ondas podem ser paralelas se
o responsável priorizar receita. A ordem acima segue a sequência já registrada
em `docs/etapa-3-decisoes-pendentes.md`.

## D.2 Onda 2 — CPF

### D.2.1 Migration aditiva

- Criar `company_responsible_cpf`.
- Criar helpers de normalização/validação/hash.
- Criar índice único parcial e índices de status.
- Habilitar RLS sem policy para `authenticated` (acesso somente por RPC).
- Criar RPCs:
  - `set_company_responsible_cpf(p_company_id, p_cpf, p_reason default null)`
  - `get_company_responsible_cpf(p_company_id)` — máscara/status
  - `reveal_company_responsible_cpf(p_company_id, p_reason)` — Master
  - `regularize_company_responsible_cpf(...)` — Master
  - `create_company_with_owner_v2(... p_cpf)` ou wrapper transacional
- Criar flag/configuração de obrigatoriedade em `platform_settings` (nome e
  default dependem da decisão 7; não inventar data).
- Revogar a RPC antiga de criação quando a obrigatoriedade for ativada.

### D.2.2 Frontend

- `src/lib/brdocs.js`: reutilizar `isValidCPF`, `maskCPF`, `onlyDigits`.
- `src/api/companyCpf.js`: adapter das RPCs, sem CPF em logs.
- `src/pages/CreateRestaurant.jsx`: campo de CPF do responsável e estados de
  erro.
- `src/pages/Configuracoes.jsx`: exibição mascarada e regularização.
- `src/pages/Perfil.jsx`: se o CPF for exibido ao responsável, somente máscara.
- `src/pages/MasterEmpresas.jsx`: status de regularização e ação auditada de
  revelação/correção.
- `package.json`: incluir testes novos em `test:supabase`.

### D.2.3 Dados e legado

- Não fazer backfill automático em massa.
- Criar relatório de empresas sem CPF e com duplicidade.
- Regularizar manualmente com auditoria.
- Só ativar obrigatoriedade depois da campanha.

### D.2.4 Riscos e rollback

- Risco: migration falhar por duplicidade. Mitigação: índice parcial +
  `is_uniqueness_enforced`.
- Risco: chave de criptografia indisponível. Mitigação: validar antes; fallback
  hash + máscara.
- Risco: onboarding bloquear novos clientes. Mitigação: flag desligada por
  padrão e comunicação.
- Rollback: desligar flag, manter tabela aditiva, não apagar dados; reverter UI.

## D.3 Onda 3 — Compra/Pix

### D.3.1 Migration aditiva

- Criar `platform_pix_settings`.
- Criar `plan_purchase_requests`.
- Criar `plan_purchase_events`.
- Criar helper `can_manage_company_billing`.
- Criar RPCs da Parte A.
- Criar índices de idempotência e pendência única.
- Ajustar `manage_subscription` para:
  - continuar `cancel`/`reactivate`;
  - permitir `upgrade` somente para plano gratuito;
  - bloquear plano pago com mensagem que oriente usar a compra;
  - auditar as ações.
- Garantir que a compra não possa ser confirmada por cliente.

### D.3.2 Frontend

- `src/api/planPurchases.js`: criação, envio de referência, consulta e
  cancelamento.
- `src/api/masterPlanPurchases.js`: fila, confirmação, rejeição e configuração
  Pix.
- `src/pages/Assinatura.jsx`: substituir upgrade pago por fluxo de compra.
- `src/pages/MasterPlanos.jsx`: card de configuração Pix ou link para a nova
  tela.
- Nova tela Master de compras, por exemplo `src/pages/MasterCompras.jsx`, rota
  `/master/compras`.
- `src/App.jsx` e `src/pages/MasterDashboard.jsx`: rota e navegação.
- `package.json`: incluir testes novos.

### D.3.3 Dependências

- Decisão 5 fechada (comprovante, prazo, cancelamento/estorno).
- Configuração Pix definida pelo Master.
- `manage_subscription` ajustado para não ser bypass.
- UI de assinatura atualizada no mesmo deploy.
- Testes de concorrência e RLS.

### D.3.4 Riscos e rollback

- Risco: cliente continuar usando upgrade direto. Mitigação: bloquear na RPC e
  atualizar a UI no mesmo deploy.
- Risco: confirmação duplicada. Mitigação: lock + `activated_at` + evento
  único + replay idempotente.
- Risco: chave Pix exposta. Mitigação: tabela restrita, RPC segura, auditoria
  sem segredo.
- Risco: solicitações antigas esquecidas. Mitigação: fila Master + expiração
  configurável (quando aprovada).
- Rollback: desligar a entrada de compra, manter tabelas, voltar a UI anterior
  somente se o bypass pago continuar bloqueado; não reabrir upgrade pago sem
  decisão.

## D.4 Feature flags e rollout

`[PROPOSTA]`

- `platform_settings.plan_purchase_enabled` (boolean, default false) para
  liberar a UI de compra.
- `platform_settings.cpf_required` ou data equivalente (default desligado).
- `platform_pix_settings.active` (default false) para exibir instruções.
- Rollout:
  1. aplicar schema aditivo;
  2. configurar Pix no Master;
  3. liberar UI de compra para um grupo ou empresa piloto;
  4. bloquear upgrade pago antigo;
  5. acompanhar fila e auditoria;
  6. liberar geral.
- CPF:
  1. aplicar schema;
  2. coletar opcionalmente;
  3. campanha de regularização;
  4. ativar obrigatoriedade;
  5. revogar RPC antiga.

## D.5 Arquivos e objetos impactados

### CPF

- `supabase/migrations/2026..._dellyvery3_company_responsible_cpf.sql` (novo).
- `supabase/tests/company_responsible_cpf.integration.mjs` (novo, se adotado).
- `src/api/companyCpf.js` + teste.
- `src/lib/brdocs.js` (reutilização; sem duplicar validador).
- `src/pages/CreateRestaurant.jsx`.
- `src/pages/Configuracoes.jsx`.
- `src/pages/Perfil.jsx`.
- `src/pages/MasterEmpresas.jsx`.
- `package.json`.

### Compra/Pix

- `supabase/migrations/2026..._dellyvery3_plan_purchase_pix.sql` (novo).
- `supabase/tests/plan_purchase_pix.integration.mjs` (novo, se adotado).
- `src/api/planPurchases.js` + teste.
- `src/api/masterPlanPurchases.js` + teste.
- `src/api/subscriptions.js` (ajuste de upgrade).
- `src/pages/Assinatura.jsx`.
- `src/pages/MasterPlanos.jsx`.
- `src/pages/MasterCompras.jsx` (novo, se adotado).
- `src/App.jsx`.
- `src/pages/MasterDashboard.jsx`.
- `package.json`.

---

# Parte E — Testes e verificação

## E.1 Testes de compra/Pix

### Unidade/API (node:test)

- Criação de solicitação envia `company_id`, `plan_id` e chave de idempotência.
- Replay da criação retorna a mesma solicitação.
- Plano gratuito é rejeitado.
- Plano sem `access_days` é rejeitado.
- Empresa de revendedor é rejeitada.
- Envio de referência não altera status para confirmado.
- Cancelamento só funciona em `pendente`.
- Confirmação exige valor e referência.
- Divergência de valor é bloqueada.
- `list` Master não retorna CPF nem chave Pix.
- Instruções Pix retornam somente campos seguros.
- Erros não vazam chave, payload ou dados de outra empresa.

### Integração SQL (se adotada)

- Solicitação pendente mantém `subscriptions` inalterada.
- Confirmação ativa uma única vez e calcula
  `greatest(now(), expires_at) + access_days`.
- Duas confirmações concorrentes resultam em uma ativação e um replay.
- Empresa A não confirma solicitação da empresa B.
- Cliente não executa RPC de confirmação.
- Master sem `is_platform_admin()` não executa.
- Solicitação expirada não ativa.
- Confirmação após rejeição/cancelamento falha.
- `manage_subscription('upgrade')` para plano pago falha após a onda.
- Upgrade para plano gratuito continua funcionando, com auditoria.
- Escrita direta em `plan_purchase_requests` é negada para `authenticated`.
- Chave Pix não aparece em `audit_logs`.

## E.2 Testes de CPF

### Unidade/API

- `isValidCPF` rejeita tamanho errado, sequência repetida e dígito inválido.
- Normalização remove máscara.
- Máscara exibe apenas os últimos dígitos.
- Criação/atualização não envia CPF em log.
- Erro de duplicidade não repete o CPF.
- Leitura comum retorna apenas máscara/status.
- Revelação Master exige motivo.

### Integração SQL (se adotada)

- Dois cadastros concorrentes com o mesmo CPF: um sucesso, um erro.
- Mesmo CPF em empresas diferentes é bloqueado.
- Mesma empresa reenviando o mesmo CPF é idempotente.
- Empresa sem CPF não é bloqueada com flag desligada.
- Legado duplicado não impede a migration.
- CPF de empresa A não é lido pela empresa B.
- Membro comum não lê CPF.
- Master lê máscara; CPF completo só pela RPC auditada.
- `audit_logs` não contém CPF.
- Exclusão da empresa libera o CPF.
- Troca de responsável libera o CPF antigo somente após sucesso.
- Onboarding obrigatório não pode usar a RPC antiga.

## E.3 Regressões obrigatórias

- `npm run test:supabase` continua passando.
- `npm run lint` continua passando.
- `npm run build` continua passando.
- `npm run typecheck` mantém apenas os erros preexistentes.
- Revenda: ativação, créditos e assinatura gerenciada continuam funcionando.
- Assinatura: trial, gratuito, cancelamento e reativação continuam
  funcionando.
- Gate de acesso continua desligado por padrão até o backfill.
- Nenhuma migration histórica é editada.
- Nenhum valor comercial é inventado.

## E.4 Verificação manual

- Empresa paga, Master confirma e o acesso é liberado.
- Empresa paga, Master rejeita e o acesso não muda.
- Empresa tenta confirmar sozinha e não encontra a ação.
- Master vê a fila e o histórico.
- CPF mascarado aparece corretamente.
- CPF completo não aparece em telas comuns, URLs ou console.
- Chave Pix/QR não aparece no bundle nem em resposta de listagem.
- Empresa de revendedor vê a mensagem de assinatura gerenciada.

---

## 2. Pendências que bloqueiam a implementação

| # | Pendência | Bloqueia | Recomendação |
|---|---|---|---|
| 5 | Comprovante, prazo de expiração e política de cancelamento/estorno | Onda de compra/Pix | Referência obrigatória; anexo opcional até decisão; prazo configurável; estorno explícito. |
| 7 | Momento em que o CPF passa a ser obrigatório | Onda de CPF | Coleta opcional primeiro; obrigatoriedade após campanha de regularização. |
| 9 | Estratégia de proteção do CPF | Onda de CPF | Tabela restrita + hash com pepper + criptografia + máscara + revelação auditada. |

Pendências adicionais desta especificação:

- Política de upgrade entre planos pagos (proração ou nova compra).
- Visibilidade da chave/QR (todos os OWNER/ADMIN ou somente o solicitante).
- QR fixo ou por solicitação.
- Uma ou várias pendências por empresa.
- Regra de CNPJ.
- Prazo e política de regularização do legado.
- Tratamento de empresas criadas por revendedor.
- Troca de OWNER.

---

## 3. Confirmação do estado do Git

**Antes desta especificação:** `git status --porcelain` retornava **81**
alterações locais (24 arquivos modificados e 57 não rastreados), incluindo a
onda 1 já implementada.

**Durante esta etapa:**

- Nenhum código, migration, configuração, teste, banco ou documento existente
  foi alterado.
- Nenhum comando com escrita de dados, commit, push ou deploy foi executado.
- Nenhum valor comercial foi inventado.
- A única alteração esperada é a criação deste documento.

**Depois desta etapa:** o total esperado é **82** alterações locais
(24 modificados + 58 não rastreados). O estado final deve ser confirmado com
`git status --porcelain` antes de qualquer aprovação.

---

## 4. Conclusão

A compra de plano com Pix pode ser implementada de forma aditiva, reaproveitando
o padrão de snapshot e idempotência já usado na compra de créditos de revenda.
O ponto crítico é fechar o upgrade pago direto e garantir que a ativação só
aconteça na confirmação do Master.

O CPF do responsável pode ser implementado sem bloquear o legado, desde que
fique em tabela restrita, com unicidade por hash, máscara para leitura e
revelação completa somente por RPC auditada. A estratégia de criptografia e a
data de obrigatoriedade ainda dependem de aprovação.

Nenhuma das duas ondas deve começar antes do fechamento das pendências 5, 7 e 9
e da validação das decisões adicionais listadas neste documento.
