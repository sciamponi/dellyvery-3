# Etapa 3 — Aprovações consolidadas de compra/Pix e CPF

> **Status:** APROVAÇÃO DE ESPECIFICAÇÃO COM PENDÊNCIAS. Nenhuma implementação realizada.
> **Data:** 2026-10-31.
> **Aprovações registradas:** 2026-10-31; status atual na seção 8.
> **Repositório:** `dellyvery-3` — branch `feat/supabase-foundation`, commit de referência `3f1e026`.
> **Documentos lidos:** `docs/etapa-3-especificacao-compra-pix-cpf.md`,
> `docs/etapa-3-decisoes-pendentes.md` e
> `docs/etapa-3-remediacao-assinaturas-quotas.md`.
> **Regra:** este documento não altera código, migrations, banco, configurações
> ou testes. Não cria valores, prazos ou políticas comerciais. Não reabre
> decisões já confirmadas, exceto para registrar dependências.

## 0. Como ler

Cada decisão pendente tem:

1. ID e título.
2. Pergunta objetiva.
3. Recomendação técnica ou de produto.
4. Alternativas.
5. Consequência de cada alternativa.
6. Risco de implementar sem decisão.
7. Fase dependente.

Onde a especificação não permite determinar valor, prazo, política ou
alternativa, o texto informa **contexto insuficiente**. Nenhuma resposta foi
inventada.

### Decisões já confirmadas que não devem ser reabertas

- **D5:** confirmação manual por `PLATFORM_ADMIN`, com referência obrigatória e
  auditoria.
- **D5:** configuração Pix em tabela restrita, entregue por RPC; QR fixo
  configurado pelo Master na primeira versão.
- **D5:** somente o Master confirma pagamento; cliente não ativa plano pago.
- **D6:** Asaas fica para fase posterior; nenhuma integração é presumida.
- **D7:** o CPF é do OWNER/responsável, não de qualquer membro da equipe.
- **D7:** um CPF só pode estar associado a uma empresa.
- **D7:** CNPJ é regra separada da regra do CPF.
- **D8:** legado sem CPF ou com CPF duplicado não pode ser bloqueado em massa.
- **D9, em alto nível:** tabela restrita, hash para unicidade, máscara e acesso
  auditado. A estratégia completa de proteção ainda **não** está aprovada.
- **D1, D2, D3, D4, D8, D10 e D12:** já aprovadas; aparecem aqui apenas como
  dependência.

---

## 1. Resumo executivo

### 1.1 Total de decisões pendentes

| Tema | Decisões | Quantidade |
|---|---|---|
| Compra/Pix | P1 a P10 | 10 |
| CPF | CPF1 a CPF11 | 11 |
| Privacidade e proteção | PRIV1 a PRIV8 | 8 |
| **Total** | | **29** |

### 1.2 O que bloqueia a primeira migration da próxima onda

> **Nota:** esta seção registra o estado da análise antes das aprovações de
> 2026-10-31. O status atual está na seção 8.

A ordem recomendada nos documentos é **CPF primeiro**, depois compra/Pix. Como
as duas ondas são independentes, a lista abaixo separa os dois cenários.

**Se a próxima onda for CPF:**

- Bloqueiam a primeira migration: **CPF1, CPF2, CPF3, CPF4, CPF8, CPF9,
  PRIV1, PRIV2, PRIV3, PRIV4, PRIV5, PRIV6 e PRIV7**.
- Motivo: definem se o CPF é obrigatório, como o legado entra, qual é o modelo
  de armazenamento/criptografia/hash, quem vê o dado e como a RPC/RLS/auditoria
  são desenhadas.
- Podem esperar a primeira migration, mas não necessariamente o lançamento:
  **CPF5, CPF6, CPF7, CPF10, CPF11 e PRIV8**.

**Se a próxima onda for compra/Pix:**

- Bloqueiam a primeira migration: **P1, P2, P6, P7 e P9**.
- Motivo: definem campos de expiração, dados de confirmação/comprovante,
  configuração Pix, RLS/RPC e a regra de uma ou várias solicitações pendentes.
- Podem ser fechadas antes das RPCs ou de fases seguintes: **P3, P4, P5, P8 e
  P10**, desde que o schema inicial seja genérico e aditivo.

### 1.3 Decisões que podem esperar

- **CPF5** (procedimento de regularização) pode ser detalhada depois do modelo,
  desde que o estado `pending_regularization` exista.
- **CPF6** (troca de responsável) pode entrar em RPC posterior, desde que a
  tabela já tenha `company_id` único e cascade.
- **CPF7** (recuperação/remoção) pode ser detalhada depois, mas a política de
  retenção precisa estar fechada antes de produção.
- **CPF10** (empresas de revendedor) pode ser tratada em fase posterior, mas o
  fluxo de ativação de revenda precisa ser revisto antes de a obrigatoriedade
  valer para todos.
- **CPF11** (CNPJ) não bloqueia a onda de CPF.
- **PRIV8** (retenção, backup e incidentes) pode esperar a primeira migration,
  mas não o lançamento.
- **P3, P4, P5, P8 e P10** podem esperar a primeira migration de compra/Pix, mas
  precisam estar fechadas antes da confirmação manual e do rollout.

### 1.4 Riscos de segurança ou integridade que impedem implementação segura

1. **Upgrade pago direto ainda aberto:** `manage_subscription('upgrade')` ativa
   plano pago sem pagamento. Se a compra/Pix entrar sem fechar esse caminho, a
   nova cobrança é contornável.
2. **CPF em local amplo:** se o CPF for para `companies` ou `profiles`, membros,
   storefront, exportações e consultas amplas passam a vê-lo.
3. **Sem estratégia de chave:** criptografia sem gestão de chave, backup e
   rotação pode causar perda de dado ou falsa sensação de proteção.
4. **Sem unicidade concorrente:** apenas validar no frontend ou fazer `SELECT`
   antes do `INSERT` permite o mesmo CPF em duas empresas em corrida.
5. **Sem auditoria de acesso completo:** revelar CPF completo sem RPC auditada e
   motivo impede rastrear vazamento interno.
6. **Pix/QR exposto:** chave, payload ou QR em tabela pública, bundle, log ou
   auditoria permite fraude e exposição operacional.
7. **Confirmação duplicada ou estorno sem regra:** pode ativar duas vezes,
   remover acesso indevidamente ou criar divergência de receita.
8. **Legado bloqueado em massa:** aplicar CPF obrigatório sem campanha e estado
   de regularização pode parar empresas existentes.

---

## 2. Compra/Pix

### P1 — Prazo de validade e efeito da expiração

**Pergunta:** qual é o prazo de validade de uma solicitação pendente e o que
acontece quando ela expira?

**Recomendação:** prazo configurável no Painel Master, sem valor fixo no código.
Se não houver prazo configurado, a solicitação não expira automaticamente.
Solicitação expirada não ativa assinatura e não pode ser confirmada sem uma
decisão explícita e auditada do Master.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. Prazo configurável pelo Master; expirada não ativa | Flexível e auditável; exige campo de expiração e rotina de leitura/expiração. **Recomendada.** |
| B. Prazo fixo no código | Simples, mas inventa uma política comercial e exige deploy para mudar. |
| C. Sem expiração automática; só cancelamento manual | Menos automação; a fila do Master acumula solicitações antigas. |

**Risco sem decisão:** solicitações antigas ficam pendentes para sempre, o
cliente paga depois de o plano mudar, ou a confirmação ativa algo que já deveria
ter expirado.

**Fase dependente:** primeira migration de compra/Pix (campo
`pending_expires_at`) e RPC de confirmação.

**Contexto:** o documento não define prazo. O valor é decisão comercial.

---

### P2 — Dados mínimos de confirmação, comprovante e divergência de valor

**Pergunta:** além da referência obrigatória já aprovada, quais dados o Master
precisa informar para confirmar e o que acontece se o valor pago divergir do
snapshot?

**Recomendação:** exigir valor confirmado e referência; valor divergente bloqueia
por padrão. Nome do pagador e data do pagamento são opcionais para conciliação.
Comprovante fica opcional na v1, salvo decisão contrária. Override de valor só
com motivo obrigatório e auditoria.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. Referência + valor confirmado + Master/timestamp; comprovante opcional; divergência bloqueia | Conciliável e segura; menos atrito. **Recomendada.** |
| B. A + comprovante obrigatório + nome/data obrigatórios | Mais evidência, mais atrito e mais armazenamento sensível. |
| C. Apenas referência; comprovante opcional; sem comparação de valor | Menos controle; aumenta risco de fraude e erro de conciliação. |

**Risco sem decisão:** confirmação sem valor confiável, fraude por divergência,
retrabalho nos campos e armazenamento de comprovante sem política.

**Fase dependente:** primeira migration (campos de valor/comprovante) e RPC de
confirmação.

**Contexto:** a especificação não define se comprovante é obrigatório nem se
override de valor é permitido. A referência obrigatória já está aprovada e não
é reaberta aqui.

---

### P3 — Confirmação manual simples ou dupla conferência

**Pergunta:** uma confirmação de `PLATFORM_ADMIN` basta ou são necessárias duas
pessoas?

**Recomendação:** uma confirmação de `PLATFORM_ADMIN` com auditoria na v1. Dupla
conferência pode ser adicionada depois, se o volume ou o risco exigirem.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. Uma confirmação + auditoria | Simples e rápida; depende da conferência humana. **Recomendada para v1.** |
| B. Duas confirmações obrigatórias | Mais proteção contra fraude; mais lenta e exige mais de um Master. |
| C. Dupla apenas acima de um limite de valor | Equilíbrio, mas exige definir limite comercial e fluxo de exceção. |

**Risco sem decisão:** fraude ou erro de confirmação; retrabalho no schema de
aprovação se a dupla conferência for descoberta depois.

**Fase dependente:** RPC de confirmação; pode ser posterior à primeira migration
se o schema já prever campos de aprovação.

**Contexto:** a especificação não define limite nem se há equipe Master
suficiente para dupla conferência.

---

### P4 — Política de rejeição e cancelamento

**Pergunta:** quem pode rejeitar ou cancelar uma solicitação, em quais estados,
com qual motivo e com qual comunicação ao cliente?

**Recomendação:** Master rejeita com motivo obrigatório; OWNER/ADMIN da empresa
cancela enquanto estiver pendente. Nenhum registro é apagado: a transição gera
evento e auditoria. Rejeição e cancelamento são terminais; nova compra gera nova
solicitação.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. Master rejeita; OWNER/ADMIN cancela pendente; motivo obrigatório | Clara e auditável. **Recomendada.** |
| B. Somente Master rejeita e cancela | Mais controle; menos autonomia para a empresa. |
| C. Cancelamento automático em mudança de plano | Menos pendências, mas pode cancelar uma compra já paga. |

**Risco sem decisão:** solicitações presas, cancelamento indevido de pagamento
válido ou ausência de motivo para contestação.

**Fase dependente:** primeira migration (status e campos de motivo) e RPCs.

**Contexto:** a política de comunicação e prazos não está definida.

---

### P5 — Estorno e correção de confirmação

**Pergunta:** como registrar estorno, estorno parcial ou correção de uma
confirmação já feita, e o que acontece com o acesso da empresa?

**Recomendação:** não apagar a confirmação original. Registrar evento de estorno
com motivo e valor, mantendo o histórico. O efeito sobre o acesso deve ser uma
decisão explícita: por padrão, o estorno não remove acesso automaticamente sem
regra aprovada.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. Evento de estorno/correção + motivo; acesso só muda com regra explícita | Auditável e reversível. **Recomendada.** |
| B. Estorno cancela a assinatura imediatamente | Simples, mas pode remover acesso de forma abrupta e gerar disputa. |
| C. Estorno parcial com proração | Mais justo comercialmente, mas exige cálculo e política de preço. |

**Risco sem decisão:** perda de histórico, acesso inconsistente, receita
divergente e impossibilidade de auditar correções.

**Fase dependente:** após a confirmação; pode ser migration aditiva posterior.

**Contexto:** a especificação não define política de estorno, estorno parcial ou
efeito no acesso. É decisão comercial/jurídica.

---

### P6 — Dados Pix/QR e rotação da configuração

**Pergunta:** quais dados Pix o Master configura, em qual formato, e como tratar
troca de chave/QR durante uma solicitação pendente?

**Recomendação:** manter a decisão já aprovada de tabela restrita + RPC e QR
fixo do Master na v1. Configurar chave, tipo de chave, nome do recebedor,
instruções e QR (imagem privada ou payload). Incrementar versão a cada troca e
avisar solicitações pendentes para reconferir as instruções.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. Chave + recebedor + instruções + QR opcional + versão | Suficiente para v1 e auditável. **Recomendada.** |
| B. A + histórico completo de configurações e QR por versão | Melhor auditoria; mais complexidade. |
| C. Somente chave e instruções, sem QR | Menos dados sensíveis, mas pior experiência de pagamento. |

**Risco sem decisão:** cliente paga para chave antiga, QR público vaza, ou a
configuração não tem versão para detectar troca durante pendência.

**Fase dependente:** primeira migration (tabela de configuração Pix).

**Contexto:** o formato exato do QR e a necessidade de histórico não estão
definidos. QR fixo e tabela restrita já estão aprovados.

---

### P7 — Quem visualiza e altera a configuração Pix

**Pergunta:** quem pode alterar a configuração Pix e quem pode visualizar as
instruções de uma solicitação?

**Recomendação:** somente `PLATFORM_ADMIN` altera a configuração. Qualquer
OWNER/ADMIN da empresa vê as instruções da própria solicitação. Nenhum membro
comum vê dados de cobrança. O Master vê para conferência.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. Master altera; OWNER/ADMIN da empresa vê instruções da própria solicitação | Equilíbrio entre operação e segurança. **Recomendada.** |
| B. Somente quem abriu a solicitação vê | Mais restrito; outro OWNER/ADMIN não consegue pagar em nome da empresa. |
| C. Todos os membros da empresa veem | Mais simples, mas expõe cobrança a operadores. |

**Risco sem decisão:** exposição de dados de pagamento ou impossibilidade de o
sócio pagar quando quem abriu está ausente.

**Fase dependente:** primeira migration (RLS/RPC).

**Contexto:** a especificação recomenda A, mas não há aprovação explícita de
visibilidade.

---

### P8 — Início da contagem do plano pago

**Pergunta:** o período pago começa na confirmação do Master, na data do
pagamento informada ou na criação da solicitação?

**Recomendação:** começar na confirmação/ativação, usando `now()` do banco. A
data de pagamento informada é referência de conciliação, não autoridade para
retroagir o acesso. Renovação estende de `max(now(), expires_at)`, conforme D1.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. Confirmação/ativação | Consistente com D1 e com o relógio do servidor. **Recomendada.** |
| B. Data do pagamento informada | Pode parecer mais justo, mas depende de dado do cliente e permite retroatividade. |
| C. Criação da solicitação | Pode consumir dias antes da confirmação e prejudicar o cliente. |

**Risco sem decisão:** datas de expiração erradas, perda de dias pagos ou
extensão indevida.

**Fase dependente:** RPC de ativação; pode ser fechada depois da primeira
migration.

**Contexto:** D1 já define ciclo a partir da ativação; falta confirmar que a
ativação é a confirmação do Master.

---

### P9 — Mudança de plano com solicitação pendente e quantidade de pendências

**Pergunta:** o que acontece se o plano mudar de preço, duração ou for desativado
enquanto existe solicitação pendente? A empresa pode ter mais de uma solicitação
pendente?

**Recomendação:** uma única solicitação pendente por empresa. O snapshot da
solicitação prevalece; se o plano for desativado, o Master decide confirmar ou
rejeitar. Nova compra ou mudança de plano só depois de resolver a pendência.
Cancelamento explícito é permitido.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. Uma pendência; snapshot prevalece; bloqueia nova compra até resolver | Evita pagamento duplicado e ativação ambígua. **Recomendada.** |
| B. Várias pendências; a última vence | Flexível, mas aumenta risco de pagamento duplicado e confusão. |
| C. Cancelar automaticamente a pendência quando o plano muda | Simples, mas pode cancelar uma compra já paga. |

**Risco sem decisão:** duas solicitações pagas para o mesmo período, ativação da
solicitação errada ou perda de compra válida.

**Fase dependente:** primeira migration (índice único parcial) e fluxo de compra.

**Contexto:** a especificação recomenda uma pendência, mas não há decisão
comercial sobre quantas nem sobre mudança de plano.

---

### P10 — Upgrade entre planos pagos e proração

**Pergunta:** quando a empresa já tem plano pago ativo e escolhe outro plano
pago, isso é nova compra, troca simples ou proração?

**Recomendação:** na v1, tratar como nova compra, sem proração. O novo período
começa conforme P8, e o plano anterior é substituído pelo plano do snapshot
confirmado. Proração fica para fase posterior, se aprovada.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. Nova compra, sem proração | Simples e previsível; pode custar mais ao cliente em upgrade no meio do ciclo. **Recomendada para v1.** |
| B. Troca simples, sem cobrança adicional | Simples para o cliente, mas pode gerar perda de receita. |
| C. Proração do valor restante | Mais justa, mas exige regra comercial e cálculo de crédito. |

**Risco sem decisão:** upgrade sem cobrança vira bypass de receita, ou o cliente
paga duas vezes sem regra clara.

**Fase dependente:** fluxo de compra; pode ser fechada depois da primeira
migration.

**Contexto:** a especificação não define proração nem política comercial de
upgrade.

---

## 3. CPF

### CPF1 — Quando o CPF se torna obrigatório

**Pergunta:** em que momento o CPF passa a ser exigido no onboarding e nas
empresas existentes?

**Recomendação:** manter coleta opcional primeiro, rodar campanha de
regularização e só depois ativar a obrigatoriedade. A data/ gatilho é decisão do
responsável.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. Após campanha, com data definida pelo responsável | Reduz bloqueio em massa. **Recomendada.** |
| B. Imediatamente para todos | Aplica a regra rápido, mas pode bloquear onboarding e empresas antigas. |
| C. Nunca obrigatório; apenas para planos pagos | Menos atrito, mas a regra de unicidade fica incompleta. |

**Risco sem decisão:** ativar cedo e bloquear clientes, ou nunca ativar e manter
a regra ineficaz.

**Fase dependente:** primeira migration de CPF (flag de obrigatoriedade e RPC de
onboarding).

**Contexto:** a data e o gatilho não estão definidos. Não inventar.

---

### CPF2 — Abrangência: novas empresas, existentes ou ambas

**Pergunta:** a obrigatoriedade vale para novas empresas, empresas existentes ou
ambas?

**Recomendação:** começar pelas novas empresas e regularizar as existentes em
campanha separada. A regra final vale para ambas.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. Novas primeiro; existentes em campanha | Menor impacto operacional. **Recomendada.** |
| B. Novas e existentes ao mesmo tempo | Aplicação uniforme, mas risco alto de bloqueio em massa. |
| C. Somente novas; existentes isentas para sempre | Menos atrito, mas mantém empresas sem identidade e enfraquece a regra. |

**Risco sem decisão:** regra inconsistente entre clientes novos e antigos, ou
bloqueio amplo sem comunicação.

**Fase dependente:** primeira migration e onboarding.

**Contexto:** a especificação não define a abrangência.

---

### CPF3 — Empresas sem CPF no legado

**Pergunta:** o que acontece com empresas existentes que não têm CPF?

**Recomendação:** marcar como `pending_regularization`, sem bloqueio imediato.
O prazo e a eventual suspensão são decisões do produto e devem ser definidos
antes de qualquer enforcement.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. Estado pendente, sem bloqueio imediato | Preserva operação e permite campanha. **Recomendada e alinhada à D8.** |
| B. Bloqueio após prazo definido | Aplica a regra, mas exige comunicação e risco operacional. |
| C. Tratar como gratuito/limitado até regularizar | Reduz atrito, mas cria incentivo para não regularizar. |

**Risco sem decisão:** bloquear empresas em massa ou manter a regra sem efeito
prático.

**Fase dependente:** primeira migration (status) e backfill.

**Contexto:** prazo, comunicação e bloqueio não estão definidos.

---

### CPF4 — CPF duplicado no legado

**Pergunta:** quando o mesmo CPF aparece em mais de uma empresa, qual empresa
permanece e como as demais são tratadas?

**Recomendação:** decisão manual e auditada, com critério documentado. Manter uma
empresa como titular e marcar as demais como `duplicate_pending`, sem apagar
dados nem expor o CPF. Não aplicar unicidade global enquanto houver duplicados
não resolvidos.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. Resolução manual com critério documentado | Controlada e auditável. **Recomendada.** |
| B. Manter automaticamente a mais antiga ou a mais recente | Rápida, mas pode escolher a empresa errada. |
| C. Bloquear todas as empresas com CPF duplicado | Aplica a regra, mas para operações legítimas. |

**Risco sem decisão:** migration falhar, empresa legítima perder identidade ou
duplicidade permanecer invisível.

**Fase dependente:** primeira migration (índice parcial e status) e backfill.

**Contexto:** o critério de qual empresa permanece não está definido.

---

### CPF5 — Procedimento de regularização

**Pergunta:** quem regulariza, com quais evidências, em qual prazo e com qual
comunicação?

**Recomendação:** OWNER/ADMIN informa o CPF por autoatendimento; Master pode
regularizar com motivo e auditoria. Não usar backfill automático de `leads` sem
consentimento e validação. Prazo e comunicação são decisões do produto.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. Autoatendimento + Master com auditoria | Escala e mantém controle. **Recomendada.** |
| B. Somente Master regulariza | Mais controle, mas vira gargalo operacional. |
| C. Backfill automático por nome/telefone/e-mail | Rápido, mas risco alto de vínculo errado e violação de privacidade. |

**Risco sem decisão:** fila manual sem critério, dados incorretos ou exposição
de CPF em planilhas e mensagens.

**Fase dependente:** após o schema; pode esperar a primeira migration.

**Contexto:** evidências, prazo e comunicação não estão definidos.

---

### CPF6 — Troca de responsável, transferência e múltiplos OWNERs

**Pergunta:** a troca de responsável é permitida? Quem pode fazê-la? Como fica o
CPF quando a empresa é transferida ou tem mais de um OWNER?

**Recomendação:** permitir troca apenas pelo OWNER atual ou pelo Master, de
forma atômica. O novo responsável precisa ter CPF válido e livre. O CPF antigo é
liberado somente após o sucesso. Em empresas com múltiplos OWNERs, definir um
responsável único por empresa.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. Troca atômica com novo CPF obrigatório; um responsável por empresa | Mantém a regra e evita CPF órfão. **Recomendada.** |
| B. Transferir sem CPF e regularizar depois | Menos atrito, mas cria estado pendente e risco de duplicidade. |
| C. Não permitir troca de responsável | Mais simples, mas impede sucessão e venda de empresa. |

**Risco sem decisão:** CPF preso ao responsável antigo, empresa sem identidade ou
dois responsáveis disputando o mesmo CPF.

**Fase dependente:** pode ser RPC posterior, desde que o modelo já tenha
`company_id` único e cascade.

**Contexto:** a especificação não define se a troca é permitida nem como tratar
múltiplos OWNERs.

---

### CPF7 — Recuperação, correção e remoção do CPF

**Pergunta:** como corrigir um CPF errado, remover/anomizar o CPF e tratar a
exclusão da empresa?

**Recomendação:** correção por RPC auditada, sem apagar histórico. Exclusão da
empresa remove a linha por cascade e libera o CPF. Se houver obrigação legal de
retenção, usar estrutura separada e restrita. Não manter CPF operacional após o
fim da finalidade.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. Correção auditada + cascade na exclusão + retenção separada se necessário | Equilíbrio entre operação e privacidade. **Recomendada.** |
| B. Apenas anonimizar, sem remover | Mais conservador, mas mantém dado pessoal indefinidamente. |
| C. Exclusão imediata sem retenção | Simples, mas pode violar obrigação legal. |

**Risco sem decisão:** CPF errado preso à empresa, dado retido sem base legal ou
perda de histórico.

**Fase dependente:** após o schema; pode esperar a primeira migration, mas não a
produção.

**Contexto:** retenção e base legal não estão definidas.

---

### CPF8 — Quem pode ver o CPF completo e mascaramento

**Pergunta:** quem pode ver o CPF completo, em quais situações, e qual máscara é
exibida para os demais?

**Recomendação:** OWNER/ADMIN e Master veem apenas máscara. CPF completo somente
por RPC auditada para `PLATFORM_ADMIN`, com motivo. O próprio responsável também
vê apenas máscara na interface comum. Exportações e listagens nunca incluem CPF
completo.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. Máscara para todos; completo só Master via RPC auditada | Menor exposição e trilha de acesso. **Recomendada.** |
| B. OWNER vê o próprio CPF completo; Master vê máscara | Mais conveniência para o cliente, mas amplia exposição. |
| C. Master vê completo sem motivo/auditoria | Simples, mas viola a direção aprovada de acesso auditado. |

**Risco sem decisão:** vazamento para membros, suporte ou exportações; ou
impossibilidade de conferência quando necessário.

**Fase dependente:** primeira migration (RPC/RLS/máscara).

**Contexto:** a especificação recomenda A, mas não há aprovação explícita.

---

### CPF9 — Operações que devem ser auditadas

**Pergunta:** quais operações com CPF precisam de auditoria?

**Recomendação:** auditar criação, atualização, revelação completa,
regularização, correção, remoção/anomização e troca de responsável. O
`audit_logs` registra ator, empresa, operação, motivo e timestamp, sem o CPF.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. Auditar todas as operações sensíveis, sem CPF no metadata | Trilha completa e segura. **Recomendada.** |
| B. Auditar apenas a revelação completa | Menos ruído, mas não rastreia alterações indevidas. |
| C. Auditar sem motivo ou sem ator | Trilha incompleta para investigação. |

**Risco sem decisão:** impossibilidade de investigar vazamento, alteração ou
regularização indevida.

**Fase dependente:** primeira migration e RPCs.

**Contexto:** a lista mínima é técnica; a retenção da auditoria é decisão
separada.

---

### CPF10 — Empresas criadas por revendedor

**Pergunta:** quem fornece o CPF do responsável em empresas criadas por
revendedor e em qual momento?

**Recomendação:** o OWNER/responsável fornece o CPF no aceite do convite ou na
ativação. O revendedor pode pré-preencher, mas não é o titular do CPF nem pode
alterá-lo sem o responsável. A ativação de revenda precisa validar a existência
do CPF quando a obrigatoriedade estiver ativa.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. Responsável fornece; revendedor pode pré-preencher | Mantém a titularidade correta. **Recomendada.** |
| B. Revendedor fornece e mantém o CPF | Mais simples para o revendedor, mas risco de dado de terceiro e responsabilidade errada. |
| C. Empresas de revenda ficam isentas | Evita atrito, mas cria bypass da regra. |

**Risco sem decisão:** empresas de revenda contornam a unicidade ou o
revendedor armazena CPF sem base adequada.

**Fase dependente:** após o schema; pode esperar a primeira migration.

**Contexto:** o fluxo de convite/ativação de revenda não define o titular do CPF.

---

### CPF11 — Regra própria de CNPJ

**Pergunta:** o CNPJ terá regra própria de unicidade ou continuará fora da regra
do CPF?

**Recomendação:** manter CNPJ separado nesta fase. Se houver regra de CNPJ, ela
deve ser uma decisão posterior, com modelagem própria, sem misturar com a
unicidade do CPF.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. CNPJ separado; regra própria só em fase posterior | Não atrasa a onda de CPF. **Recomendada.** |
| B. Aplicar unicidade de CNPJ junto com o CPF | Mais completo, mas amplia escopo e exige tratar legado de CNPJ. |
| C. Nunca aplicar regra de CNPJ | Menos controle, mas evita bloqueio. |

**Risco sem decisão:** escopo da onda crescer e atrasar o CPF, ou criar regra de
CNPJ incompatível com a de CPF.

**Fase dependente:** pode esperar; não bloqueia a primeira migration de CPF.

**Contexto:** a decisão aprovada apenas separa CNPJ do CPF; não define regra de
unicidade.

---

## 4. Privacidade e proteção

### PRIV1 — Estratégia de armazenamento do CPF

**Pergunta:** o CPF será armazenado como texto restrito, hash, criptografado ou
hash + criptografia?

**Recomendação:** tabela separada e restrita com **hash determinístico com
pepper para unicidade + CPF criptografado para leitura autorizada + máscara para
interface**. Não armazenar CPF em `companies` ou `profiles`.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. Hash + criptografia + máscara | Unicidade, conferência e menor impacto de vazamento. **Recomendada.** |
| B. Hash + texto restrito em tabela separada | Mais simples, mas o texto ainda vaza se a tabela for lida. |
| C. Somente hash | Muito privado, mas impede conferência e integração futura que exija CPF. |
| D. Texto em `companies`/`profiles` | Simples, mas exposição inaceitável. |

**Risco sem decisão:** vazamento por leitura ampla, impossibilidade de conferir
CPF ou retrabalho de migration.

**Fase dependente:** primeira migration de CPF.

**Contexto:** a direção de tabela restrita + hash + máscara + auditoria está
aprovada em alto nível; a combinação final com criptografia não está.

---

### PRIV2 — Criptografia e gestão de chaves

**Pergunta:** onde ficam a chave de criptografia, quem a acessa, como ocorre
rotação e como é feito o backup?

**Recomendação:** chave fora da tabela, preferencialmente em Supabase Vault ou
segredo de Edge Function, com `key_version` por registro, rotação planejada e
backup seguro. Nunca chave no frontend, no repositório ou em
`platform_settings` legível.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. Vault/Edge secret com `key_version` e rotação | Melhor separação de privilégio. **Recomendada se disponível.** |
| B. `pgcrypto` com chave no banco | Mais simples, mas a chave fica próxima do dado e exige cuidado extra. |
| C. Criptografia no frontend | Inaceitável: expõe chave e não protege o dado no servidor. |

**Risco sem decisão:** perda de acesso ao CPF, chave exposta ou criptografia
apenas nominal.

**Fase dependente:** primeira migration de CPF.

**Contexto:** a disponibilidade de Vault/`pgp_sym_encrypt` no ambiente-alvo
precisa ser validada. A escolha de infraestrutura não está definida.

---

### PRIV3 — Hash determinístico com pepper

**Pergunta:** o hash de unicidade usará pepper? Onde o pepper fica e como
rotacioná-lo?

**Recomendação:** usar HMAC-SHA256 com pepper sobre o CPF normalizado. O pepper
fica em Vault/Edge secret, separado do banco. Guardar versão do pepper para
permitir rotação e recálculo controlado.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. HMAC-SHA256 com pepper e versão | Resistente a enumeração; permite rotação. **Recomendada.** |
| B. SHA-256 sem pepper | Determinístico, mas CPF tem espaço pequeno e é enumerável. |
| C. Hash com salt aleatório por registro | Protege melhor, mas não permite unicidade global por igualdade. |

**Risco sem decisão:** hash enumerável, colisão operacional ou impossibilidade de
rotacionar sem perder unicidade.

**Fase dependente:** primeira migration de CPF.

**Contexto:** a especificação recomenda pepper, mas não há aprovação formal nem
definição de armazenamento/rotação.

---

### PRIV4 — Recuperação do CPF quando a chave falha

**Pergunta:** como recuperar o CPF se a chave de criptografia for perdida ou
precisar ser rotacionada?

**Recomendação:** manter backup seguro da chave e procedimento de
break-glass auditado. Se não houver recuperação, assumir que o CPF completo não
pode ser exibido novamente e planejar a recriptografia antes de perder a chave.
Nunca criar cópia em texto puro como “backup”.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. Backup seguro + break-glass auditado | Permite recuperação controlada. **Recomendada.** |
| B. Sem recuperação; apenas hash/máscara | Mais privado, mas impossibilita conferência futura. |
| C. Escrow em texto puro | Recupera facilmente, mas cria alvo de vazamento inaceitável. |

**Risco sem decisão:** perda definitiva do CPF ou criação de cópia insegura.

**Fase dependente:** primeira migration de CPF (desenho de chave).

**Contexto:** a política de recuperação e a tolerância a perda não estão
definidas.

---

### PRIV5 — Formato de mascaramento e contextos de exibição

**Pergunta:** qual máscara será exibida e em quais telas?

**Recomendação:** máscara padrão com apenas os últimos dígitos visíveis para
OWNER/ADMIN e Master; nunca exibir CPF completo em lista, exportação, URL,
notificação ou storefront. O formato exato pode ser `***.***.***-XX` ou
equivalente, desde que não permita reidentificação fácil.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. Máscara com últimos dígitos para perfis autorizados | Confere sem expor o número inteiro. **Recomendada.** |
| B. Máscara total para todos | Mais privado, mas dificulta conferência. |
| C. CPF completo para OWNER | Conveniência, mas amplia exposição e risco. |

**Risco sem decisão:** máscara inconsistente entre telas ou exposição acidental
em exportações.

**Fase dependente:** primeira migration (campos de máscara) e UI.

**Contexto:** a direção de mascarar está aprovada; o formato e os contextos não.

---

### PRIV6 — Logs, erros e auditoria sem CPF completo

**Pergunta:** o que pode aparecer em logs, mensagens de erro e auditoria?

**Recomendação:** nenhum CPF completo em logs, URLs, erros, analytics,
notificações ou `audit_logs`. Usar `company_id`, `request_id`, `cpf_last4` ou
hash truncado apenas quando necessário para correlação. Mensagens de erro
genéricas, sem repetir o número.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. Proibir CPF completo em qualquer log/auditoria; usar IDs | Menor risco de vazamento. **Recomendada.** |
| B. Permitir CPF mascarado em auditoria | Ajuda na conferência, mas ainda é dado pessoal. |
| C. Permitir CPF completo em log interno | Inaceitável para privacidade e segurança. |

**Risco sem decisão:** vazamento por log, ferramenta de erro ou exportação de
auditoria.

**Fase dependente:** primeira migration e RPCs.

**Contexto:** a proibição de CPF em auditoria já está na direção aprovada; o
formato de correlação não.

---

### PRIV7 — Acesso administrativo mínimo e revisão

**Pergunta:** quais perfis administrativos podem acessar CPF, com qual
finalidade e com qual revisão?

**Recomendação:** somente `PLATFORM_ADMIN`, com menor privilégio, motivo
obrigatório na revelação e revisão periódica de acessos. Não criar papel
“financeiro” ou “suporte” com acesso amplo na v1 sem necessidade comprovada.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. Somente `PLATFORM_ADMIN`, auditado e revisado | Menor superfície de acesso. **Recomendada.** |
| B. Papel específico de financeiro/suporte | Mais adequado a equipes grandes, mas exige novo papel e treinamento. |
| C. Qualquer Master sem motivo | Simples, mas sem controle de finalidade. |

**Risco sem decisão:** insider access sem trilha ou impossibilidade operacional
de atender solicitações legítimas.

**Fase dependente:** primeira migration (RLS/RPC).

**Contexto:** a estrutura da equipe Master e a necessidade de papéis não estão
definidas.

---

### PRIV8 — Retenção, descarte, backup e incidentes

**Pergunta:** por quanto tempo o CPF é retido, como é descartado, como os
backups são protegidos e qual é o procedimento de incidente?

**Recomendação:** definir prazo de retenção e base legal com o responsável/
jurídico; usar backup criptografado; excluir/anonimizar ao fim da finalidade;
não incluir CPF em exportações por padrão; documentar resposta a incidente e
revisão de acessos.

**Alternativas:**

| Alternativa | Consequência |
|---|---|
| A. Retenção definida + backup criptografado + descarte | Conformidade e menor impacto. **Recomendada.** |
| B. Retenção indefinida | Simples, mas risco jurídico e de vazamento. |
| C. Exclusão imediata sem backup | Mais privado, mas pode violar obrigação legal e perder histórico. |

**Risco sem decisão:** retenção sem base legal, backup exposto ou incidente sem
procedimento.

**Fase dependente:** pode esperar a primeira migration, mas precisa estar
fechada antes de produção.

**Contexto:** prazo, base legal e procedimento de incidente não estão definidos.

---

## 5. Modelo de resposta

Responda apenas as decisões que quiser alterar. Para as demais, use
`aprovo a recomendação`. Se uma decisão não puder ser respondida, escreva
`contexto insuficiente`.

```text
P1:
P2:
P3:
P4:
P5:
P6:
P7:
P8:
P9:
P10:

CPF1:
CPF2:
CPF3:
CPF4:
CPF5:
CPF6:
CPF7:
CPF8:
CPF9:
CPF10:
CPF11:

PRIV1:
PRIV2:
PRIV3:
PRIV4:
PRIV5:
PRIV6:
PRIV7:
PRIV8:
```

Exemplos de preenchimento:

```text
P1: aprovo a recomendação
P2: escolho a alternativa B
P3: aprovo a recomendação
P4: aprovo a recomendação
P5: contexto insuficiente; quero definir a política de estorno depois
P6: aprovo a recomendação
P7: aprovo a recomendação
P8: aprovo a recomendação
P9: aprovo a recomendação
P10: aprovo a recomendação

CPF1: CPF obrigatório somente para novas empresas após campanha
CPF2: aprovo a recomendação
CPF3: aprovo a recomendação
CPF4: aprovo a recomendação
CPF5: aprovo a recomendação
CPF6: aprovo a recomendação
CPF7: aprovo a recomendação
CPF8: aprovo a recomendação
CPF9: aprovo a recomendação
CPF10: aprovo a recomendação
CPF11: aprovo a recomendação

PRIV1: aprovo a estratégia recomendada
PRIV2: aprovo a recomendação
PRIV3: aprovo a recomendação
PRIV4: aprovo a recomendação
PRIV5: aprovo a recomendação
PRIV6: aprovo a recomendação
PRIV7: aprovo a recomendação
PRIV8: contexto insuficiente; definir com jurídico
```

---

## 6. Confirmação do estado do Git

**Antes desta etapa:** `git status --porcelain` retornava **82** alterações
locais (24 arquivos modificados + 58 não rastreados), incluindo a especificação
anterior.

**Durante a criação inicial:**

- Nenhum código, migration, banco, configuração, teste ou documento existente
  foi alterado.
- Nenhum comando com escrita de dados, commit, push ou deploy foi executado.
- Nenhum valor comercial, prazo ou política foi inventado.
- Nenhuma decisão já aprovada foi reaberta.

**Depois da criação:** confirmado com `git status --porcelain`: **83**
alterações locais (24 modificados + 59 não rastreados). A única nova entrada é
`docs/etapa-3-aprovacoes-compra-pix-cpf.md`; as demais alterações já existiam
antes desta etapa. Nenhum commit, push ou deploy foi executado.

**Atualização da matriz (2026-10-31):** somente este documento foi alterado para
registrar as aprovações e pendências. Nenhum código, migration, banco,
configuração ou teste foi alterado. A contagem local permanece **83** (24
modificados + 59 não rastreados), pois o documento já era não rastreado.

---

## 7. Conclusão

A matriz foi atualizada em 2026-10-31. O pacote Pix foi aprovado, com
**P1 = 1 dia corrido configurável no Master**. O pacote CPF foi aprovado
condicionado à validação da infraestrutura de segurança e à definição das
políticas de retenção e regularização.

Das **29 decisões**, **28 estão aprovadas em nível de especificação**, várias
com pendência operacional ou condição; **PRIV2 permanece pendente** de validação
e escolha final. Nenhuma implementação deve começar antes do fechamento dos
pontos da seção 8. A regra “um CPF, uma empresa” permanece intacta e não foi
alterada.

---

## 8. Matriz de aprovação atualizada

**Legenda:** **Aprovado** = recomendação/alternativa aprovada sem pendência;
**Aprovado com pendência** = direção aprovada, falta parâmetro operacional;
**Aprovado com condição** = pacote CPF aprovado, mas depende de infraestrutura
e/ou políticas; **Pendente** = escolha final ainda não feita.

| Código | Status | Condição / pendência |
|---|---|---|
| P1 | Aprovado | 1 dia corrido configurável no Master; expirada não ativa; exceção auditada. |
| P2 | Aprovado | Referência + valor confirmado; divergência bloqueia; comprovante opcional; override auditado. |
| P3 | Aprovado | Uma confirmação de `PLATFORM_ADMIN` com auditoria na v1. |
| P4 | Aprovado | Master rejeita com motivo; OWNER/ADMIN cancela pendente; sem delete. |
| P5 | Aprovado com condição | Produto fechado: não remover acesso automaticamente; exceção somente por decisão explícita e auditada do Master, com motivo registrado. Validação jurídica da hipótese de remoção permanece condicionada. |
| P6 | Aprovado | Tabela restrita + RPC; QR fixo; configuração versionada. |
| P7 | Aprovado | Só Master edita; OWNER/ADMIN vê instruções da própria solicitação. |
| P8 | Aprovado | Período começa na confirmação via `now()`; renovação `max(now(), expires_at)`. |
| P9 | Aprovado | Uma pendência por empresa; snapshot prevalece. |
| P10 | Aprovado | Upgrade entre pagos = nova compra sem proração na v1. |
| CPF1 | Aprovado com condição | Produto fechado: CPF permanece opcional; não definir data agora; não bloquear empresas antigas por ausência de CPF. Obrigatoriedade condicionada à aprovação de campanha, prazo e comunicação. |
| CPF2 | Aprovado com condição | Novas primeiro; existentes em campanha; condicionado ao pacote CPF. |
| CPF3 | Aprovado com condição | `pending_regularization` sem bloqueio imediato; condicionado ao pacote CPF. |
| CPF4 | Aprovado com condição | Produto fechado: evidência verificável que associe responsável e empresa; revisão manual pelo Master com registro de evidência consultada, decisão, responsável e data; casos inconclusivos ficam pendentes; sem titular automático. Validação jurídica da evidência permanece condicionada. |
| CPF5 | Aprovado com condição | Produto fechado: autoatendimento por OWNER/ADMIN e regularização pelo Master com motivo/auditoria; sem backfill de `leads`. Prazo, evidências e comunicação devem ser aprovados antes da obrigatoriedade. |
| CPF6 | Aprovado com condição | Troca atômica; um responsável por empresa; condicionado ao pacote CPF. |
| CPF7 | Aprovado com condição | Produto fechado: sem retenção separada agora; remover CPF operacional ao fim da finalidade. Retenção adicional condicionada à validação de base legal e prazo pelo responsável/jurídico. |
| CPF8 | Aprovado com condição | Máscara para todos; completo só `PLATFORM_ADMIN` via RPC auditada. |
| CPF9 | Aprovado com condição | Auditoria das operações sensíveis, sem CPF no metadata. |
| CPF10 | Aprovado com condição | Responsável fornece CPF; revendedor só pré-preenche. |
| CPF11 | Aprovado com condição | CNPJ separado nesta fase. |
| PRIV1 | Aprovado com condição | Tabela restrita + hash/pepper + criptografia + máscara; depende de PRIV2. |
| PRIV2 | Aprovado com condição | Validar disponibilidade e condições de uso de Supabase Vault ou Edge secrets no ambiente-alvo. Se indisponível, adiar o armazenamento de CPF completo; `pgcrypto` somente com decisão explícita sobre o risco. |
| PRIV3 | Aprovado com condição | HMAC-SHA256 com pepper; depende de PRIV2. |
| PRIV4 | Aprovado com condição | Break-glass restrito ao Master, com procedimento documentado, autorização controlada, auditoria e teste de recuperação antes de produção; sem backup em texto puro. |
| PRIV5 | Aprovado com condição | Máscara com últimos dígitos; nunca completo em lista/exportação. |
| PRIV6 | Aprovado com condição | Sem CPF completo em logs/erros/auditoria; usar IDs. |
| PRIV7 | Aprovado com condição | Só `PLATFORM_ADMIN`; motivo e revisão periódica. |
| PRIV8 | Aprovado com condição | Retenção e base legal permanecem pendentes com responsável/jurídico. Procedimento de incidente deve prever registro, contenção, investigação, revisão de acessos e encaminhamento para avaliação das obrigações aplicáveis; sem prazo legal ou notificação inventados. |

### 8.1 Pontos ainda pendentes

1. **P5:** definir a regra explícita para eventual remoção de acesso após
   estorno. Padrão aprovado: não remover automaticamente.
2. **CPF1:** definir data ou gatilho da obrigatoriedade.
3. **CPF4:** detalhar o critério operacional e o padrão de evidências da relação
   legítima; casos sem evidência suficiente ficam pendentes.
4. **CPF5:** definir prazo, evidências e comunicação antes da obrigatoriedade.
5. **CPF7:** validar base legal e prazo de retenção; usar estrutura separada
   somente se houver base legal.
6. **PRIV2:** validar a infraestrutura e escolher entre Vault/Edge secret e
   `pgcrypto`; preferência registrada por Vault/Edge.
7. **PRIV4:** documentar a custódia e a autorização do break-glass, restritas ao
   Master.
8. **PRIV8:** validar retenção, base legal e procedimento de incidente com o
   responsável/jurídico.
9. **Condição transversal do pacote CPF:** validação da infraestrutura de
   segurança e definição das políticas de retenção e regularização.

### 8.2 O que já está fechado

- **Pacote Pix:** P1–P10 aprovados; P1 = 1 dia corrido; P10 sem proração na v1.
- **Pacote CPF:** recomendações aprovadas, condicionadas à infraestrutura e às
  políticas de retenção/regularização.
- **Implementação:** não autorizada; nenhum código, banco, migration,
  configuração ou teste foi alterado.
